import { initDB } from './db/init';
import { nseAnnouncementSync } from './services/nseAnnouncementSync';
import dotenv from 'dotenv';

dotenv.config();

const POLL_INTERVAL_MS = parseInt(process.env.NSE_ANNOUNCEMENTS_POLL_INTERVAL_MS || '600000', 10);

async function startPolling() {
  console.log(`Starting NSE Announcements Polling Loop every ${POLL_INTERVAL_MS / 1000} seconds...`);

  await nseAnnouncementSync();

  setInterval(async () => {
    await nseAnnouncementSync();
  }, POLL_INTERVAL_MS);
}

async function main() {
  try {
    const skipStart = process.argv.includes('--skip_start');
    if (!skipStart) {
      console.log('Initializing DB for NSE Announcements Worker...');
      await initDB();
    } else {
      console.log('Skipping DB init for NSE Announcements Worker (--skip_start)');
    }

    startPolling();
  } catch (err) {
    console.error('Fatal error during NSE announcements worker initialization:', err);
    process.exit(1);
  }
}

main();
