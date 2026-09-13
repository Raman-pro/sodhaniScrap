import { initDB } from './db/init';
import { spurtVolumeSync } from './services/spurtVolumeSync';
import { fetchMarketState } from './utils/exchangeState';
import dotenv from 'dotenv';

dotenv.config();

const SPURT_VOLUME_POLL_INTERVAL_MS = parseInt(process.env.SPURT_VOLUME_POLL_INTERVAL_MS || '600000', 10);

async function pollSpurtVolume() {
  const state = await fetchMarketState();
  if (state.isOpen) {
    await spurtVolumeSync();
  } else {
    console.log(`[Spurt Volume Poller] ${state.message} (Trade Date: ${state.tradeDate}). Skipping spurt volume sync.`);
  }
}

async function startSpurtVolumePolling() {
  console.log(`Starting Spurt Volume Polling Loop every ${SPURT_VOLUME_POLL_INTERVAL_MS / 1000} seconds...`);
  
  // Run immediately first
  await pollSpurtVolume();
  
  // Then schedule
  setInterval(async () => {
    await pollSpurtVolume();
  }, SPURT_VOLUME_POLL_INTERVAL_MS);
}

async function main() {
  try {
    const skipStart = process.argv.includes('--skip_start');
    if (!skipStart) {
        console.log('Initializing DB for Spurt Volume Worker...');
        await initDB();
    } else {
        console.log('Skipping DB init for Spurt Volume Worker (--skip_start)');
    }
    
    startSpurtVolumePolling();
  } catch (err) {
    console.error('Fatal error during spurt volume worker initialization:', err);
    process.exit(1);
  }
}

main();
