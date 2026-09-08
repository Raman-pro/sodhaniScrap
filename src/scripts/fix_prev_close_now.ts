import { pool } from '../db/pool';
import { nseLiveSync } from '../services/nseLiveSync';
import { bseLiveSync } from '../services/bseLiveSync';

async function main() {
  console.log('--- Starting One-Time Previous Close Fix & Sync ---');
  const client = await pool.connect();

  try {
    // 1. Locate SHETHJI in company_stock
    const csRes = await client.query(`
      SELECT "FinInstrmId", "TckrSymb" 
      FROM company_stock 
      WHERE "FinInstrmId" ILIKE '%SHETHJI%' OR "TckrSymb" ILIKE '%SHETHJI%'
    `);
    console.log('Matching stocks for SHETHJI:', csRes.rows);

    const finIds = csRes.rows.length > 0 ? csRes.rows.map(r => r.FinInstrmId) : ['SHETHJI'];

    for (const finId of finIds) {
      // Find latest trading day before today
      const dateRes = await client.query(`
        SELECT MAX(DATE(record_date)) as prev_date 
        FROM historical_prices 
        WHERE "FinInstrmId" = $1 AND DATE(record_date) < CURRENT_DATE
      `, [finId]);

      const prevDate = dateRes.rows[0]?.prev_date 
        ? new Date(dateRes.rows[0].prev_date).toISOString().slice(0, 10)
        : '2026-09-07';

      console.log(`Setting official previous close 205.10 for ${finId} on ${prevDate} 00:00:00...`);

      await client.query(`
        INSERT INTO historical_prices 
          ("FinInstrmId", record_date, open_price, high_price, low_price, close_price, adj_close, volume)
        VALUES 
          ($1, $2::timestamp, 205.10, 205.10, 205.10, 205.10, 205.10, 0)
        ON CONFLICT ("FinInstrmId", record_date) 
        DO UPDATE SET 
          close_price = 205.10,
          adj_close = 205.10,
          open_price = COALESCE(historical_prices.open_price, 205.10),
          high_price = GREATEST(historical_prices.high_price, 205.10),
          low_price = LEAST(historical_prices.low_price, 205.10);
      `, [finId, `${prevDate} 00:00:00`]);

      // Query verification using same logic as api/quote/:symbol
      const verifyRes = await client.query(`
        SELECT 
          hp.record_date, 
          hp.close_price as latest_price,
          (
            SELECT hp2.close_price
            FROM historical_prices hp2
            WHERE hp2."FinInstrmId" = hp."FinInstrmId"
              AND DATE(hp2.record_date) < DATE(hp.record_date)
            ORDER BY DATE(hp2.record_date) DESC,
                     CASE WHEN EXTRACT(HOUR FROM hp2.record_date) = 0 AND EXTRACT(MINUTE FROM hp2.record_date) = 0 THEN 1 ELSE 0 END DESC,
                     hp2.record_date DESC
            LIMIT 1
          ) AS "PrevClosePric"
        FROM historical_prices hp
        WHERE hp."FinInstrmId" = $1
        ORDER BY hp.record_date DESC
        LIMIT 1
      `, [finId]);

      if (verifyRes.rows.length > 0) {
        const row = verifyRes.rows[0];
        const latestPrice = Number(row.latest_price);
        const prevClose = Number(row.PrevClosePric);
        const changePercent = prevClose ? ((latestPrice - prevClose) / prevClose) * 100 : 0;
        console.log(`[Verification] ${finId}: Latest = ${latestPrice}, PrevClose = ${prevClose}, ChangePercent = ${changePercent.toFixed(2)}%`);
      }
    }
  } catch (err: any) {
    console.error('Error during SHETHJI fix:', err.message);
  } finally {
    client.release();
  }

  // 2. Trigger full NSE & BSE live sync to backfill all active exchange stocks
  console.log('\n--- Syncing all other equities via live feeds ---');
  try {
    await nseLiveSync();
  } catch (e: any) {
    console.error('NSE sync error:', e.message);
  }

  try {
    await bseLiveSync();
  } catch (e: any) {
    console.error('BSE sync error:', e.message);
  }

  console.log('\n--- Done! ---');
  process.exit(0);
}

main();
