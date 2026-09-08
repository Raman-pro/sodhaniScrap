import { pool } from '../db/pool';
import { nseLiveSync } from '../services/nseLiveSync';
import { bseLiveSync } from '../services/bseLiveSync';

async function verifyQuote(client: any, finId: string, label: string) {
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
    const changeVal = latestPrice - prevClose;
    const changePercent = prevClose ? ((latestPrice - prevClose) / prevClose) * 100 : 0;
    console.log(`[Verification] ${label} (${finId}): Latest = ${latestPrice}, PrevClose = ${prevClose}, Change = ${changeVal.toFixed(2)}, ChangePercent = ${changePercent.toFixed(2)}%`);
  }
}

async function main() {
  console.log('--- Starting Previous Close Fix & Exchange Sync ---');
  const client = await pool.connect();

  try {
    // 1. Explicitly fix SHETHJI (205.10)
    console.log('Fixing SHETHJI previous close (205.10)...');
    const shethjiRes = await client.query(`
      SELECT MAX(DATE(record_date)) as prev_date 
      FROM historical_prices 
      WHERE "FinInstrmId" = 'SHETHJI' AND DATE(record_date) < CURRENT_DATE
    `);
    const shethjiPrevDate = shethjiRes.rows[0]?.prev_date 
      ? new Date(shethjiRes.rows[0].prev_date).toISOString().slice(0, 10)
      : '2026-09-07';

    await client.query(`
      INSERT INTO historical_prices 
        ("FinInstrmId", record_date, open_price, high_price, low_price, close_price, adj_close, volume)
      VALUES 
        ('SHETHJI', $1::timestamp, 205.10, 205.10, 205.10, 205.10, 205.10, 0)
      ON CONFLICT ("FinInstrmId", record_date) 
      DO UPDATE SET 
        close_price = 205.10,
        adj_close = 205.10;
    `, [`${shethjiPrevDate} 00:00:00`]);

    // 2. Explicitly fix TCS / 532540 (2270.00)
    console.log('Fixing TCS (532540) previous close (2270.00)...');
    const tcsRes = await client.query(`
      SELECT MAX(DATE(record_date)) as prev_date 
      FROM historical_prices 
      WHERE "FinInstrmId" = '532540' AND DATE(record_date) < CURRENT_DATE
    `);
    const tcsPrevDate = tcsRes.rows[0]?.prev_date 
      ? new Date(tcsRes.rows[0].prev_date).toISOString().slice(0, 10)
      : '2026-09-07';

    await client.query(`
      INSERT INTO historical_prices 
        ("FinInstrmId", record_date, open_price, high_price, low_price, close_price, adj_close, volume)
      VALUES 
        ('532540', $1::timestamp, 2270.00, 2270.00, 2270.00, 2270.00, 2270.00, 0)
      ON CONFLICT ("FinInstrmId", record_date) 
      DO UPDATE SET 
        close_price = 2270.00,
        adj_close = 2270.00;
    `, [`${tcsPrevDate} 00:00:00`]);

    // Initial check
    await verifyQuote(client, 'SHETHJI', 'SHETHJI');
    await verifyQuote(client, '532540', 'TCS');

  } catch (err: any) {
    console.error('Error during explicit fixes:', err.message);
  } finally {
    client.release();
  }

  // 3. Trigger BSE Live Sync first (which now skips dual-listed/NSE stocks)
  console.log('\n--- Syncing BSE equities (BSE-only previous closes) ---');
  try {
    await bseLiveSync();
  } catch (e: any) {
    console.error('BSE sync error:', e.message);
  }

  // 4. Trigger NSE Live Sync (which syncs official NSE previous closes for all dual-listed & NSE stocks)
  console.log('\n--- Syncing NSE equities (NSE official previous closes) ---');
  try {
    await nseLiveSync();
  } catch (e: any) {
    console.error('NSE sync error:', e.message);
  }

  // 5. Final Verification
  console.log('\n--- Final Verification ---');
  const verifyClient = await pool.connect();
  try {
    await verifyQuote(verifyClient, 'SHETHJI', 'SHETHJI');
    await verifyQuote(verifyClient, '532540', 'TCS');
  } finally {
    verifyClient.release();
  }

  console.log('\n--- Done! ---');
  process.exit(0);
}

main();
