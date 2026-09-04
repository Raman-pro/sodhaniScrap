import { pool } from '../db/pool';

async function fixDb() {
  const client = await pool.connect();
  try {
    console.log('Clearing the path for Yahoo EOD ticks...');
    
    // Step 1: Find all Yahoo EOD ticks that are stuck at 09:15:00 (or any non-midnight time).
    // If a 00:00:00 tick ALREADY exists on that day (e.g., from the CSV bootstrap, which lacks adj_close),
    // we must DELETE the 00:00:00 tick first so that the Yahoo tick can take its place without a unique constraint error.
    const delRes = await client.query(`
      DELETE FROM historical_prices hp1
      USING (
        SELECT "FinInstrmId", DATE(record_date) as target_date
        FROM historical_prices
        WHERE adj_close IS NOT NULL AND record_date != DATE(record_date)
      ) hp2
      WHERE hp1."FinInstrmId" = hp2."FinInstrmId"
        AND hp1.record_date = hp2.target_date
    `);
    console.log('Deleted', delRes.rowCount, 'placeholder 00:00:00 ticks to make room');

    // Step 2: Now that the 00:00:00 slot is guaranteed to be empty, safely move the Yahoo ticks down to 00:00:00.
    const updRes = await client.query(`
      UPDATE historical_prices 
      SET record_date = DATE(record_date) 
      WHERE adj_close IS NOT NULL 
        AND record_date != DATE(record_date)
    `);
    console.log('Fixed', updRes.rowCount, 'Yahoo EOD ticks successfully!');
    
  } catch (err) {
    console.error(err);
  } finally {
    client.release();
    pool.end();
  }
}

fixDb();
