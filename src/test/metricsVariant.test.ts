import { pickVariant, isPositive, isNonZero } from '../services/metricsVariant';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`✅ PASS: ${msg}`);
}

// Real numbers, taken from the production scrape that exposed the bug:
// screener.in quotes RELIANCE at a consolidated P/E of 23.8 while stock_metrics
// carried 42.9, because metricsSync preferred the standalone EPS (28.98, which
// leaves Jio and Retail out entirely) over the consolidated one (59.7).
const RELIANCE_CMP = 1243.4;
const RELIANCE_CONS_EPS = 59.7;
const RELIANCE_STD_EPS = 28.98;

async function runTests() {
  console.log('--- Running Metrics Variant Selection Unit Tests ---\n');

  // Test 1: consolidated wins whenever it is usable
  assert(
    pickVariant(RELIANCE_CONS_EPS, RELIANCE_STD_EPS, isPositive) === RELIANCE_CONS_EPS,
    'Consolidated EPS is preferred over standalone when both are present'
  );

  const pe = RELIANCE_CMP / pickVariant(RELIANCE_CONS_EPS, RELIANCE_STD_EPS, isPositive);
  assert(
    pe > 20 && pe < 22,
    `RELIANCE P/E lands near screener.in's consolidated 23.8, not the standalone 42.9: ${pe.toFixed(2)}`
  );

  // Test 2: standalone is the fallback, not the default - a company that files
  // no consolidated statements must still get a P/E.
  assert(
    pickVariant(0, 45.7, isPositive) === 45.7,
    'Standalone EPS is used when consolidated is absent (0)'
  );
  assert(
    pickVariant(0, 0, isPositive) === 0,
    'Both variants absent yields 0, which metricsSync treats as "no P/E"'
  );

  // Test 3: the predicate decides usability, so the whole row can be selected
  // as a unit - EPS and its dividend payout must come from the SAME variant,
  // or the dividend yield is computed against a different company's earnings.
  const cons = { eps: RELIANCE_CONS_EPS, div: 9 };
  const std = { eps: RELIANCE_STD_EPS, div: 18 };
  const picked = pickVariant(cons, std, (e) => isPositive(e.eps));
  assert(picked.eps === cons.eps && picked.div === cons.div, 'EPS and dividend payout are taken from one variant together');

  const consMissing = { eps: 0, div: 0 };
  const fallback = pickVariant(consMissing, std, (e) => isPositive(e.eps));
  assert(fallback.eps === std.eps && fallback.div === std.div, 'Falls back to the standalone pair as a unit');

  // Test 4: isNonZero keeps genuinely negative figures (a loss-making quarter
  // or a negative ROCE is real data, not a missing value).
  assert(isNonZero(-5.2), 'isNonZero accepts a negative ROCE');
  assert(!isNonZero(0), 'isNonZero rejects 0');
  assert(!isPositive(-5.2), 'isPositive rejects a negative EPS (P/E is not meaningful on a loss)');
  assert(
    pickVariant(-5.2, 7.78, isNonZero) === -5.2,
    'A negative consolidated ROCE still wins over standalone - it is a real value'
  );

  // Test 5: NaN is what parseCleanNumber-style parsing yields on junk, and it
  // must never be picked.
  assert(!isPositive(NaN) && !isNonZero(NaN), 'NaN is never usable');
  assert(pickVariant(NaN, 12.5, isPositive) === 12.5, 'NaN consolidated falls through to standalone');

  console.log('\n🎉 ALL UNIT TESTS PASSED SUCCESSFULLY!\n');
}

runTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
