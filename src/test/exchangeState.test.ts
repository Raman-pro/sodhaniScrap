import {
  parseNseDate,
  parseBseDate,
  getIstDateString,
  parseExchangeDateTimeToIso,
  isWithinMarketWindow,
  isPayloadStale,
  resetStalenessTracker,
  fetchMarketState
} from '../utils/exchangeState';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`✅ PASS: ${msg}`);
}

async function runTests() {
  console.log('--- Running Exchange State & Timestamp Unit Tests ---\n');

  // Test 1: parseNseDate
  assert(parseNseDate('11-Sep-2026 16:00:00') === '2026-09-11', 'parseNseDate with full timestamp 11-Sep-2026 16:00:00');
  assert(parseNseDate('11-Sep-2026') === '2026-09-11', 'parseNseDate with date only 11-Sep-2026');
  assert(parseNseDate('01-Feb-2025 10:30:00') === '2025-02-01', 'parseNseDate with February date');
  assert(parseNseDate('2026-09-11 15:39:59') === '2026-09-11', 'parseNseDate with ISO-like date string');

  // Test 2: parseBseDate
  assert(parseBseDate('2026-09-11T16:00:00') === '2026-09-11', 'parseBseDate with ISO timestamp 2026-09-11T16:00:00');
  assert(parseBseDate('2026-08-14 15:30:00') === '2026-08-14', 'parseBseDate with space-separated timestamp');

  // Test 3: parseExchangeDateTimeToIso
  const bseIso = parseExchangeDateTimeToIso('2026-09-11T16:00:00');
  // 16:00:00 IST is 10:30:00 UTC
  assert(bseIso === '2026-09-11T10:30:00.000Z', `parseExchangeDateTimeToIso for BSE converts to UTC correctly: ${bseIso}`);

  const nseIso = parseExchangeDateTimeToIso('11-Sep-2026 16:00:00');
  assert(nseIso === '2026-09-11T10:30:00.000Z', `parseExchangeDateTimeToIso for NSE converts to UTC correctly: ${nseIso}`);

  // Test 4: isPayloadStale
  resetStalenessTracker();
  const tick1 = isPayloadStale('nse_live', '11-Sep-2026 15:30:00');
  assert(!tick1, 'First tick must NOT be stale');

  const tick2 = isPayloadStale('nse_live', '11-Sep-2026 15:30:00');
  assert(tick2, 'Duplicate tick with exact same timestamp MUST be detected as stale');

  const tick3 = isPayloadStale('nse_live', '11-Sep-2026 15:35:00');
  assert(!tick3, 'Fresh tick with advanced timestamp must NOT be stale');

  // Test 5: isWithinMarketWindow
  // Monday 11:00 AM IST
  const mondayMidday = new Date('2026-09-14T05:30:00.000Z'); // 11:00 AM IST
  assert(isWithinMarketWindow(mondayMidday), 'Monday 11:00 AM IST is within market window');

  // Sunday 11:00 AM IST
  const sundayMidday = new Date('2026-09-13T05:30:00.000Z'); // Sunday 11:00 AM IST
  assert(!isWithinMarketWindow(sundayMidday), 'Sunday 11:00 AM IST is outside market window');

  // Monday 02:00 AM IST
  const mondayNight = new Date('2026-09-13T20:30:00.000Z'); // Monday 02:00 AM IST
  assert(!isWithinMarketWindow(mondayNight), 'Monday 02:00 AM IST is outside market window');

  // Test 6: fetchMarketState live / fallback
  console.log('\nTesting live fetchMarketState()...');
  const marketState = await fetchMarketState();
  console.log('fetchMarketState result:', marketState);
  assert(typeof marketState.isOpen === 'boolean', 'marketState.isOpen is a boolean');
  assert(typeof marketState.tradeDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(marketState.tradeDate), `tradeDate is formatted YYYY-MM-DD: ${marketState.tradeDate}`);

  console.log('\n🎉 ALL UNIT TESTS PASSED SUCCESSFULLY!\n');
}

runTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
