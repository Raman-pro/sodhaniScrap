import { pool } from '../db/pool';

async function fixDb() {
  const client = await pool.connect();
  try {
    console.log('Fetching list of companies...');
    
    const res = await client.query('SELECT "FinInstrmId", "TckrSymb" FROM company_stock');
    const companies = res.rows;
    
    console.log(`Found ${companies.length} companies. Processing one by one...`);

    let totalFixed = 0;

    for (let i = 0; i < companies.length; i++) {
      const c = companies[i];
      
      // Step 1: Securely copy the rich Yahoo data down to 00:00:00.
      // Using DISTINCT ON prevents the "cannot affect row a second time" error 
      // if multiple broken ticks accidentally accumulated on the exact same date!
      const insertRes = await client.query(`
        INSERT INTO historical_prices ("FinInstrmId", record_date, open_price, high_price, low_price, close_price, adj_close, volume)
        SELECT DISTINCT ON ("FinInstrmId", DATE(record_date))
               "FinInstrmId", DATE(record_date), open_price, high_price, low_price, close_price, adj_close, volume
        FROM historical_prices
        WHERE "FinInstrmId" = $1 AND adj_close IS NOT NULL AND record_date != DATE(record_date)
        ORDER BY "FinInstrmId", DATE(record_date), record_date DESC
        ON CONFLICT ("FinInstrmId", record_date)
        DO UPDATE SET
          open_price = EXCLUDED.open_price,
          high_price = EXCLUDED.high_price,
          low_price = EXCLUDED.low_price,
          close_price = EXCLUDED.close_price,
          adj_close = EXCLUDED.adj_close,
          volume = EXCLUDED.volume
      `, [c.FinInstrmId]);

      // Step 2: Now that the rich Yahoo data is safely secured at 00:00, we delete ALL orphaned non-midnight ticks!
      if ((insertRes.rowCount || 0) > 0) {
        await client.query(`
          DELETE FROM historical_prices 
          WHERE "FinInstrmId" = $1 AND adj_close IS NOT NULL AND record_date != DATE(record_date)
        `, [c.FinInstrmId]);
        totalFixed += insertRes.rowCount || 0;
      }

      if ((i + 1) % 500 === 0 || i + 1 === companies.length) {
        console.log(`Progress: Processed ${i + 1} / ${companies.length} companies...`);
      }
    }

    console.log(`\nDone! Successfully secured and fixed ${totalFixed} Yahoo EOD ticks.`);
    
  } catch (err) {
    console.error(err);
  } finally {
    client.release();
    pool.end();
  }
}

fixDb();
