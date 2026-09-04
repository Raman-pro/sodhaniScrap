import { pool } from '../db/pool';

async function fixDb() {
  const client = await pool.connect();
  try {
    console.log('Cleaning up duplicate Yahoo ticks (fast mode)...');
    
    // Use a hash join instead of a correlated subquery to make it instant on 3.6 million rows
    const delRes = await client.query(`
      DELETE FROM historical_prices hp1
      USING (
        SELECT "FinInstrmId", record_date
        FROM historical_prices
        WHERE adj_close IS NOT NULL AND record_date = DATE(record_date)
      ) hp2
      WHERE hp1."FinInstrmId" = hp2."FinInstrmId"
        AND DATE(hp1.record_date) = hp2.record_date
        AND hp1.adj_close IS NOT NULL
        AND hp1.record_date != DATE(hp1.record_date)
    `);
    console.log('Deleted', delRes.rowCount, 'colliding duplicates');

    const updRes = await client.query(`
      UPDATE historical_prices 
      SET record_date = DATE(record_date) 
      WHERE adj_close IS NOT NULL 
        AND record_date != DATE(record_date)
    `);
    console.log('Fixed', updRes.rowCount, 'Yahoo EOD ticks');
    
  } catch (err) {
    console.error(err);
  } finally {
    client.release();
    pool.end();
  }
}

fixDb();
