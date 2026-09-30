import { chromium, Browser, Page } from 'playwright';
import { pool } from '../db/pool';
import format from 'pg-format';
import dotenv from 'dotenv';

dotenv.config();

const BASE_URL = process.env.BSE_ANNOUNCEMENTS_URL ||
"https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w";
const ANNOUNCEMENTS_PAGE_URL = "https://www.bseindia.com/corporates/ann.html";

// BSE's CDN rejects non-browser clients (axios and curl both get 403 "Access
// Denied", and so does headless Chromium), so requests go out through a real
// headed Chromium that has loaded the announcements page first. On the VM it
// runs under Xvfb (see the systemd unit); BSE_HEADLESS=true is only for hosts
// where headless happens to be accepted.
const HEADLESS = process.env.BSE_HEADLESS === 'true';

interface BseSession {
    browser: Browser;
    page: Page;
}

async function openBseSession(): Promise<BseSession> {
    const browser = await chromium.launch({ headless: HEADLESS });
    try {
        const context = await browser.newContext({ locale: 'en-IN' });
        const page = await context.newPage();
        const resp = await page.goto(ANNOUNCEMENTS_PAGE_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
        if (!resp || resp.status() >= 400) {
            throw new Error(`BSE announcements page returned ${resp ? resp.status() : 'no response'}`);
        }
        await page.waitForTimeout(2000);
        return { browser, page };
    } catch (err) {
        await browser.close().catch(() => {});
        throw err;
    }
}

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

// Throws on any non-200 or non-JSON response. Returning [] here used to make a
// blocked run look like "caught up, nothing new", which hid an outage for weeks.
async function fetchPage(page: Page, fromDate: string, toDate: string, pageNo: number): Promise<any[]> {
    const params = new URLSearchParams({
        pageno: String(pageNo),
        strCat: "-1",
        strPrevDate: fromDate,
        strScrip: "",
        strSearch: "P",
        strToDate: toDate,
        strType: "C",
        subcategory: "-1"
    });
    const url = `${BASE_URL}?${params.toString()}`;

    const result = await page.evaluate(async (u: string) => {
        const r = await fetch(u, { headers: { accept: 'application/json, text/plain, */*' } });
        return { status: r.status, body: await r.text() };
    }, url);

    if (result.status !== 200) {
        throw new Error(`BSE announcements ${fromDate} page ${pageNo}: HTTP ${result.status}`);
    }
    let json: any;
    try {
        json = JSON.parse(result.body);
    } catch {
        throw new Error(`BSE announcements ${fromDate} page ${pageNo}: response was not JSON`);
    }
    if (!json || !Array.isArray(json.Table)) {
        throw new Error(`BSE announcements ${fromDate} page ${pageNo}: response had no Table`);
    }
    return json.Table;
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
    let session: BseSession | null = null;

    try {
        session = await openBseSession();
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
                const records = await fetchPage(session.page, dateStr, dateStr, page);
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
        console.error('[ERROR] Announcements sync FAILED, nothing was stored this run:', error);
    } finally {
        if (session) await session.browser.close().catch(() => {});
        client.release();
    }
}
