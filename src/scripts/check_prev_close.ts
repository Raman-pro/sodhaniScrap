import { pool } from '../db/pool';

async function run() {
  const client = await pool.connect();
  try {
    const res = await client.query(`
      SELECT hp2.record_date, hp2.close_price, hp2.adj_close
      FROM historical_prices hp2
      WHERE hp2."FinInstrmId" = '500510' AND DATE(hp2.record_date) <= '2026-09-03'
      ORDER BY 
          DATE(hp2.record_date) DESC,
          CASE WHEN EXTRACT(HOUR FROM hp2.record_date) = 0 AND EXTRACT(MINUTE FROM hp2.record_date) = 0 THEN 1 ELSE 0 END DESC,
          hp2.record_date DESC
      LIMIT 10
    `);
    console.table(res.rows);
  } finally {
    client.release();
    pool.end();
  }
}
run();
