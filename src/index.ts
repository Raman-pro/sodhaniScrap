import { initDB } from './db/init';
import { bootstrapMasterList } from './services/bootstrap';
import { fetchHistoricalCatchup } from './services/yahooHistory';
import { bseLiveSync } from './services/bseLiveSync';
import { nseLiveSync } from './services/nseLiveSync';
import dotenv from 'dotenv';

dotenv.config();

const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '300000', 10);

function isMarketOpen() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
    hour12: false
  }).formatToParts(new Date());

  const hours = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
  const minutes = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
  const weekday = parts.find(p => p.type === 'weekday')?.value || '';

  if (weekday === 'Sun' || weekday === 'Sat') return false;
  
  const timeNum = hours * 100 + minutes;
  // 915 to 1530
  return timeNum >= 915 && timeNum <= 1530;
}

async function startLivePolling() {
  console.log(`Starting Phase 3 Live Polling Loop every ${POLL_INTERVAL_MS / 1000} seconds...`);
    
  // Run immediately first
  if (isMarketOpen()) {
    await bseLiveSync();
    await nseLiveSync();
  }
    
  // Then schedule
  setInterval(async () => {
    if (isMarketOpen()) {
      await bseLiveSync();
      await nseLiveSync();
    } else {
      console.log('Market is closed (IST). Skipping live sync.');
    }
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
