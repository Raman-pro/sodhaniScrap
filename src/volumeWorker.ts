import dotenv from 'dotenv';
import { initDB } from './db/init';
import {
  syncVolumesForDate,
  getIstDateDetails,
  isVolumeSyncedForDate
} from './services/volumeSync';

dotenv.config();

const VOLUME_POLL_INTERVAL_MS = parseInt(process.env.VOLUME_POLL_INTERVAL_MS || '900000', 10); // 15 mins

/**
 * Returns the most recent completed trading day (skipping weekends).
 * If today is a weekday and current time >= 17:30 IST, returns today.
 * Otherwise returns the preceding weekday (e.g. Friday if run on Sunday/Monday morning).
 */
export function getLatestTradingDay(refDate: Date = new Date()): Date {
  const ist = getIstDateDetails(refDate);
  const isWeekday = ist.weekday !== 'Sat' && ist.weekday !== 'Sun';
  const isPastEod = ist.hours > 17 || (ist.hours === 17 && ist.minutes >= 30);

  if (isWeekday && isPastEod) {
    return refDate;
  }

  // Roll back day by day to find previous completed weekday
  const d = new Date(refDate.getTime());
  let steps = 0;
  while (steps < 7) {
    d.setDate(d.getDate() - 1);
    const prevIst = getIstDateDetails(d);
    if (prevIst.weekday !== 'Sat' && prevIst.weekday !== 'Sun') {
      return d;
    }
    steps++;
  }
  return d;
}

/**
 * Checks if current IST time falls within the Bhavcopy publication window (17:30 - 20:30 IST on weekdays)
 */
function isBhavcopyWindow(refDate: Date = new Date()): boolean {
  const ist = getIstDateDetails(refDate);
  if (ist.weekday === 'Sat' || ist.weekday === 'Sun') return false;

  const timeNum = ist.hours * 100 + ist.minutes;
  // 1730 to 2030 (5:30 PM to 8:30 PM IST)
  return timeNum >= 1730 && timeNum <= 2030;
}

async function runPeriodicCheck(force: boolean = false) {
  const now = new Date();
  const ist = getIstDateDetails(now);
  console.log(`\n[Volume Worker] Heartbeat check at ${ist.dateStr} ${ist.hours.toString().padStart(2, '0')}:${ist.minutes.toString().padStart(2, '0')} IST (${ist.weekday})`);

  // 1. Check if today is a weekday and we are in or past the Bhavcopy window
  const isWeekday = ist.weekday !== 'Sat' && ist.weekday !== 'Sun';
  const isPastOpen = ist.hours > 17 || (ist.hours === 17 && ist.minutes >= 30);

  if (isWeekday && isPastOpen) {
    const todaySync = await isVolumeSyncedForDate(ist.dateStr);
    if (force || !todaySync.bse || !todaySync.nse) {
      console.log(`[Volume Worker] Syncing today's Bhavcopy (${ist.dateStr})...`);
      const res = await syncVolumesForDate(now, { force });
      console.log(`[Volume Worker] Today sync results: BSE=${res.bse.success ? `${res.bse.count} rows` : res.bse.error}, NSE=${res.nse.success ? `${res.nse.count} rows` : res.nse.error}`);
      return;
    } else {
      console.log(`[Volume Worker] Today's Bhavcopy (${ist.dateStr}) is already fully synced.`);
    }
  }

  // 2. If today is not ready or it's weekend/pre-market, check if the latest completed trading day is synced
  const latestTradingDay = getLatestTradingDay(now);
  const latestIst = getIstDateDetails(latestTradingDay);
  const latestSync = await isVolumeSyncedForDate(latestIst.dateStr);

  if (force || !latestSync.bse || !latestSync.nse) {
    console.log(`[Volume Worker] Latest completed trading day (${latestIst.dateStr}) missing Bhavcopy data. Ingesting catch-up...`);
    const res = await syncVolumesForDate(latestTradingDay, { force });
    console.log(`[Volume Worker] Catch-up sync results: BSE=${res.bse.success ? `${res.bse.count} rows` : res.bse.error}, NSE=${res.nse.success ? `${res.nse.count} rows` : res.nse.error}`);
  } else {
    console.log(`[Volume Worker] Latest completed trading day (${latestIst.dateStr}) is verified and synced.`);
  }
}

async function startVolumePolling(force: boolean = false) {
  console.log(`Starting Bhavcopy Volume Polling Loop every ${VOLUME_POLL_INTERVAL_MS / 1000} seconds...`);
  
  // Run immediately on boot
  await runPeriodicCheck(force);

  // Scheduled interval
  setInterval(async () => {
    try {
      await runPeriodicCheck(false);
    } catch (err) {
      console.error('[Volume Worker] Error during periodic polling cycle:', err);
    }
  }, VOLUME_POLL_INTERVAL_MS);
}

async function main() {
  try {
    const args = process.argv.slice(2);
    const skipStart = args.includes('--skip_start');
    const force = args.includes('--force');

    // Check if a specific date was requested via --date YYYY-MM-DD
    const dateArgIdx = args.indexOf('--date');
    const customDateStr = dateArgIdx !== -1 && args[dateArgIdx + 1] ? args[dateArgIdx + 1] : null;

    if (!skipStart) {
      console.log('Initializing DB for Volume Worker...');
      await initDB();
    } else {
      console.log('Skipping DB init for Volume Worker (--skip_start)');
    }

    if (customDateStr) {
      console.log(`Running one-off volume sync for specified date: ${customDateStr}`);
      const targetDate = new Date(`${customDateStr}T12:00:00Z`);
      const res = await syncVolumesForDate(targetDate, { force });
      console.log(`Completed volume sync for ${customDateStr}:`, res);
      process.exit(0);
    }

    startVolumePolling(force);
  } catch (err) {
    console.error('Fatal error during Volume Worker initialization:', err);
    process.exit(1);
  }
}

main();
