import { pool } from '../db/pool';

async function run() {
  const client = await pool.connect();
  try {
    console.log('Fetching all today ticks from historical_prices...');
    
    // 1. Delete ticks outside 03:45 to 10:00 UTC, BUT protect exactly 00:00 (Yahoo EOD ticks)
    const res1 = await client.query(`
      DELETE FROM historical_prices 
      WHERE (EXTRACT(HOUR FROM record_date) * 100 + EXTRACT(MINUTE FROM record_date) NOT BETWEEN 345 AND 1000)
        AND (EXTRACT(HOUR FROM record_date) * 100 + EXTRACT(MINUTE FROM record_date) != 0)
    `);
    
    // 2. Delete ticks that are in the physical future relative to the current actual UTC time
    const res2 = await client.query(`
      DELETE FROM historical_prices 
      WHERE DATE(record_date) = CURRENT_DATE 
        AND (EXTRACT(HOUR FROM record_date) * 60 + EXTRACT(MINUTE FROM record_date)) > (EXTRACT(HOUR FROM CURRENT_TIMESTAMP AT TIME ZONE 'UTC') * 60 + EXTRACT(MINUTE FROM CURRENT_TIMESTAMP AT TIME ZONE 'UTC'))
    `);
    
    console.log(`Deleted ${(res1.rowCount||0) + (res2.rowCount||0)} bad stock ticks based on exact native SQL parsing.`);

    // BSE Indices
    const resBse1 = await client.query(`
      DELETE FROM bse_index_history 
      WHERE (EXTRACT(HOUR FROM record_time) * 100 + EXTRACT(MINUTE FROM record_time) NOT BETWEEN 345 AND 1000)
        AND (EXTRACT(HOUR FROM record_time) * 100 + EXTRACT(MINUTE FROM record_time) != 0)
    `);
    const resBse2 = await client.query(`
      DELETE FROM bse_index_history 
      WHERE DATE(record_time) = CURRENT_DATE 
        AND (EXTRACT(HOUR FROM record_time) * 60 + EXTRACT(MINUTE FROM record_time)) > (EXTRACT(HOUR FROM CURRENT_TIMESTAMP AT TIME ZONE 'UTC') * 60 + EXTRACT(MINUTE FROM CURRENT_TIMESTAMP AT TIME ZONE 'UTC'))
    `);

    // NSE Indices
    const resNse1 = await client.query(`
      DELETE FROM nse_index_history 
      WHERE (EXTRACT(HOUR FROM record_time) * 100 + EXTRACT(MINUTE FROM record_time) NOT BETWEEN 345 AND 1000)
        AND (EXTRACT(HOUR FROM record_time) * 100 + EXTRACT(MINUTE FROM record_time) != 0)
    `);
    const resNse2 = await client.query(`
      DELETE FROM nse_index_history 
      WHERE DATE(record_time) = CURRENT_DATE 
        AND (EXTRACT(HOUR FROM record_time) * 60 + EXTRACT(MINUTE FROM record_time)) > (EXTRACT(HOUR FROM CURRENT_TIMESTAMP AT TIME ZONE 'UTC') * 60 + EXTRACT(MINUTE FROM CURRENT_TIMESTAMP AT TIME ZONE 'UTC'))
    `);
    
    console.log(`Deleted ${(resBse1.rowCount||0) + (resBse2.rowCount||0) + (resNse1.rowCount||0) + (resNse2.rowCount||0)} bad index ticks.`);
  } catch (err) {
    console.error(err);
  } finally {
    client.release();
    await pool.end();
  }
}
run();