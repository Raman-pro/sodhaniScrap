import { initDB } from './db/init';
import { bootstrapMasterList } from './services/bootstrap';
import { fetchHistoricalCatchup } from './services/yahooHistory';
import { bseLiveSync } from './services/bseLiveSync';
import { nseLiveSync } from './services/nseLiveSync';
import { fetchMarketState } from './utils/exchangeState';
import dotenv from 'dotenv';

dotenv.config();

const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '300000', 10);

let lastEodCatchupDate = '';

async function pollLiveSync() {
  const state = await fetchMarketState();
  
  // Calculate IST Time
  const now = new Date();
  const utcHour = now.getUTCHours();
  const utcMin = now.getUTCMinutes();
  const totalISTMinutes = (utcHour * 60 + utcMin) + (5 * 60 + 30);
  const istHour = Math.floor(totalISTMinutes / 60) % 24;
  const istMin = totalISTMinutes % 60;
  const todayStr = now.toISOString().split('T')[0];

  if (state.isOpen) {
    await bseLiveSync();
    await nseLiveSync();
  } else {
    console.log(`[Live Poller] ${state.message} (Trade Date: ${state.tradeDate}). Skipping live sync.`);
    
    // EOD Catch-up trigger at 16:30 IST or later
    if (istHour >= 16 && (istHour > 16 || istMin >= 30)) {
      if (lastEodCatchupDate !== todayStr) {
        console.log(`[EOD Catch-up] Triggering daily historical catchup for ${todayStr}...`);
        await fetchHistoricalCatchup();
        lastEodCatchupDate = todayStr;
      }
    }
  }
}

async function startLivePolling() {
  console.log(`Starting Phase 3 Live Polling Loop every ${POLL_INTERVAL_MS / 1000} seconds...`);
    
  // Run immediately first
  await pollLiveSync();
    
  // Then schedule
  setInterval(async () => {
    await pollLiveSync();
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
