import axios from 'axios';
import { pool } from '../db/pool';
// @ts-ignore
import format from 'pg-format';
import { execFile } from 'child_process';
import { promisify } from 'util';
const execFileAsync = promisify(execFile);

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


async function fetchBSEData(url: string) {
  try {
    const { stdout } = await execFileAsync('curl', [
      '-s',
      '-m', '15',
      '-H', 'accept: application/json',
      '-H', 'user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      '-H', 'Referer: https://www.bseindia.com/',
      url
    ], { maxBuffer: 10 * 1024 * 1024 });
    return JSON.parse(stdout);
  } catch (error: any) {
    console.error(`BSE Fetch Error for ${url}:`, error.message);
    return [];
  }
}

export async function bseLiveSync() {
  console.log(`[${new Date().toISOString()}] Phase 3: Executing BSE Live Sync...`);
  
  const gainerUrl = 'https://api.bseindia.com/BseIndiaAPI/api/MktRGainerLoserDataeqto/w?GLtype=gainer&IndxGrp=AllMkt&IndxGrpval=AllMkt&orderby=all';
  const loserUrl = 'https://api.bseindia.com/BseIndiaAPI/api/MktRGainerLoserDataeqto/w?GLtype=loser&IndxGrp=AllMkt&IndxGrpval=AllMkt&orderby=all';

  console.log('Fetching gainers from:', gainerUrl);
  console.log('Fetching losers from:', loserUrl);

  // Fetch gainers and losers using curl wrapper
  const gainers = await fetchBSEData(gainerUrl);
  await new Promise(resolve => setTimeout(resolve, 2000));
  const losers = await fetchBSEData(loserUrl);

  // Fully numeric BSE scrip codes must start with 5 to be equities (other numeric ranges are
  // debt, mutual funds, etc.); non-numeric codes aren't part of that numbering scheme so leave them be.
  const isEquityCode = (scripCd: any) => {
    const code = String(scripCd);
    return /^\d+$/.test(code) ? code.startsWith('5') : true;
  };

  const gainersList = (gainers?.Table || []).filter((item: any) => isEquityCode(item.scrip_cd));
  const losersList = ((losers as any)?.Table || []).filter((item: any) => isEquityCode(item.scrip_cd));
  console.log(`Fetched ${gainersList.length} gainers, ${losersList.length} losers from BSE.`);
  if (gainersList.length > 0) {
    console.log(`Top gainer: ${gainersList[0].scripname} change_percent=${gainersList[0].change_percent}`);
  }
  if (losersList.length > 0) {
    console.log(`Top loser: ${losersList[0].scripname} change_percent=${losersList[0].change_percent}`);
  }
  
  const allData = [...gainersList, ...losersList];
  
  if (allData.length === 0) {
    console.log('No data fetched from BSE.');
    return;
  }

  const seen = new Set<string>();
  const values: any[] = [];
  
  for (const item of allData) {
    let d: Date;
    if (item.dt_tm) {
      d = new Date(item.dt_tm.replace('T', ' ') + " GMT+0530");
      // If the BSE API returned a stale tick from yesterday (e.g. 15:35) without a date,
      // JS will incorrectly assume it's for today. If it appears to be in the future,
      // it's actually from yesterday's close. We must safely ignore it.
      if (d.getTime() > Date.now() + 60000) {
        continue;
      }
    } else {
      d = new Date();
    }
    
    const recordDate = d.toISOString();
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

  if (values.length === 0) return;

  const client = await pool.connect();

  try {
    const validCodesRes = await client.query('SELECT "FinInstrmId" FROM company_stock');
    const validCodes = new Set(validCodesRes.rows.map(r => r.FinInstrmId));
    
    const validValues = values.filter(v => validCodes.has(v[0]));

    if (validValues.length === 0) {
      console.log('No valid equities matched in database. Skipping live sync.');
      return;
    }

    const query = format(`
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

    // Update top 10 gainers and losers
    const topGainersLosersValues = [];
    
    // Process Gainers (Top 50)
    for (let i = 0; i < Math.min(50, gainersList.length); i++) {
        const item = gainersList[i];
        const recordTime = item.dt_tm ? new Date(item.dt_tm + " GMT+0530").toISOString() : new Date().toISOString();
        topGainersLosersValues.push([
            recordTime,
            'gainer',
            i + 1,
            item.scrip_cd.toString(),
            item.scripname,
            item.LONG_NAME || null,
            item.ltradert,
            item.change_val,
            item.change_percent
        ]);
    }
    
    // Process Losers (Top 50)
    for (let i = 0; i < Math.min(50, losersList.length); i++) {
        const item = losersList[i];
        const recordTime = item.dt_tm ? new Date(item.dt_tm + " GMT+0530").toISOString() : new Date().toISOString();
        topGainersLosersValues.push([
            recordTime,
            'loser',
            i + 1,
            item.scrip_cd.toString(),
            item.scripname,
            item.LONG_NAME || null,
            item.ltradert,
            item.change_val,
            item.change_percent
        ]);
    }

    if (topGainersLosersValues.length > 0) {
        const glQuery = format(`
          INSERT INTO bse_top_gainers_losers 
          ("record_time", "type", "rank", "scrip_cd", "scripname", "long_name", "ltradert", "change_val", "change_percent")
          VALUES %L
          ON CONFLICT ("type", "rank") DO UPDATE SET
            "record_time" = EXCLUDED.record_time,
            "scrip_cd" = EXCLUDED.scrip_cd,
            "scripname" = EXCLUDED.scripname,
            "long_name" = EXCLUDED.long_name,
            "ltradert" = EXCLUDED.ltradert,
            "change_val" = EXCLUDED.change_val,
            "change_percent" = EXCLUDED.change_percent
        `, topGainersLosersValues);
        
        await client.query(glQuery);
        console.log(`Successfully updated Top 10 Gainers and Losers (${topGainersLosersValues.length} records).`);
    }

  } catch (err) {
    console.error('Error during BSE live sync DB upsert:', err);
  } finally {
    client.release();
  }
}
