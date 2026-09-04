import { pool } from '../db/pool';

async function fixDb() {
  const client = await pool.connect();
  try {
    console.log('Fetching list of companies...');
    
    // Fetch just the 6,000 company IDs (virtually zero memory)
    const res = await client.query('SELECT "FinInstrmId", "TckrSymb" FROM company_stock');
    const companies = res.rows;
    
    console.log(`Found ${companies.length} companies. Processing one by one to use zero memory...`);

    let totalDeleted = 0;
    let totalUpdated = 0;

    for (let i = 0; i < companies.length; i++) {
      const c = companies[i];
      
      // 1. Delete collisions for THIS specific stock (extremely fast, operates on < 3000 rows)
      const delRes = await client.query(`
        DELETE FROM historical_prices hp1
        USING (
          SELECT "FinInstrmId", DATE(record_date) as target_date
          FROM historical_prices
          WHERE "FinInstrmId" = $1 AND adj_close IS NOT NULL AND record_date != DATE(record_date)
        ) hp2
        WHERE hp1."FinInstrmId" = hp2."FinInstrmId"
          AND hp1.record_date = hp2.target_date
      `, [c.FinInstrmId]);
      totalDeleted += delRes.rowCount || 0;

      // 2. Update THIS specific stock
      const updRes = await client.query(`
        UPDATE historical_prices 
        SET record_date = DATE(record_date)
        WHERE "FinInstrmId" = $1 AND adj_close IS NOT NULL AND record_date != DATE(record_date)
      `, [c.FinInstrmId]);
      totalUpdated += updRes.rowCount || 0;

      // Print progress
      if ((i + 1) % 500 === 0 || i + 1 === companies.length) {
        console.log(`Progress: Processed ${i + 1} / ${companies.length} companies...`);
      }
    }

    console.log(`\nDone! Deleted ${totalDeleted} placeholder ticks and Fixed ${totalUpdated} Yahoo EOD ticks.`);
    
  } catch (err) {
    console.error(err);
  } finally {
    client.release();
    pool.end();
  }
}

fixDb();
