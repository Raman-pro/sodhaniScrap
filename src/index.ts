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

// setInterval does not wait for an async callback, so a poll that outlasts
// POLL_INTERVAL_MS would otherwise be joined by another one every tick. The
// EOD catch-up covers every stock and takes hours; because lastEodCatchupDate
// is only set once it finishes, a new full copy used to start every 5 minutes
// (21 concurrent runs were seen on 2026-09-30), saturating the DB pool and disk.
let liveSyncInProgress = false;
let eodCatchupInProgress = false;

// Market has closed and the EOD window has opened: 16:30 IST or later.
function isPastEodCutoff(now: Date): boolean {
  const totalISTMinutes = (now.getUTCHours() * 60 + now.getUTCMinutes()) + (5 * 60 + 30);
  const istHour = Math.floor(totalISTMinutes / 60) % 24;
  const istMin = totalISTMinutes % 60;
  return istHour >= 16 && (istHour > 16 || istMin >= 30);
}

async function pollLiveSync() {
  const state = await fetchMarketState();
  
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];

  if (state.isOpen) {
    if (liveSyncInProgress) {
      console.log('[Live Poller] Previous live sync still running, skipping this tick.');
      return;
    }
    liveSyncInProgress = true;
    try {
      await bseLiveSync();
      await nseLiveSync();
    } finally {
      liveSyncInProgress = false;
    }
  } else {
    console.log(`[Live Poller] ${state.message} (Trade Date: ${state.tradeDate}). Skipping live sync.`);
    
    // EOD Catch-up trigger at 16:30 IST or later
    if (isPastEodCutoff(now) && lastEodCatchupDate !== todayStr) {
      if (eodCatchupInProgress) {
        console.log('[EOD Catch-up] Previous catch-up still running, not starting another.');
        return;
      }
      eodCatchupInProgress = true;
      try {
        console.log(`[EOD Catch-up] Triggering daily historical catchup for ${todayStr}...`);
        await fetchHistoricalCatchup();
        lastEodCatchupDate = todayStr;
      } finally {
        eodCatchupInProgress = false;
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
      // One that *starts* inside the EOD window already does today's EOD work,
      // so don't have the poller repeat it straight away. Judged by start time:
      // one begun mid-session and finishing after 16:30 may have missed the
      // final closes.
      const startedAt = new Date();
      const startedInEodWindow = isPastEodCutoff(startedAt);
      await fetchHistoricalCatchup();
      if (startedInEodWindow) {
        lastEodCatchupDate = startedAt.toISOString().split('T')[0];
      }
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
