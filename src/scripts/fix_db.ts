import { pool } from '../db/pool';

async function fixDb() {
  const client = await pool.connect();
  try {
    console.log('Fetching broken Yahoo ticks to process...');
    
    // Step 1: Find all Yahoo EOD ticks that are wrongly timed
    const res = await client.query(`
      SELECT "FinInstrmId", 
             record_date as wrong_date, 
             DATE(record_date) as target_date
      FROM historical_prices
      WHERE adj_close IS NOT NULL 
        AND record_date != DATE(record_date)
    `);

    const rows = res.rows;
    console.log(`Found ${rows.length} Yahoo EOD ticks to fix. processing in batches...`);

    if (rows.length === 0) {
      console.log('Nothing to fix!');
      return;
    }

    let deleted = 0;
    let updated = 0;

    // Process in batches of 100 to avoid locking the database or hitting memory limits
    const BATCH_SIZE = 100;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      
      // 1. Delete the 00:00:00 collision targets for this batch
      const deleteConditions = batch.map(r => 
        `("FinInstrmId" = '${r.FinInstrmId}' AND record_date = '${r.target_date.toISOString()}')`
      ).join(' OR ');
      
      const delRes = await client.query(`
        DELETE FROM historical_prices 
        WHERE ${deleteConditions}
      `);
      deleted += delRes.rowCount || 0;

      // 2. Update the wrongly timed Yahoo ticks to 00:00:00 for this batch
      const updateConditions = batch.map(r => 
        `("FinInstrmId" = '${r.FinInstrmId}' AND record_date = '${r.wrong_date.toISOString()}')`
      ).join(' OR ');

      const updRes = await client.query(`
        UPDATE historical_prices 
        SET record_date = DATE(record_date)
        WHERE ${updateConditions}
      `);
      updated += updRes.rowCount || 0;

      // Print progress
      if ((i + BATCH_SIZE) % 500 === 0 || i + BATCH_SIZE >= rows.length) {
        console.log(`Progress: processed ${Math.min(i + BATCH_SIZE, rows.length)} / ${rows.length} ...`);
      }
    }

    console.log(`\nDone! Deleted ${deleted} placeholder ticks and Fixed ${updated} Yahoo EOD ticks.`);
    
  } catch (err) {
    console.error(err);
  } finally {
    client.release();
    pool.end();
  }
}

fixDb();
