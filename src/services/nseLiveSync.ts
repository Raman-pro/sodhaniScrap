import { pool } from '../db/pool';
// @ts-ignore
import format from 'pg-format';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { updateLivePriceExtremes } from './priceExtremesService';
import { isPayloadStale, parseExchangeDateTimeToIso, parseNseDate } from '../utils/exchangeState';
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

  const payloadTimestamp = res?.timestamp;
  if (isPayloadStale('nse_live_sync', payloadTimestamp)) {
    console.log(`[NSE Live Sync] Payload timestamp unchanged (${payloadTimestamp}). Skipping DB write.`);
    return;
  }

  // Derive trade date and verify it is not an inadvertent weekend tick
  const tradeDateStr = parseNseDate(payloadTimestamp);
  const tradeDay = new Date(`${tradeDateStr}T12:00:00Z`).getUTCDay();
  if (tradeDay === 0 || tradeDay === 6) {
    console.warn(`[NSE Live Sync] Derived trade date ${tradeDateStr} is a weekend. Skipping DB write.`);
    return;
  }

  const client = await pool.connect();

  try {
    // We only care about NSE stocks that are already in our database (either BSE dual-listed or NSE-only)
    const validCodesRes = await client.query('SELECT "FinInstrmId", "TckrSymb" FROM company_stock');
    const validCodesMap = new Map();
    for (const row of validCodesRes.rows) {
      if (row.TckrSymb) {
        validCodesMap.set(row.TckrSymb, row.FinInstrmId);
        validCodesMap.set(row.TckrSymb.replace(/\.NS$/i, ''), row.FinInstrmId);
      }
      if (row.FinInstrmId) {
        validCodesMap.set(row.FinInstrmId, row.FinInstrmId);
        validCodesMap.set(row.FinInstrmId.replace(/\.NS$/i, ''), row.FinInstrmId);
      }
    }
    
    if (validCodesMap.size === 0) {
      console.log('No equities found in database to update.');
      return;
    }

    const seen = new Set<string>();
    const values: any[] = [];
    const recordDate = payloadTimestamp 
      ? parseExchangeDateTimeToIso(payloadTimestamp) 
      : new Date().toISOString(); // Using verified exchange timestamp for intraday charting

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

          // The official exchange previous close ships in the same record as the
          // last price, so it rides along on this row rather than needing a
          // second pass that back-writes into yesterday's bar.
          const prevClose = parseFloat(item.previousClose);

          values.push([
            finInstrmId, // FinInstrmId
            recordDate,
            item.lastPrice, // Initial open_price guess
            item.lastPrice, // Initial high_price guess
            item.lastPrice, // Initial low_price guess
            item.lastPrice, // close_price (current price)
            absoluteVolume,
            prevClose > 0 ? prevClose : null
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
      ("FinInstrmId", record_date, open_price, high_price, low_price, close_price, volume, prev_close)
      VALUES %L
      ON CONFLICT ("FinInstrmId", record_date)
      DO UPDATE SET
        open_price = COALESCE(historical_prices.open_price, EXCLUDED.open_price),
        high_price = GREATEST(historical_prices.high_price, EXCLUDED.close_price),
        low_price = LEAST(historical_prices.low_price, EXCLUDED.close_price),
        close_price = EXCLUDED.close_price,
        volume = EXCLUDED.volume,
        prev_close = COALESCE(EXCLUDED.prev_close, historical_prices.prev_close)
    `, values);

    await client.query(query);
    console.log(`Successfully updated live prices for ${values.length} NSE equities.`);

    try {
      const liveUpdates = values.map((v) => {
        const finInstrmId = v[0];
        const recordDate = v[1];
        const high = parseFloat(v[3] || v[5] || '0');
        const low = parseFloat(v[4] || v[5] || '0');
        const tradeDate = String(recordDate).split('T')[0];
        return { finInstrmId, high, low, tradeDate };
      }).filter(u => u.high > 0 && u.low > 0);

      await updateLivePriceExtremes(client, liveUpdates);
      console.log(`Successfully updated live price extremes for ${liveUpdates.length} NSE equities.`);
    } catch (extremesErr: any) {
      console.error('Error updating live price extremes (NSE):', extremesErr.message);
    }

  } catch (err) {
    console.error('Error during NSE live sync DB upsert:', err);
  } finally {
    client.release();
  }
}
