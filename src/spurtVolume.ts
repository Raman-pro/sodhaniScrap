import { initDB } from './db/init';
import { spurtVolumeSync } from './services/spurtVolumeSync';
import dotenv from 'dotenv';

dotenv.config();

const SPURT_VOLUME_POLL_INTERVAL_MS = parseInt(process.env.SPURT_VOLUME_POLL_INTERVAL_MS || '600000', 10);

async function startSpurtVolumePolling() {
  console.log(`Starting Spurt Volume Polling Loop every ${SPURT_VOLUME_POLL_INTERVAL_MS / 1000} seconds...`);
  
  // Run immediately first
  await spurtVolumeSync();
  
  // Then schedule
  setInterval(async () => {
    await spurtVolumeSync();
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
