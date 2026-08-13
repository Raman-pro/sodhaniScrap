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
  
  const advanceUrl = 'https://www.nseindia.com/api/live-analysis-advance';
  const declineUrl = 'https://www.nseindia.com/api/live-analysis-decline';
  const unchangedUrl = 'https://www.nseindia.com/api/live-analysis-unchanged';

  const [advanceRes, declineRes, unchangedRes] = await Promise.all([
    fetchNSEData(advanceUrl),
    fetchNSEData(declineUrl),
    fetchNSEData(unchangedUrl)
  ]);

  const advances = advanceRes?.advance?.data || [];
  const declines = declineRes?.decline?.data || [];
  const unchanged = unchangedRes?.Unchange?.data || [];

  const allData = [...advances, ...declines, ...unchanged];
  console.log(`Fetched ${advances.length} advances, ${declines.length} declines, ${unchanged.length} unchanged from NSE.`);

  if (allData.length === 0) {
    console.log('No data fetched from NSE.');
    return;
  }

  const client = await pool.connect();

  try {
    // We only care about NSE stocks that are already in our database
    const validCodesRes = await client.query('SELECT "FinInstrmId" FROM company_stock WHERE "TckrSymb" LIKE \'%.NS\'');
    const validCodes = new Set(validCodesRes.rows.map(r => r.FinInstrmId));
    
    if (validCodes.size === 0) {
      console.log('No NSE equities found in database to update.');
      return;
    }

    const seen = new Set<string>();
    const values: any[] = [];
    const recordDate = new Date().toISOString().split('T')[0]; // Using just date to match existing upsert logic

    for (const item of allData) {
      // NSE data doesn't provide exact open/high/low in this endpoint.
      // We extract symbol, lastPrice (close), and totalTradedVolume.
      const symbol = item.symbol;
      
      if (validCodes.has(symbol)) {
        if (!seen.has(symbol)) {
          seen.add(symbol);
          
          // The API sometimes provides volume in decimal representation of lakhs. 
          // We convert it to a whole number by multiplying by 100,000, 
          // but we ensure it remains a valid integer for BIGINT insertion.
          const rawVolume = item.totalTradedVolume || 0;
          const absoluteVolume = Math.floor(rawVolume * 100000);

          values.push([
            symbol, // FinInstrmId
            recordDate,
            item.lastPrice, // Update the close price to the live price
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
      ("FinInstrmId", record_date, close_price, volume)
      VALUES %L
      ON CONFLICT ("FinInstrmId", record_date) 
      DO UPDATE SET 
        close_price = COALESCE(EXCLUDED.close_price, historical_prices.close_price),
        volume = COALESCE(EXCLUDED.volume, historical_prices.volume)
    `, values);

    await client.query(query);
    console.log(`Successfully updated live prices for ${values.length} NSE equities.`);

  } catch (err) {
    console.error('Error during NSE live sync DB upsert:', err);
  } finally {
    client.release();
  }
}
