import { pool } from './db/pool';

async function clearMetrics() {
  const client = await pool.connect();
  try {
    await client.query('TRUNCATE stock_metrics;');
    console.log('Successfully cleared stock_metrics table.');
  } catch (err) {
    console.error('Failed to clear table:', err);
  } finally {
    client.release();
    pool.end();
  }
}

clearMetrics();
