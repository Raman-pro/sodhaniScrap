import { initDB } from './db/init';
import { seedIndices, indicesHistoryBackfill, indicesSync } from './services/indicesSync';
import dotenv from 'dotenv';

dotenv.config();

const INDICES_POLL_INTERVAL_MS = parseInt(process.env.INDICES_POLL_INTERVAL_MS || '600000', 10);

async function startIndicesPolling() {
  console.log(`Starting Indices Live Polling Loop every ${INDICES_POLL_INTERVAL_MS / 1000} seconds...`);

  // Run immediately first
  await indicesSync();

  // Then schedule
  setInterval(async () => {
    await indicesSync();
  }, INDICES_POLL_INTERVAL_MS);
}

async function main() {
  try {
    const skipStart = process.argv.includes('--skip_start');

    if (!skipStart) {
      console.log('Initializing DB for Indices Worker...');
      await initDB();
      await seedIndices();
      await indicesHistoryBackfill();
    } else {
      console.log('Skipping DB init, seed and history backfill for Indices Worker (--skip_start)');
    }

    startIndicesPolling();
  } catch (err) {
    console.error('Fatal error during indices worker initialization:', err);
    process.exit(1);
  }
}

main();
