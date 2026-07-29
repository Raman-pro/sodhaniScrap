import dotenv from 'dotenv';
dotenv.config();
import { bseLiveSync } from './src/services/bseLiveSync';
import { pool } from './src/db/pool';

async function main() {
  await bseLiveSync();
  
  const client = await pool.connect();
  const res = await client.query('SELECT * FROM historical_prices ORDER BY record_date DESC LIMIT 5');
  console.log('Sample of live synced rows:');
  console.table(res.rows);
  client.release();
  
  process.exit(0);
}

main();
