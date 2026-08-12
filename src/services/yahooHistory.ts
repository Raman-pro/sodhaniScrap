import YahooFinance from 'yahoo-finance2';
const yahooFinance = new (YahooFinance as any)();
import { pool } from '../db/pool';
// @ts-ignore
import format from 'pg-format';
import fs from 'fs';
import path from 'path';

export async function fetchHistoricalCatchup() {
  console.log('Phase 2: Historical Catch-Up (Yahoo Finance)');
  
  const client = await pool.connect();
  const logFilePath = path.join(__dirname, '../../failed_fetches.log');

  const companiesDataPath = path.join(__dirname, '../../companies.json');
  let bseToNseMap: Record<string, string> = {};
  try {
    if (fs.existsSync(companiesDataPath)) {
      const companiesData = JSON.parse(fs.readFileSync(companiesDataPath, 'utf8'));
      bseToNseMap = companiesData.bse_to_nse || {};
    }
  } catch (err) {
    console.error('Failed to load companies.json:', err);
  }
  
  try {
    const res = await client.query(`
      SELECT c."FinInstrmId", c."TckrSymb", MAX(h."record_date") as last_record
      FROM company_stock c
      LEFT JOIN historical_prices h ON c."FinInstrmId" = h."FinInstrmId"
      GROUP BY c."FinInstrmId", c."TckrSymb"
    `);

    const stocks = res.rows;
    console.log(`Found ${stocks.length} stocks to process for historical catch-up.`);

    const upsertToDb = async (result: any[], FinInstrmId: string) => {
        if (!result || result.length === 0) return;
        
        // Filter out rows with null close/open (incomplete trading days or live intraday artifacts)
        const cleanResult = result.filter((row: any) => row.close !== null && row.open !== null);
        if (cleanResult.length === 0) return;
        
        const values = cleanResult.map((row: any) => [
          FinInstrmId,
          row.date.toISOString(), // Preserve full timestamp instead of stripping time
          row.open, row.high, row.low, row.close, row.adjclose || row.adjClose || null, row.volume
        ]);

        const query = format(`
          INSERT INTO historical_prices 
          ("FinInstrmId", record_date, open_price, high_price, low_price, close_price, adj_close, volume)
          VALUES %L
          ON CONFLICT ("FinInstrmId", record_date) 
          DO UPDATE SET 
            open_price = EXCLUDED.open_price, high_price = EXCLUDED.high_price,
            low_price = EXCLUDED.low_price, close_price = EXCLUDED.close_price,
            adj_close = EXCLUDED.adj_close, volume = EXCLUDED.volume
        `, values);
        await client.query(query);
    };

    for (const stock of stocks) {
      const { FinInstrmId, TckrSymb, last_record } = stock;
      
      const isBseCode = /^\d{6}$/.test(FinInstrmId);
      const primarySymbol = isBseCode ? `${FinInstrmId}.BO` : (TckrSymb && TckrSymb.endsWith('.NS') ? TckrSymb : `${FinInstrmId}.NS`);
      
      let fallbackSymbol = null;
      if (TckrSymb && TckrSymb !== primarySymbol && TckrSymb !== FinInstrmId) {
         fallbackSymbol = TckrSymb.endsWith('.BO') || TckrSymb.endsWith('.NS') 
            ? TckrSymb 
            : `${TckrSymb}.BO`;
      }
      
      const nseSymbol = bseToNseMap[FinInstrmId] ? `${bseToNseMap[FinInstrmId]}.NS` : null;

      const period1 = last_record 
        ? new Date(last_record).toISOString().split('T')[0] 
        : (process.env.YAHOO_DEFAULT_START_DATE || '1990-01-01'); 
      const period2 = new Date().toISOString().split('T')[0];
      
      if (period1 === period2) {
         continue; // Data is up to date, skip fetching
      }
      
      const attemptFetch = async (symbol: string) => {
        const result = await yahooFinance.chart(symbol, { period1, period2 });
        return result.quotes || [];
      };

      let primarySuccess = false;
      let fetchedRowsCount = 0;
      
      try {
        console.log(`Fetching history for ${primarySymbol} from ${period1} to ${period2}`);
        const result = await attemptFetch(primarySymbol);
        fetchedRowsCount = result?.length || 0;
        await upsertToDb(result, FinInstrmId);
        console.log(`Upserted ${fetchedRowsCount} rows for ${primarySymbol}`);
        primarySuccess = true;
      } catch (err: any) {
        console.error(`Error fetching for ${primarySymbol}: ${err.message}`);
      }

      const isFullFetch = !last_record;

      if (!primarySuccess || (isFullFetch && fetchedRowsCount < 20)) {
        if (fallbackSymbol && fallbackSymbol !== primarySymbol) {
           try {
             console.log(`Trying fallback ${fallbackSymbol} from ${period1} to ${period2} (Reason: ${!primarySuccess ? 'Error on primary' : 'Fetched < 20 rows on primary'})`);
             const fallbackResult = await attemptFetch(fallbackSymbol);
             fetchedRowsCount = fallbackResult?.length || 0;
             await upsertToDb(fallbackResult, FinInstrmId);
             console.log(`Upserted ${fetchedRowsCount} rows for ${fallbackSymbol}`);
             if (fetchedRowsCount >= 20) {
               primarySuccess = true;
             }
           } catch (fallbackErr: any) {
             console.error(`Error fetching for fallback ${fallbackSymbol}: ${fallbackErr.message}`);
           }
        }
      }

      if (!primarySuccess || (isFullFetch && fetchedRowsCount < 20)) {
        if (nseSymbol && nseSymbol !== fallbackSymbol && nseSymbol !== primarySymbol) {
          try {
            console.log(`Fetching history for NSE symbol ${nseSymbol} (Reason: ${!primarySuccess ? 'Error on prior attempts' : 'Fetched < 20 rows on prior attempts'})`);
            const nseResult = await attemptFetch(nseSymbol);
            fetchedRowsCount = nseResult?.length || 0;
            await upsertToDb(nseResult, FinInstrmId);
            console.log(`Upserted ${fetchedRowsCount} rows for ${nseSymbol}`);
            if (fetchedRowsCount >= 20) {
              primarySuccess = true;
            }
          } catch (nseErr: any) {
            console.error(`Error fetching for ${nseSymbol}: ${nseErr.message}`);
          }
        }
      }

      if (!primarySuccess || (isFullFetch && fetchedRowsCount < 20)) {
         console.error(`All attempts failed for ${primarySymbol}. Logging to failed_fetches.log`);
         fs.appendFileSync(logFilePath, `${new Date().toISOString()} - ${FinInstrmId}, Primary: ${primarySymbol}, Fallback: ${fallbackSymbol}, NSE: ${nseSymbol}, No fetch succeeded.\n`);
      }
    }
  } catch (err) {
    console.error('Error during historical catch-up:', err);
  } finally {
    client.release();
  }
}
