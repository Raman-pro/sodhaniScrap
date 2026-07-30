import axios from 'axios';
import { pool } from '../db/pool';
import format from 'pg-format';
import dotenv from 'dotenv';

dotenv.config();

const BASE_URL = process.env.BSE_ANNOUNCEMENTS_URL ||
"https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w";
const HEADERS = {
    "accept": "application/json, text/plain, */*",
    "accept-language": "en-US,en-IN;q=0.9,en;q=0.8",
    "priority": "u=1, i",
    "sec-ch-ua": "\"Not;A=Brand\";v=\"8\", \"Chromium\";v=\"150\", \"Google Chrome\";v=\"150\"",
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": "\"macOS\"",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-site",
    "Referer": "https://www.bseindia.com/"
};

async function getLastNewsId(): Promise<string | null> {
    const client = await pool.connect();
    try {
        const res = await client.query(`SELECT value FROM sync_metadata WHERE key = 'last_newsid'`);
        if (res.rows.length > 0) {
            const newsid = res.rows[0].value;
            const check = await client.query(`SELECT 1 FROM bse_announcements WHERE newsid = $1`, [newsid]);
            if (check.rows.length === 0) {
                console.warn(`[WARN] last_newsid ${newsid} found in metadata but missing from bse_announcements.
Ignoring watermark.`);
                return null;
            }
            return newsid;
        }
        return null;
    } finally {
        client.release();
    }
}

async function setLastNewsId(newsid: string): Promise<void> {
    const client = await pool.connect();
    try {
        await client.query(`
            INSERT INTO sync_metadata (key, value)
            VALUES ('last_newsid', $1)
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
        `, [newsid]);
    } finally {
        client.release();
    }
}

async function fetchPage(fromDate: string, toDate: string, page: number): Promise<any[]> {
    const params = {
        "pageno": page,
        "strCat": "-1",
        "strPrevDate": fromDate,
        "strScrip": "",
        "strSearch": "P",
        "strToDate": toDate,
        "strType": "C",
        "subcategory": "-1"
    };

    try {
        const response = await axios.get(BASE_URL, {
            params,
            headers: HEADERS,
            timeout: 15000,
            insecureHTTPParser: true
        } as any);
        return response.data.Table || [];
    } catch (error) {
        console.error(`Error fetching announcements page ${page}:`, error);
        return [];
    }
}

function ymd(d: Date): string {
    return d.toISOString().split('T')[0].replace(/-/g, '');
}

function parseYmd(s: string): Date {
    return new Date(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)));
}

export async function announcementSync() {
    console.log('--- Starting BSE Announcements Sync ---');
    const client = await pool.connect();

    try {
        const lastNewsId = await getLastNewsId();
        let newerNewsId: string | null = null;
        let insertedCount = 0;

        const todayStr = ymd(new Date());
        let startDateStr = todayStr;
        if (process.env.ANNOUNCEMENTS_START_DATE) {
            startDateStr = process.env.ANNOUNCEMENTS_START_DATE.replace(/-/g, '');
        }

        // BSE's endpoint only reliably returns results for a single day at a time,
        // so walk backwards day-by-day from today to the configured start date.
        const dates: string[] = [];
        const startD = parseYmd(startDateStr);
        for (let d = parseYmd(todayStr); d >= startD; d.setDate(d.getDate() - 1)) {
            dates.push(ymd(d));
        }

        const maxPages = 50; // safeguard per day

        dayLoop:
        for (const dateStr of dates) {
            for (let page = 1; page <= maxPages; page++) {
                const records = await fetchPage(dateStr, dateStr, page);
                console.log(`Announcements ${dateStr} Page ${page}: ${records.length} records fetched.`);

                if (records.length === 0) break;

                if (newerNewsId === null) {
                    newerNewsId = records[0].NEWSID;
                }

                let seenLast = false;
                const valuesToInsert = [];

                for (const rec of records) {
                    if (rec.NEWSID === lastNewsId) {
                        seenLast = true;
                        break;
                    }

                    valuesToInsert.push([
                        rec.NEWSID,
                        rec.SCRIP_CD ? String(rec.SCRIP_CD) : null,
                        rec.NEWS_DT,
                        rec.NEWSSUB,
                        rec.HEADLINE,
                        rec.SLONGNAME,
                        rec.ANNOUNCEMENT_TYPE,
                        rec.ATTACHMENTNAME,
                        rec.CATEGORYNAME
                    ]);
                }

                if (valuesToInsert.length > 0) {
                    const query = format(`
                        INSERT INTO bse_announcements
                        (newsid, scrip_cd, news_dt, newssub, headline, slongname, announcement_type, attachmentname,
categoryname)
                        VALUES %L
                        ON CONFLICT (newsid) DO NOTHING
                    `, valuesToInsert);

                    const res = await client.query(query);
                    insertedCount += res.rowCount || 0;
                }

                if (seenLast) {
                    console.log(`Hit last_newsid (${lastNewsId}) on ${dateStr} — caught up.`);
                    break dayLoop;
                }

                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }

        if (newerNewsId && newerNewsId !== lastNewsId) {
            await setLastNewsId(newerNewsId);
        }

        console.log(`--- Announcements Sync Complete. Inserted ${insertedCount} new records. ---`);
    } catch (error) {
        console.error('Error in announcementSync:', error);
    } finally {
        client.release();
    }
}
