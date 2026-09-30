import { execFile } from 'child_process';
import { promisify } from 'util';
import format from 'pg-format';
import { pool } from '../db/pool';
import dotenv from 'dotenv';

dotenv.config();

const execFileAsync = promisify(execFile);

const NSE_ANNOUNCEMENTS_URL = process.env.NSE_ANNOUNCEMENTS_URL ||
    'https://www.nseindia.com/api/corporate-announcements';
// The window is re-fetched on every poll and de-duplicated on seq_id, so there
// is no watermark to get stuck on. 1 day back also covers the IST midnight edge.
const LOOKBACK_DAYS = parseInt(process.env.NSE_ANNOUNCEMENTS_LOOKBACK_DAYS || '1', 10);

const MONTHS: Record<string, string> = {
    Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
    Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12'
};

// NSE's date filter is DD-MM-YYYY in IST.
function istDate(offsetDays: number): string {
    const d = new Date(Date.now() + 5.5 * 3600 * 1000 - offsetDays * 86400 * 1000);
    const iso = d.toISOString().slice(0, 10);
    return `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;
}

// "30-Sep-2026 13:41:54" (IST) -> ISO timestamp with offset.
export function parseNseAnDt(s: unknown): string | null {
    if (typeof s !== 'string') return null;
    const m = s.match(/^(\d{2})-([A-Za-z]{3})-(\d{4}) (\d{2}):(\d{2}):(\d{2})$/);
    if (!m || !MONTHS[m[2]]) return null;
    return `${m[3]}-${MONTHS[m[2]]}-${m[1]}T${m[4]}:${m[5]}:${m[6]}+05:30`;
}

// Uses curl like the other NSE services (nseLiveSync, exchangeState): NSE's
// edge accepts it with a Referer, while axios/fetch get blocked.
// Throws on anything that isn't a JSON array, so a blocked run is never
// mistaken for "nothing new".
async function fetchWindow(fromDate: string, toDate: string): Promise<any[]> {
    const url = `${NSE_ANNOUNCEMENTS_URL}?index=equities&from_date=${fromDate}&to_date=${toDate}`;
    const { stdout } = await execFileAsync('curl', [
        '-s',
        '-m', '30',
        '-H', 'accept: application/json',
        '-H', 'user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        '-H', 'Referer: https://www.nseindia.com/',
        url
    ], { maxBuffer: 50 * 1024 * 1024 });

    let json: any;
    try {
        json = JSON.parse(stdout);
    } catch {
        throw new Error(`NSE announcements ${fromDate}..${toDate}: response was not JSON (${stdout.slice(0, 80).replace(/\s+/g, ' ')})`);
    }
    if (!Array.isArray(json)) {
        throw new Error(`NSE announcements ${fromDate}..${toDate}: expected an array, got ${typeof json}`);
    }
    return json;
}

export async function nseAnnouncementSync() {
    console.log('--- Starting NSE Announcements Sync ---');
    try {
        const fromDate = istDate(LOOKBACK_DAYS);
        const toDate = istDate(0);
        const rows = await fetchWindow(fromDate, toDate);
        console.log(`NSE announcements ${fromDate}..${toDate}: ${rows.length} records fetched.`);

        const values = rows
            .filter(r => r && r.seq_id && r.symbol)
            .map(r => [
                String(r.seq_id),
                String(r.symbol).toUpperCase(),
                r.sm_isin || null,
                r.sm_name || null,
                parseNseAnDt(r.an_dt),
                r.desc || null,
                r.attchmntText || null,
                r.attchmntFile || null,
                r.attFileSize || null,
                typeof r.hasXbrl === 'boolean' ? r.hasXbrl : null
            ]);

        let inserted = 0;
        // Chunked so one statement never carries the whole (~1k row) payload.
        for (let i = 0; i < values.length; i += 500) {
            const chunk = values.slice(i, i + 500);
            const res = await pool.query(format(`
                INSERT INTO nse_announcements
                (seq_id, symbol, isin, company_name, an_dt, category, description,
                 attachment_url, attachment_size, has_xbrl)
                VALUES %L
                ON CONFLICT (seq_id) DO NOTHING
            `, chunk));
            inserted += res.rowCount || 0;
        }

        console.log(`--- NSE Announcements Sync Complete. Inserted ${inserted} new records. ---`);
    } catch (error) {
        console.error('[ERROR] NSE announcements sync FAILED:', error);
    }
}
