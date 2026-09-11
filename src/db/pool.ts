import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // historical_prices.record_date is TIMESTAMP (no zone) and the live syncs write
  // new Date().toISOString() into it, so rows hold UTC wall clock. Pin the session
  // timezone so CURRENT_DATE / DATE() agree with that; a session west of UTC would
  // shift every date-boundary comparison by a day.
  options: '-c timezone=UTC',
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});
