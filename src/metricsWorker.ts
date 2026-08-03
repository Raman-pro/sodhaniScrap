import { initDB } from './db/init';
import { metricsSync } from './services/metricsSync';
import dotenv from 'dotenv';

dotenv.config();

function scheduleDailySync() {
  const now = new Date();
  const target = new Date();
  
  // Set to 21:00 (9:00 PM) local time
  target.setHours(21, 0, 0, 0);

  // If it's already past 9:00 PM today, schedule for 9:00 PM tomorrow
  if (now.getTime() >= target.getTime()) {
    target.setDate(target.getDate() + 1);
  }

  const msUntilTarget = target.getTime() - now.getTime();
  const hoursUntil = (msUntilTarget / (1000 * 60 * 60)).toFixed(2);
  
  console.log(`Next metrics sync scheduled for ${target.toLocaleString()} (in ${hoursUntil} hours)`);

  setTimeout(async () => {
    try {
      console.log(`[${new Date().toLocaleString()}] Triggering scheduled metrics sync...`);
      await metricsSync();
    } catch (err) {
      console.error('Error during scheduled metrics sync:', err);
    } finally {
      // Schedule the next one for the following day
      scheduleDailySync();
    }
  }, msUntilTarget);
}

async function main() {
  try {
    const skipStart = process.argv.includes('--skip_start');
    if (!skipStart) {
        console.log('Initializing DB for Metrics Worker...');
        await initDB();
    } else {
        console.log('Skipping DB init for Metrics Worker (--skip_start)');
    }
    
    // Always run it once on startup to populate immediately, then schedule
    console.log(`[${new Date().toLocaleString()}] Running initial metrics sync on startup...`);
    await metricsSync();
    
    scheduleDailySync();
  } catch (err) {
    console.error('Fatal error during metrics worker initialization:', err);
    process.exit(1);
  }
}

main();
