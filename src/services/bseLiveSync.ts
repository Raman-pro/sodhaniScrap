import axios from 'axios';
import { pool } from '../db/pool';
// @ts-ignore
import format from 'pg-format';

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

// Use Node's native fetch for losers (axios gets blocked by BSE anti-bot)
async function fetchBSELoserData(url: string) {
  try {
    const response = await fetch(url, {
      headers: {
        "accept": "application/json",
        "Referer": "https://www.bseindia.com/"
      }
    });
    return await response.json();
  } catch (error: any) {
    console.error(`BSE Loser Fetch Error:`, error.message);
    return [];
  }
}

async function fetchBSEData(url: string) {
  try {
    const response = await axios.get(url, { 
        headers: BSE_HEADERS,
        insecureHTTPParser: true 
    } as any);
    return response.data;
  } catch (error: any) {
    console.error(`BSE Fetch Error for ${url}:`, error.message);
    return [];
  }
}

export async function bseLiveSync() {
  console.log(`[${new Date().toISOString()}] Phase 3: Executing BSE Live Sync...`);
  
  const gainerUrl = process.env.BSE_GAINER_URL || 'https://api.bseindia.com/BseIndiaAPI/api/MktRGainerLoserDataeqto/w?GLtype=gainer&IndxGrp=AllMkt&IndxGrpval=AllMkt&orderby=all';
  const loserUrl = process.env.BSE_LOSER_URL || 'https://api.bseindia.com/BseIndiaAPI/api/MktRGainerLoserDataeqto/w?GLtype=loser&IndxGrp=AllMkt&IndxGrpval=AllMkt&orderby=all';

  // Fetch gainers with axios (works fine)
  // Fetch losers with Node native fetch (axios gets blocked by BSE anti-bot for losers)
  const gainers = await fetchBSEData(gainerUrl);
  await new Promise(resolve => setTimeout(resolve, 2000));
  const losers = await fetchBSELoserData(loserUrl);

  const gainersList = gainers?.Table || [];
  const losersList = (losers as any)?.Table || [];
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
    const recordDate = item.dt_tm ? new Date(item.dt_tm).toISOString() : new Date().toISOString();
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
        const recordTime = item.dt_tm ? new Date(item.dt_tm).toISOString() : new Date().toISOString();
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
        const recordTime = item.dt_tm ? new Date(item.dt_tm).toISOString() : new Date().toISOString();
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
