import { initDB } from './db/init';
import { bootstrapMasterList } from './services/bootstrap';
import { fetchHistoricalCatchup } from './services/yahooHistory';
import { bseLiveSync } from './services/bseLiveSync';
import dotenv from 'dotenv';

dotenv.config();

const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '300000', 10);

async function startLivePolling() {
  console.log(`Starting Phase 3 Live Polling Loop every ${POLL_INTERVAL_MS / 1000} seconds...`);
    
  // Run immediately first
  await bseLiveSync();
    
  // Then schedule
  setInterval(async () => {
    await bseLiveSync();
  }, POLL_INTERVAL_MS);
}

async function main() {
  try {
    const skipStart = process.argv.includes('--skip_start');

    if (!skipStart) {
      console.log('Starting Market Data Ingestion Pipeline...');

      // Phase 1: Bootstrapping & Schema Verification
      await initDB();
      await bootstrapMasterList();

      // Phase 2: Historical Catch-Up (Yahoo Finance Sync)
      await fetchHistoricalCatchup();
    } else {
      console.log('--- SKIP START DETECTED ---');
      console.log('Skipping Phase 1 (Bootstrap) and Phase 2 (Historical Catch-up).');
    }
    
    // Phase 3: The Live Updation Loop (BSE Polling)
    startLivePolling();
  } catch (err) {
    console.error('Fatal error during initialization:', err);
    process.exit(1);
  }
}

main();
