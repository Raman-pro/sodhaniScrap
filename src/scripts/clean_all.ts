import { pool } from '../db/pool';

async function run() {
  const client = await pool.connect();
  try {
    console.log('Fetching all today ticks from historical_prices...');
    const { rows } = await client.query(`
      SELECT "FinInstrmId", record_date 
      FROM historical_prices 
      WHERE DATE(record_date) >= CURRENT_DATE - INTERVAL '1 day'
    `);
    
    let deletedStocks = 0;
    for (const row of rows) {
      const d = new Date(row.record_date);
      const utcHour = d.getUTCHours();
      const utcMin = d.getUTCMinutes();
      const timeNum = utcHour * 100 + utcMin;
      
      // Keep only 03:45 to 10:00 UTC
      if (timeNum < 345 || timeNum > 1000) {
        await client.query(`
          DELETE FROM historical_prices 
          WHERE "FinInstrmId" = $1 AND record_date = $2
        `, [row.FinInstrmId, row.record_date]);
        deletedStocks++;
      }
    }
    console.log(`Deleted ${deletedStocks} bad stock ticks based on exact Node UTC parsing.`);

    // BSE Indices
    const { rows: bseRows } = await client.query(`
      SELECT sccode, record_time 
      FROM bse_index_history 
      WHERE DATE(record_time) >= CURRENT_DATE - INTERVAL '1 day'
    `);
    let deletedBse = 0;
    for (const row of bseRows) {
      const d = new Date(row.record_time);
      const timeNum = d.getUTCHours() * 100 + d.getUTCMinutes();
      if (timeNum < 345 || timeNum > 1000) {
        await client.query(`DELETE FROM bse_index_history WHERE sccode = $1 AND record_time = $2`, [row.sccode, row.record_time]);
        deletedBse++;
      }
    }

    // NSE Indices
    const { rows: nseRows } = await client.query(`
      SELECT symbol, record_time 
      FROM nse_index_history 
      WHERE DATE(record_time) >= CURRENT_DATE - INTERVAL '1 day'
    `);
    let deletedNse = 0;
    for (const row of nseRows) {
      const d = new Date(row.record_time);
      const timeNum = d.getUTCHours() * 100 + d.getUTCMinutes();
      if (timeNum < 345 || timeNum > 1000) {
        await client.query(`DELETE FROM nse_index_history WHERE symbol = $1 AND record_time = $2`, [row.symbol, row.record_time]);
        deletedNse++;
      }
    }
    
    console.log(`Deleted ${deletedBse + deletedNse} bad index ticks.`);
  } catch (err) {
    console.error(err);
  } finally {
    client.release();
    await pool.end();
  }
}
run();
