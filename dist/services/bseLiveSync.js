"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.bseLiveSync = bseLiveSync;
const axios_1 = __importDefault(require("axios"));
const pool_1 = require("../db/pool");
// @ts-ignore
const pg_format_1 = __importDefault(require("pg-format"));
const BSE_HEADERS = {
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
async function fetchBSEData(url) {
    try {
        const response = await axios_1.default.get(url, { headers: BSE_HEADERS });
        return response.data;
    }
    catch (error) {
        console.error(`BSE Fetch Error for ${url}:`, error.message);
        return [];
    }
}
async function bseLiveSync() {
    console.log(`[${new Date().toISOString()}] Phase 3: Executing BSE Live Sync...`);
    const gainerUrl = process.env.BSE_GAINER_URL || 'https://api.bseindia.com/BseIndiaAPI/api/MktRGainerLoserDataeqto/w?GLtype=gainer&IndxGrp=AllMkt&IndxGrpval=AllMkt&orderby=all';
    const loserUrl = process.env.BSE_LOSER_URL || 'https://api.bseindia.com/BseIndiaAPI/api/MktRGainerLoserDataeqto/w?GLtype=loser&IndxGrp=AllMkt&IndxGrpval=AllMkt&orderby=all';
    const [gainers, losers] = await Promise.all([
        fetchBSEData(gainerUrl),
        fetchBSEData(loserUrl)
    ]);
    const gainersList = gainers?.Table || [];
    const losersList = losers?.Table || [];
    const allData = [...gainersList, ...losersList];
    if (allData.length === 0) {
        console.log('No data fetched from BSE.');
        return;
    }
    const seen = new Set();
    const values = [];
    for (const item of allData) {
        const recordDate = item.dt_tm ? item.dt_tm.split('T')[0] : new Date().toISOString().split('T')[0];
        const key = `${item.scrip_cd}_${recordDate}`;
        if (!seen.has(key)) {
            seen.add(key);
            values.push([
                item.scrip_cd.toString(), // FinInstrmId
                recordDate,
                item.openrate,
                item.highrate,
                item.lowrate,
                item.ltradert, // close_price
                item.trd_vol
            ]);
        }
    }
    if (values.length === 0)
        return;
    const client = await pool_1.pool.connect();
    try {
        const validCodesRes = await client.query('SELECT "FinInstrmId" FROM company_stock');
        const validCodes = new Set(validCodesRes.rows.map(r => r.FinInstrmId));
        const validValues = values.filter(v => validCodes.has(v[0]));
        if (validValues.length === 0) {
            console.log('No valid equities matched in database. Skipping live sync.');
            return;
        }
        const query = (0, pg_format_1.default)(`
      INSERT INTO historical_prices 
      ("FinInstrmId", record_date, open_price, high_price, low_price, close_price, volume)
      VALUES %L
      ON CONFLICT ("FinInstrmId", record_date) 
      DO UPDATE SET 
        open_price = COALESCE(EXCLUDED.open_price, historical_prices.open_price),
        high_price = EXCLUDED.high_price,
        low_price = EXCLUDED.low_price,
        close_price = EXCLUDED.close_price,
        volume = EXCLUDED.volume
    `, validValues);
        await client.query(query);
        console.log(`Successfully updated live prices for ${validValues.length} equities.`);
    }
    catch (err) {
        console.error('Error during BSE live sync DB upsert:', err);
    }
    finally {
        client.release();
    }
}
