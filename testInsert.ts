import { pool } from './src/db/pool';
import axios from 'axios';
import format from 'pg-format';
import dotenv from 'dotenv';
dotenv.config();

const BASE_URL = "https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w";
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

async function run() {
    const today = new Date();
    const yyyymmddToday = today.toISOString().split('T')[0].replace(/-/g, '');
    const params = {
        "pageno": 1,
        "strCat": "-1",
        "strPrevDate": yyyymmddToday,
        "strScrip": "",
        "strSearch": "P",
        "strToDate": yyyymmddToday,
        "strType": "C",
        "subcategory": "-1"
    };

    const client = await pool.connect();
    try {
        const response = await axios.get(BASE_URL, { params, headers: HEADERS });
        const records = response.data.Table || [];
        console.log(`Fetched ${records.length} records`);

        const valuesToInsert = [];
        for (const rec of records) {
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
                (newsid, scrip_cd, news_dt, newssub, headline, slongname, announcement_type, attachmentname, categoryname)
                VALUES %L
                ON CONFLICT (newsid) DO NOTHING
                RETURNING newsid
            `, valuesToInsert);
            
            console.log('Executing query...');
            const res = await client.query(query);
            console.log('Inserted rowCount:', res.rowCount);
        }
    } catch(e) {
        console.error('Error inserting:', e);
    } finally {
        client.release();
        process.exit(0);
    }
}
run();
