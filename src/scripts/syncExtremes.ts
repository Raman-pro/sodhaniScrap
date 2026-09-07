import { pool } from '../db/pool';
import { initDB } from '../db/init';
import { syncAllPriceExtremes } from '../services/priceExtremesService';

async function main() {
  console.log('Ensuring database schema is up to date...');
  await initDB();

  console.log('Calculating and populating company_price_extremes for all stocks in database...');
  const client = await pool.connect();
  try {
    const count = await syncAllPriceExtremes(client);
    console.log(`Successfully populated company_price_extremes for ${count} companies.`);
  } catch (err: any) {
    console.error('Error syncing price extremes:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
