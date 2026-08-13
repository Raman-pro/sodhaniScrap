import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { pool } from '../db/pool';
// @ts-ignore
import format from 'pg-format';
import dotenv from 'dotenv';
import { BseIndex, IndexGraphHeader, IndexHistoryPoint } from '../types/index';

dotenv.config();

const GRAPH_DATA_URL = 'https://api.bseindia.com/BseIndiaAPI/api/SensexGraphData_CAS/w';

const HEADERS = {
    "accept": "*/*",
    "accept-encoding": "gzip, deflate, br, zstd",
    "accept-language": "en-US,en-IN;q=0.9,en;q=0.8",
    "origin": "https://www.bseindia.com",
    "priority": "u=1, i",
    "referer": "https://www.bseindia.com/",
    "sec-ch-ua": "\"Not;A=Brand\";v=\"8\", \"Chromium\";v=\"150\", \"Google Chrome\";v=\"150\"",
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": "\"macOS\"",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-site",
    "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36"
};

const REQUEST_DELAY_MS = parseInt(process.env.INDICES_REQUEST_DELAY_MS || '300', 10);
const HISTORY_YEARS = parseInt(process.env.INDICES_HISTORY_YEARS || '1', 10);

const MONTHS: Record<string, string> = {
    Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
    Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12'
};

// Matches "Wed Jan 01 2025 00:00:00" / "Thu Aug 13 2026 09:00:59"
const DATE_RE = /^\w+ (\w+) (\d{2}) (\d{4}) (\d{2}):(\d{2}):(\d{2})$/;

function parseGraphDate(raw: string): { dateStr: string; dateTimeStr: string } | null {
    const m = DATE_RE.exec(raw.trim());
    if (!m) return null;
    const [, monName, day, year, hh, mm, ss] = m;
    const mon = MONTHS[monName];
    if (!mon) return null;
    const dateStr = `${year}-${mon}-${day}`;
    const dateTimeStr = `${dateStr} ${hh}:${mm}:${ss}`;
    return { dateStr, dateTimeStr };
}

function fmtYYYYMMDD(d: Date): string {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}${mm}${dd}`;
}

function toNumber(v: any): number | null {
    if (v === undefined || v === null || v === '') return null;
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
}

export function loadIndices(): BseIndex[] {
    const jsonPath = path.join(__dirname, '../../indices.json');
    if (!fs.existsSync(jsonPath)) {
        console.warn('indices.json not found, returning empty array');
        return [];
    }
    try {
        const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        return (raw as any[]).map(r => ({ sccode: String(r.sccode), scname: String(r.scname).trim() }));
    } catch (err) {
        console.error('Failed to load indices.json:', err);
        return [];
    }
}

export function parseGraphResponse(raw: any): { header: IndexGraphHeader | null; points: IndexHistoryPoint[] } {
    const text = typeof raw === 'string' ? raw : String(raw ?? '');
    const [rawHeader, rawPoints] = text.split('#@#');

    let header: IndexGraphHeader | null = null;
    if (rawHeader && rawHeader.trim().length > 0) {
        try {
            const parsedHeader = JSON.parse(rawHeader);
            header = Array.isArray(parsedHeader) ? (parsedHeader[0] || null) : parsedHeader;
        } catch {
            header = null;
        }
    }

    let points: IndexHistoryPoint[] = [];
    if (rawPoints && rawPoints.trim().length > 0) {
        try {
            const parsedPoints = JSON.parse(rawPoints);
            if (Array.isArray(parsedPoints)) {
                points = parsedPoints.map((p: any) => {
                    const hasValue1 = Object.prototype.hasOwnProperty.call(p, 'value1');
                    const value = p.value ?? p.value1;
                    return {
                        date: p.date,
                        value,
                        session: hasValue1 ? 'preopen' : 'regular'
                    } as IndexHistoryPoint;
                });
            }
        } catch {
            points = [];
        }
    }

    return { header, points };
}

async function fetchGraphData(sccode: string, opts: { flag: 0 | 1; seriesid: 'DT' | 'R'; frd: string; tod: string }) {
    const url = `${GRAPH_DATA_URL}?index=${sccode}&flag=${opts.flag}&sector=&seriesid=${opts.seriesid}&frd=${opts.frd}&tod=${opts.tod}`;
    try {
        const response = await axios.get(url, {
            headers: HEADERS,
            timeout: 15000,
            insecureHTTPParser: true
        } as any);
        return parseGraphResponse(response.data);
    } catch (error: any) {
        console.error(`Indices Fetch Error for sccode=${sccode}:`, error.message);
        return { header: null, points: [] };
    }
}

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export async function seedIndices() {
    const indices = loadIndices();
    if (indices.length === 0) {
        console.warn('No indices loaded from indices.json, skipping seed.');
        return;
    }

    const client = await pool.connect();
    try {
        const values = indices.map(idx => [idx.sccode, idx.scname]);
        const query = format(`
            INSERT INTO bse_indices (sccode, scname)
            VALUES %L
            ON CONFLICT (sccode) DO UPDATE SET
                scname = EXCLUDED.scname,
                updated_at = CURRENT_TIMESTAMP
        `, values);
        await client.query(query);
        console.log(`Seeded ${indices.length} indices into bse_indices.`);
    } catch (error) {
        console.error('Error seeding bse_indices:', error);
    } finally {
        client.release();
    }
}

export async function indicesHistoryBackfill() {
    console.log('--- Starting Indices History Backfill ---');
    const indices = loadIndices();
    if (indices.length === 0) {
        console.warn('No indices loaded from indices.json, skipping backfill.');
        return;
    }

    const client = await pool.connect();
    let lastDates = new Map<string, Date>();
    try {
        const res = await client.query(`SELECT sccode, MAX(record_time)::date AS last_date FROM bse_index_history GROUP BY sccode`);
        for (const row of res.rows) {
            lastDates.set(row.sccode, row.last_date);
        }
    } catch (error) {
        console.error('Error fetching last synced dates for indices:', error);
    } finally {
        client.release();
    }

    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const defaultStart = new Date(today);
    defaultStart.setFullYear(defaultStart.getFullYear() - HISTORY_YEARS);

    let processedCount = 0;
    let totalRows = 0;

    for (const idx of indices) {
        const lastDate = lastDates.get(idx.sccode);

        if (lastDate && lastDate >= yesterday) {
            processedCount++;
            continue;
        }

        const frdDate = lastDate ? new Date(lastDate) : defaultStart;
        const frd = fmtYYYYMMDD(frdDate);
        const tod = fmtYYYYMMDD(today);

        const { points } = await fetchGraphData(idx.sccode, { flag: 1, seriesid: 'DT', frd, tod });

        if (points.length > 0) {
            const rowsBySccode = new Map<string, any[]>();
            for (const p of points) {
                const parsedDate = parseGraphDate(p.date);
                if (!parsedDate || p.value === undefined || p.value === null) continue;
                rowsBySccode.set(parsedDate.dateStr, [idx.sccode, `${parsedDate.dateStr} 00:00:00`, toNumber(p.value)]);
            }

            const values = Array.from(rowsBySccode.values());
            if (values.length > 0) {
                const client2 = await pool.connect();
                try {
                    const query = format(`
                        INSERT INTO bse_index_history (sccode, record_time, value)
                        VALUES %L
                        ON CONFLICT (sccode, record_time) DO UPDATE SET
                            value = EXCLUDED.value,
                            updated_at = CURRENT_TIMESTAMP
                    `, values);
                    await client2.query(query);
                    totalRows += values.length;
                } catch (error) {
                    console.error(`Error upserting history for sccode=${idx.sccode}:`, error);
                } finally {
                    client2.release();
                }
            }
        }

        processedCount++;
        if (processedCount % 10 === 0) {
            console.log(`Backfill progress: ${processedCount}/${indices.length} indices processed.`);
        }

        await sleep(REQUEST_DELAY_MS);
    }

    console.log(`Backfilled ${processedCount} indices, ${totalRows} rows.`);
    console.log('--- Indices History Backfill Complete ---');
}

export async function indicesSync() {
    console.log(`[${new Date().toISOString()}] --- Starting Indices Live Sync ---`);
    const indices = loadIndices();
    if (indices.length === 0) {
        console.warn('No indices loaded from indices.json, skipping live sync.');
        return;
    }

    let processedCount = 0;
    let intradayRows = 0;

    for (const idx of indices) {
        const { header, points } = await fetchGraphData(idx.sccode, { flag: 0, seriesid: 'R', frd: 'null', tod: 'null' });

        if (header) {
            const latestVal = toNumber(header.LatestVal);
            const prevClose = toNumber(header.PreClose);
            const changeVal = latestVal !== null && prevClose !== null ? latestVal - prevClose : null;
            const changePct = changeVal !== null && prevClose ? (changeVal / prevClose) * 100 : null;
            const today = new Date();
            const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

            const client = await pool.connect();
            try {
                const query = format(`
                    INSERT INTO bse_index_history (sccode, record_time, value, prev_close, change_val, change_pct)
                    VALUES %L
                    ON CONFLICT (sccode, record_time) DO UPDATE SET
                        value = EXCLUDED.value,
                        prev_close = EXCLUDED.prev_close,
                        change_val = EXCLUDED.change_val,
                        change_pct = EXCLUDED.change_pct,
                        updated_at = CURRENT_TIMESTAMP
                `, [[idx.sccode, `${todayStr} 00:00:00`, latestVal, prevClose, changeVal, changePct]]);
                await client.query(query);
            } catch (error) {
                console.error(`Error upserting today's index row for sccode=${idx.sccode}:`, error);
            } finally {
                client.release();
            }
        }

        if (points.length > 0) {
            const seen = new Set<string>();
            const values: any[] = [];

            for (const p of points) {
                const parsedDate = parseGraphDate(p.date);
                if (!parsedDate || p.value === undefined || p.value === null) continue;

                if (parsedDate.dateTimeStr.endsWith(' 00:00:00')) continue;

                const key = parsedDate.dateTimeStr;
                if (seen.has(key)) continue;
                seen.add(key);

                values.push([idx.sccode, parsedDate.dateTimeStr, toNumber(p.value), p.session]);
            }

            if (values.length > 0) {
                const client = await pool.connect();
                try {
                    const query = format(`
                        INSERT INTO bse_index_history (sccode, record_time, value, session)
                        VALUES %L
                        ON CONFLICT (sccode, record_time) DO UPDATE SET
                            value = EXCLUDED.value,
                            session = EXCLUDED.session,
                            updated_at = CURRENT_TIMESTAMP
                    `, values);
                    await client.query(query);
                    intradayRows += values.length;
                } catch (error) {
                    console.error(`Error upserting intraday points for sccode=${idx.sccode}:`, error);
                } finally {
                    client.release();
                }
            }
        }

        processedCount++;
        await sleep(REQUEST_DELAY_MS);
    }

    console.log(`Indices live sync complete: ${processedCount} indices processed, ${intradayRows} intraday rows upserted.`);
}
