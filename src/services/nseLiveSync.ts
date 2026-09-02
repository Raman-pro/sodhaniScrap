import { pool } from '../db/pool';
// @ts-ignore
import format from 'pg-format';
import { execFile } from 'child_process';
import { promisify } from 'util';
const execFileAsync = promisify(execFile);

// Use curl to bypass NSE basic anti-bot which blocks axios/fetch
async function fetchNSEData(url: string) {
  try {
    const { stdout } = await execFileAsync('curl', [
      '-s',
      '-m', '15',
      '-H', 'accept: application/json',
      '-H', 'user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      '-H', 'Referer: https://www.nseindia.com/',
      url
    ], { maxBuffer: 10 * 1024 * 1024 }); 
    return JSON.parse(stdout);
  } catch (error: any) {
    console.error(`NSE Fetch Error for ${url}:`, error.message);
    return null;
  }
}

export async function nseLiveSync() {
  console.log(`[${new Date().toISOString()}] Phase 3: Executing NSE Live Sync...`);
  
  const url = 'https://www.nseindia.com/api/live-analysis-stocksTraded';

  const res = await fetchNSEData(url);

  const allData = res?.total?.data || [];
  console.log(`Fetched ${allData.length} records from NSE stocksTraded API.`);

  if (allData.length === 0) {
    console.log('No data fetched from NSE.');
    return;
  }

  const client = await pool.connect();

  try {
    // We only care about NSE stocks that are already in our database (either BSE dual-listed or NSE-only)
    const validCodesRes = await client.query('SELECT "FinInstrmId", "TckrSymb" FROM company_stock');
    const validCodesMap = new Map();
    for (const row of validCodesRes.rows) {
        validCodesMap.set(row.TckrSymb, row.FinInstrmId);
    }
    
    if (validCodesMap.size === 0) {
      console.log('No equities found in database to update.');
      return;
    }

    const seen = new Set<string>();
    const values: any[] = [];
    const recordDate = new Date().toISOString(); // Using full timestamp for intraday charting

    for (const item of allData) {
      // NSE data doesn't provide exact open/high/low in this endpoint.
      // We extract symbol, lastPrice (close), and totalTradedVolume.
      const symbol = item.symbol;
      const finInstrmId = validCodesMap.get(symbol);
      
      if (finInstrmId) {
        if (!seen.has(finInstrmId)) {
          seen.add(finInstrmId);
          
          // The API sometimes provides volume in decimal representation of lakhs. 
          // We convert it to a whole number by multiplying by 100,000, 
          // but we ensure it remains a valid integer for BIGINT insertion.
          const rawVolume = item.totalTradedVolume || 0;
          const absoluteVolume = Math.floor(rawVolume * 100000);

          values.push([
            finInstrmId, // FinInstrmId
            recordDate,
            item.lastPrice, // Initial open_price guess
            item.lastPrice, // Initial high_price guess
            item.lastPrice, // Initial low_price guess
            item.lastPrice, // close_price (current price)
            absoluteVolume
          ]);
        }
      }
    }

    if (values.length === 0) {
      console.log('No fetched NSE equities matched the database.');
      return;
    }

    const query = format(`
      INSERT INTO historical_prices 
      ("FinInstrmId", record_date, open_price, high_price, low_price, close_price, volume)
      VALUES %L
      ON CONFLICT ("FinInstrmId", record_date) 
      DO UPDATE SET 
        open_price = COALESCE(historical_prices.open_price, EXCLUDED.open_price),
        high_price = GREATEST(historical_prices.high_price, EXCLUDED.close_price),
        low_price = LEAST(historical_prices.low_price, EXCLUDED.close_price),
        close_price = EXCLUDED.close_price,
        volume = EXCLUDED.volume
    `, values);

    await client.query(query);
    console.log(`Successfully updated live prices for ${values.length} NSE equities.`);

  } catch (err) {
    console.error('Error during NSE live sync DB upsert:', err);
  } finally {
    client.release();
  }
}
