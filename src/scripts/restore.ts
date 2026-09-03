import { pool } from '../db/pool';
import YahooFinance from 'yahoo-finance2';
const yahooFinance = new (YahooFinance as any)();

// Silence spam
const originalError = console.error;
const originalWarn = console.warn;
console.error = () => {};
console.warn = () => {};

async function fix() {
  const client = await pool.connect();
  try {
    // 1. DELETE today's garbage intraday ticks without touching historical
    console.log("Cleaning today's garbage ticks...");
    const del1 = await client.query(`
      DELETE FROM historical_prices 
      WHERE DATE(record_date) >= CURRENT_DATE - INTERVAL '1 day'
      AND EXTRACT(HOUR FROM record_date AT TIME ZONE 'UTC') < 3
    `);
    const del2 = await client.query(`
      DELETE FROM bse_index_history 
      WHERE DATE(record_time) >= CURRENT_DATE - INTERVAL '1 day'
      AND EXTRACT(HOUR FROM record_time AT TIME ZONE 'UTC') < 3
    `);
    const del3 = await client.query(`
      DELETE FROM nse_index_history 
      WHERE DATE(record_time) >= CURRENT_DATE - INTERVAL '1 day'
      AND EXTRACT(HOUR FROM record_time AT TIME ZONE 'UTC') < 3
    `);
    console.log(`Deleted ${del1.rowCount || 0} garbage stock ticks and ${(del2.rowCount || 0) + (del3.rowCount || 0)} garbage index ticks for today.`);

    // 2. RESTORE accidentally deleted Yahoo data (2000 to 2002)
    console.log('Restoring deleted Yahoo Finance data (2000-03 to 2002-01)...');
    const { rows: stocks } = await client.query('SELECT "FinInstrmId", "TckrSymb" FROM company_stock');
    console.log(`Checking ${stocks.length} stocks for missing data...`);
    
    let restoredCount = 0;
    for (let i = 0; i < stocks.length; i++) {
      const stock = stocks[i];
      const symbol = stock.TckrSymb + '.NS';
      try {
        const result: any = await yahooFinance.historical(symbol, {
          period1: '2000-01-01',
          period2: '2002-03-01'
        }, { validateResult: false });
        
        if (!result || result.length === 0) continue;
        
        const cleanResult = result.filter((r: any) => r.close != null && r.open != null);
        if (cleanResult.length === 0) continue;
        
        for (const row of cleanResult) {
          await client.query(`
            INSERT INTO historical_prices 
            ("FinInstrmId", record_date, open_price, high_price, low_price, close_price, adj_close, volume)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT ("FinInstrmId", record_date) DO NOTHING
          `, [
            stock.FinInstrmId, row.date.toISOString(), row.open, row.high, row.low, row.close, row.adjClose || null, row.volume
          ]);
        }
        restoredCount++;
        if (restoredCount % 50 === 0) console.log(`Restored ${restoredCount} stocks...`);
      } catch (e) {
        // Ignore unlisted or delisted stocks
      }
    }
    console.log(`Successfully restored data for ${restoredCount} stocks!`);
  } finally {
    client.release();
    await pool.end();
  }
}
fix();
