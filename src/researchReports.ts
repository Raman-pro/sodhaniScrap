import { initDB } from './db/init';
import { researchReportsSync } from './services/researchReportsSync';
import dotenv from 'dotenv';

dotenv.config();

const RESEARCH_REPORTS_POLL_INTERVAL_MS = parseInt(process.env.RESEARCH_REPORTS_POLL_INTERVAL_MS || '21600000', 10);

async function startResearchReportsPolling() {
  console.log(`Starting Research Reports Polling Loop every ${RESEARCH_REPORTS_POLL_INTERVAL_MS / 1000} seconds...`);

  // Run immediately first
  await researchReportsSync();

  // Then schedule
  setInterval(async () => {
    await researchReportsSync();
  }, RESEARCH_REPORTS_POLL_INTERVAL_MS);
}

async function main() {
  try {
    const skipStart = process.argv.includes('--skip_start');
    if (!skipStart) {
        console.log('Initializing DB for Research Reports Worker...');
        await initDB();
    } else {
        console.log('Skipping DB init for Research Reports Worker (--skip_start)');
    }

    startResearchReportsPolling();
  } catch (err) {
    console.error('Fatal error during research reports worker initialization:', err);
    process.exit(1);
  }
}

main();
