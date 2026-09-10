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
  console.log('--- Starting Real-Time Exchange Sync & Quote Verification ---');

  console.log('\n--- Syncing BSE equities (BSE-only previous closes) ---');
  try {
    await bseLiveSync();
  } catch (e: any) {
    console.error('BSE sync error:', e.message);
  }

  console.log('\n--- Syncing NSE equities (NSE official previous closes) ---');
  try {
    await nseLiveSync();
  } catch (e: any) {
    console.error('NSE sync error:', e.message);
  }

  console.log('\n--- Final Verification ---');
  const verifyClient = await pool.connect();
  try {
    await verifyQuote(verifyClient, '509820', 'HUHTAMAKI');
    await verifyQuote(verifyClient, '532540', 'TCS');
    await verifyQuote(verifyClient, 'SHETHJI', 'SHETHJI');
  } finally {
    verifyClient.release();
  }

  console.log('\n--- Done! ---');
  process.exit(0);
}

main();
