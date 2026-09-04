import { pool } from '../db/pool';

async function fixDb() {
  const client = await pool.connect();
  try {
    console.log('Cleaning up duplicate Yahoo ticks...');
    
    // Step 1: Delete any wrongly timed Yahoo ticks IF a correct 00:00:00 Yahoo tick ALREADY exists for that same day.
    const delRes = await client.query(`
      DELETE FROM historical_prices hp1
      WHERE adj_close IS NOT NULL
        AND record_date != DATE(record_date)
        AND EXISTS (
            SELECT 1 FROM historical_prices hp2
            WHERE hp2."FinInstrmId" = hp1."FinInstrmId"
              AND hp2.record_date = DATE(hp1.record_date)
              AND hp2.adj_close IS NOT NULL
        )
    `);
    console.log('Deleted', delRes.rowCount, 'colliding duplicates');

    // Step 2: Now safely update the remaining wrongly timed Yahoo ticks to 00:00:00
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
