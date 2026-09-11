// One-off entrypoint for a scheduled extra metrics sync (e.g. a 6 AM IST run
// alongside the existing 9 PM daily sync in metricsWorker.ts). Unlike
// metricsWorker.ts, this does NOT call scheduleDailySync() - it runs
// metricsSync() once and exits, so it's safe to trigger from a systemd
// oneshot service + timer without leaving a second long-lived process behind.
import { initDB } from './db/init';
import { metricsSync } from './services/metricsSync';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  try {
    console.log(`[${new Date().toLocaleString()}] Initializing DB for one-off metrics sync...`);
    await initDB();

    console.log(`[${new Date().toLocaleString()}] Running one-off metrics sync...`);
    await metricsSync();

    console.log(`[${new Date().toLocaleString()}] One-off metrics sync complete.`);
    process.exit(0);
  } catch (err) {
    console.error('Fatal error during one-off metrics sync:', err);
    process.exit(1);
  }
}

main();
