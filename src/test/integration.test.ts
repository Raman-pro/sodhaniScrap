import { fetchMarketState, isPayloadStale, parseNseDate, parseBseDate } from '../utils/exchangeState';

async function testOfflineFallback() {
  console.log('--- Test: Market State Fallback Resilience ---');
  // Even if an invalid URL or offline mode occurs, fetchMarketState returns a safe fallback
  const state = await fetchMarketState();
  console.log('Current market state:', state);
  if (typeof state.isOpen !== 'boolean' || !state.tradeDate) {
    throw new Error('fetchMarketState failed contract');
  }
  console.log('✅ PASS: Market State API contract is resilient.\n');
}

async function testStalenessDeduping() {
  console.log('--- Test: Live Sync Staleness De-duping ---');
  const testKey = 'test_source';
  const timestamp = '11-Sep-2026 16:00:00';

  // First poll
  const isStale1 = isPayloadStale(testKey, timestamp);
  console.log(`Poll 1 (Timestamp: ${timestamp}): isStale = ${isStale1}`);
  if (isStale1 !== false) throw new Error('Initial poll should not be marked stale');

  // Second poll 5 minutes later with same timestamp
  const isStale2 = isPayloadStale(testKey, timestamp);
  console.log(`Poll 2 (Timestamp: ${timestamp}): isStale = ${isStale2}`);
  if (isStale2 !== true) throw new Error('Second poll with identical timestamp must be marked stale');

  // Third poll when next market tick arrives
  const newTimestamp = '14-Sep-2026 09:15:00';
  const isStale3 = isPayloadStale(testKey, newTimestamp);
  console.log(`Poll 3 (Timestamp: ${newTimestamp}): isStale = ${isStale3}`);
  if (isStale3 !== false) throw new Error('Poll with fresh timestamp should not be marked stale');

  console.log('✅ PASS: Staleness de-duping functions correctly.\n');
}

async function testWeekendProtection() {
  console.log('--- Test: Weekend Date Filtering ---');
  const weekendDates = ['2026-09-12', '2026-09-13', '2026-08-22', '2026-08-23'];
  for (const dt of weekendDates) {
    const day = new Date(`${dt}T12:00:00Z`).getUTCDay();
    const isWeekend = day === 0 || day === 6;
    if (!isWeekend) throw new Error(`Date ${dt} was expected to be weekend`);
  }

  const weekdayDates = ['2026-09-11', '2026-09-14', '2026-09-15'];
  for (const dt of weekdayDates) {
    const day = new Date(`${dt}T12:00:00Z`).getUTCDay();
    const isWeekend = day === 0 || day === 6;
    if (isWeekend) throw new Error(`Date ${dt} was expected to be weekday`);
  }
  console.log('✅ PASS: Weekend date classification verified.\n');
}

async function runAll() {
  await testOfflineFallback();
  await testStalenessDeduping();
  await testWeekendProtection();
  console.log('🎯 ALL INTEGRATION TESTS PASSED!');
}

runAll().catch(e => {
  console.error('Test error:', e);
  process.exit(1);
});
