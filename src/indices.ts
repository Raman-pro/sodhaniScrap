import { initDB } from './db/init';
import { seedIndices, indicesHistoryBackfill, indicesSync } from './services/indicesSync';
import { seedNseIndices, nseIndicesHistoryBackfill, nseIndicesLiveSync } from './services/nseIndicesSync';
import { bseIndexConstituentsSync } from './services/bseIndexConstituentsSync';
import dotenv from 'dotenv';

dotenv.config();

const INDICES_POLL_INTERVAL_MS = parseInt(process.env.INDICES_POLL_INTERVAL_MS || '600000', 10);
// Membership changes rarely; a 10-minute poll interval would otherwise mean
// ~460 BSE requests/hour for data that barely moves. Hourly still gives
// several mover-rotations a day.
const BSE_CONSTITUENTS_INTERVAL_MS = parseInt(process.env.BSE_CONSTITUENTS_INTERVAL_MS || '3600000', 10);
let lastBseConstituentsSync = 0;

async function maybeSyncBseConstituents() {
  const now = Date.now();
  if (now - lastBseConstituentsSync < BSE_CONSTITUENTS_INTERVAL_MS) return;
  lastBseConstituentsSync = now;
  await bseIndexConstituentsSync();
}

async function startIndicesPolling() {
  console.log(`Starting Indices Live Polling Loop every ${INDICES_POLL_INTERVAL_MS / 1000} seconds...`);

  // Run immediately first
  await indicesSync();
  await nseIndicesLiveSync();
  await maybeSyncBseConstituents();

  // Then schedule
  setInterval(async () => {
    await indicesSync();
    await nseIndicesLiveSync();
    await maybeSyncBseConstituents();
  }, INDICES_POLL_INTERVAL_MS);
}

async function main() {
  try {
    const skipStart = process.argv.includes('--skip_start');

    if (!skipStart) {
      console.log('Initializing DB for Indices Worker...');
      await initDB();
      await seedIndices();
      await seedNseIndices();
      await indicesHistoryBackfill();
      await nseIndicesHistoryBackfill();
      await bseIndexConstituentsSync();
      lastBseConstituentsSync = Date.now();
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
