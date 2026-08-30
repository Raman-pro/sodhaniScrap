import axios from 'axios';
import { pool } from '../db/pool';
import format from 'pg-format';
import dotenv from 'dotenv';

dotenv.config();

const BASE_URL = process.env.BSE_SPURT_VOLUME_URL || "https://api.bseindia.com/BseIndiaAPI/api/SpurtvolumeNew/w?flag=1";
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

export async function spurtVolumeSync() {
    console.log('--- Starting BSE Spurt Volume Sync ---');
    const client = await pool.connect();
    
    try {
        const response = await axios.get(BASE_URL, { 
            headers: HEADERS, 
            timeout: 15000,
            insecureHTTPParser: true 
        } as any);
        // Fully numeric BSE scrip codes must start with 5 to be equities; non-numeric codes
        // aren't part of that numbering scheme so leave them be.
        const isEquityCode = (scripCd: any) => {
            const code = String(scripCd);
            return /^\d+$/.test(code) ? code.startsWith('5') : true;
        };
        const allRecords = response.data || [];
        const records = allRecords.filter((rec: any) => isEquityCode(rec.scrip_cd));

        console.log(`Fetched ${allRecords.length} Spurt Volume records, ${records.length} equities after filtering.`);

        if (records.length > 0) {
            const valuesToInsert = [];

            for (const rec of records) {
                valuesToInsert.push([
                    rec.scrip_cd,
                    rec.scripname,
                    rec.long_name,
                    rec.Trd_vol ? parseFloat(rec.Trd_vol) : null,
                    rec.wkavgqty ? parseFloat(rec.wkavgqty) : null,
                    rec.volumechangetimes ? parseFloat(rec.volumechangetimes) : null,
                    rec.Ltradert ? parseFloat(rec.Ltradert) : null,
                    rec.change_val ? parseFloat(rec.change_val) : null,
                    rec.change_percent ? parseFloat(rec.change_percent) : null,
                    rec.TurnOver ? parseFloat(rec.TurnOver) : null,
                    rec.NSURL
                ]);
            }

            // Using CURRENT_DATE as record_date, we insert or update on conflict
            const query = format(`
                INSERT INTO bse_spurt_volume 
                (scrip_cd, scripname, long_name, trd_vol, wkavgqty, volumechangetimes, ltradert, change_val, change_percent, turnover, nsurl)
                VALUES %L
                ON CONFLICT (scrip_cd, record_date) DO UPDATE SET
                    scripname = EXCLUDED.scripname,
                    long_name = EXCLUDED.long_name,
                    trd_vol = EXCLUDED.trd_vol,
                    wkavgqty = EXCLUDED.wkavgqty,
                    volumechangetimes = EXCLUDED.volumechangetimes,
                    ltradert = EXCLUDED.ltradert,
                    change_val = EXCLUDED.change_val,
                    change_percent = EXCLUDED.change_percent,
                    turnover = EXCLUDED.turnover,
                    nsurl = EXCLUDED.nsurl
            `, valuesToInsert);
            
            const res = await client.query(query);
            console.log(`Successfully synced ${res.rowCount || 0} records into database.`);
        }
        
        console.log(`--- Spurt Volume Sync Complete ---`);
    } catch (error) {
        console.error('Error in spurtVolumeSync:', error);
    } finally {
        client.release();
    }
}
