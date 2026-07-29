import { initDB } from './db/init';
import { announcementSync } from './services/announcementSync';
import dotenv from 'dotenv';

dotenv.config();

const ANNOUNCEMENTS_POLL_INTERVAL_MS = parseInt(process.env.ANNOUNCEMENTS_POLL_INTERVAL_MS || '600000', 10);

async function startAnnouncementsPolling() {
  console.log(`Starting Announcements Polling Loop every ${ANNOUNCEMENTS_POLL_INTERVAL_MS / 1000} seconds...`);
  
  // Run immediately first
  await announcementSync();
  
  // Then schedule
  setInterval(async () => {
    await announcementSync();
  }, ANNOUNCEMENTS_POLL_INTERVAL_MS);
}

async function main() {
  try {
    const skipStart = process.argv.includes('--skip_start');
    if (!skipStart) {
        console.log('Initializing DB for Announcements Worker...');
        await initDB();
    } else {
        console.log('Skipping DB init for Announcements Worker (--skip_start)');
    }
    
    startAnnouncementsPolling();
  } catch (err) {
    console.error('Fatal error during announcements worker initialization:', err);
    process.exit(1);
  }
}

main();
