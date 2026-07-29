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
          row.date.toISOString().split('T')[0],
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
      const primarySymbol = `${FinInstrmId}.BO`;
      
      let fallbackSymbol = null;
      if (TckrSymb && TckrSymb !== primarySymbol && TckrSymb !== FinInstrmId) {
         fallbackSymbol = TckrSymb.endsWith('.BO') || TckrSymb.endsWith('.NS') 
            ? TckrSymb 
            : `${TckrSymb}.BO`;
      }

      const period1 = last_record 
        ? new Date(last_record).toISOString().split('T')[0] 
        : (process.env.YAHOO_DEFAULT_START_DATE || '1990-01-01'); 
      const period2 = new Date().toISOString().split('T')[0];
      
      const attemptFetch = async (symbol: string) => {
        const result = await yahooFinance.chart(symbol, { period1, period2 });
        return result.quotes || [];
      };

      try {
        console.log(`Fetching history for ${primarySymbol} from ${period1} to ${period2}`);
        const result = await attemptFetch(primarySymbol);
        await upsertToDb(result, FinInstrmId);
        console.log(`Upserted ${result?.length || 0} rows for ${primarySymbol}`);
      } catch (err: any) {
        if (fallbackSymbol) {
           try {
             console.log(`Failed for ${primarySymbol}, trying fallback ${fallbackSymbol} from ${period1} to ${period2}`);
             const result = await attemptFetch(fallbackSymbol);
             await upsertToDb(result, FinInstrmId);
             console.log(`Upserted ${result?.length || 0} rows for ${fallbackSymbol}`);
           } catch (fallbackErr: any) {
             console.error(`Fallback failed for ${fallbackSymbol}. Logging to failed_fetches.log`);
             fs.appendFileSync(logFilePath, `${new Date().toISOString()} - ${FinInstrmId}, Primary: ${primarySymbol}, Fallback: ${fallbackSymbol}, Error: ${fallbackErr.message}\n`);
           }
        } else {
           console.error(`No fallback available for ${primarySymbol}. Logging to failed_fetches.log`);
           fs.appendFileSync(logFilePath, `${new Date().toISOString()} - ${FinInstrmId}, Primary: ${primarySymbol}, No Fallback, Error: ${err.message}\n`);
        }
      }
    }
  } catch (err) {
    console.error('Error during historical catch-up:', err);
  } finally {
    client.release();
  }
}
