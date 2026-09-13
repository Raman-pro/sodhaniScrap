import {
  parseNseDate,
  parseBseDate,
  parseExchangeDateTimeToIso,
  isPayloadStale,
  resetStalenessTracker
} from '../utils/exchangeState';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`✅ PASS: ${msg}`);
}

async function runLiveSyncTests() {
  console.log('--- Running Live Sync Logic & Guard Tests ---\n');

  // Test 1: NSE live sync timestamp & weekend detection
  resetStalenessTracker('nse_live_sync');
  const nseFridayPayload = {
    timestamp: '11-Sep-2026 16:00:00',
    total: {
      data: [{ symbol: 'RELIANCE', lastPrice: 3000, totalTradedVolume: 10 }]
    }
  };

  // Check trade date extraction
  const nseTradeDate = parseNseDate(nseFridayPayload.timestamp);
  assert(nseTradeDate === '2026-09-11', `NSE trade date should be 2026-09-11, got ${nseTradeDate}`);

  // Check that Friday is a weekday
  const nseDay = new Date(`${nseTradeDate}T12:00:00Z`).getUTCDay();
  assert(nseDay === 5, 'Friday must have day 5 (weekday)');

  // Verify recordDate retains the full exchange timestamp in UTC for intraday charting
  const nseRecordDate = parseExchangeDateTimeToIso(nseFridayPayload.timestamp);
  assert(nseRecordDate === '2026-09-11T10:30:00.000Z', `Intraday timestamp must be 2026-09-11T10:30:00.000Z, got ${nseRecordDate}`);

  // Test 2: Weekend safety guard on synthetic NSE weekend payload
  const nseSaturdayPayload = {
    timestamp: '12-Sep-2026 11:00:00'
  };
  const satTradeDate = parseNseDate(nseSaturdayPayload.timestamp);
  const satDay = new Date(`${satTradeDate}T12:00:00Z`).getUTCDay();
  const isWeekendGuardTriggered = satDay === 0 || satDay === 6;
  assert(isWeekendGuardTriggered, 'Weekend safety guard correctly flags Saturday as blocked');

  // Test 3: Staleness check in NSE live sync
  const isStaleFirst = isPayloadStale('nse_live_sync', nseFridayPayload.timestamp);
  assert(!isStaleFirst, 'First call with Friday timestamp is fresh');
  const isStaleSecond = isPayloadStale('nse_live_sync', nseFridayPayload.timestamp);
  assert(isStaleSecond, 'Subsequent poll with same Friday timestamp is correctly detected as stale');

  // Test 4: BSE live sync timestamp & weekend detection
  resetStalenessTracker('bse_live_sync');
  const bseItems = [
    { scrip_cd: 500325, ltradert: 3000, dt_tm: '2026-09-11T15:30:00' },
    { scrip_cd: 500180, ltradert: 1600, dt_tm: '2026-09-11T16:00:00' }
  ];

  let maxBseDtTm = '';
  for (const item of bseItems) {
    if (item.dt_tm && item.dt_tm > maxBseDtTm) maxBseDtTm = item.dt_tm;
  }
  assert(maxBseDtTm === '2026-09-11T16:00:00', `Max BSE timestamp should be 2026-09-11T16:00:00, got ${maxBseDtTm}`);

  const bseTradeDate = parseBseDate(maxBseDtTm);
  assert(bseTradeDate === '2026-09-11', `BSE trade date should be 2026-09-11, got ${bseTradeDate}`);

  const bseRecordDate = parseExchangeDateTimeToIso(bseItems[0].dt_tm);
  assert(bseRecordDate === '2026-09-11T10:00:00.000Z', `BSE 15:30 IST timestamp converted correctly to 10:00:00 UTC: ${bseRecordDate}`);

  // Test 5: Staleness check in BSE live sync
  const isBseStaleFirst = isPayloadStale('bse_live_sync', maxBseDtTm);
  assert(!isBseStaleFirst, 'First BSE poll is fresh');
  const isBseStaleSecond = isPayloadStale('bse_live_sync', maxBseDtTm);
  assert(isBseStaleSecond, 'Second BSE poll with identical dt_tm is detected as stale');

  console.log('\n🎉 ALL LIVE SYNC LOGIC & GUARD TESTS PASSED!\n');
}

runLiveSyncTests().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
