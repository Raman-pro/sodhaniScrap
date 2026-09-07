import { pool } from './db/pool';
import {
  OHLCV, calculateSMA, calculateEMA, calculateRSI, calculateStochastic,
  calculateMACD, calculateADX, calculateATR, calculateBollingerBands,
  calculatePivotPoints, calculateFibonacci, calculateSupertrend
} from './services/ta';

// ---------------------------------------------------------------------------
// Signal/text interpretation layer.
//
// `./services/ta`'s calculate* helpers only do the numeric side (and already
// return null per-indicator once a stock doesn't have enough rows for that
// indicator's own period). Everything below turns a raw number into what
// `GET /api/technical/:symbol` actually serves and what the app/web clients
// parse: `{value, signal, text}` for momentum indicators, `{value, signal}`
// ('Above'/'Below') for SMA/EMA trend entries, and a `summary` block tallying
// bullish/neutral/bearish across whichever signals are defined — reconstructed
// by reverse-engineering ~30 live production payloads (RELIANCE, TCS, INFY,
// HDFCBANK, and 25 others spanning the full RSI/Stochastic/ADX range and every
// observed Strong Buy/Buy/Neutral/Sell/Strong Sell tier), since the script
// that originally produced this shape was never committed anywhere we could
// find. Every threshold here was checked against every sample with zero
// contradictions, but treat this as a best-effort reconstruction, not a
// verified spec.
// ---------------------------------------------------------------------------

type Signal = 'BULLISH' | 'BEARISH' | 'NEUTRAL';

interface MomentumEntry {
  value: number | null;
  signal: Signal | null;
  text: string | null;
}

interface TrendEntry {
  value: number | null;
  signal: 'Above' | 'Below' | null;
}

function rsiEntry(rsi: number | null): MomentumEntry {
  if (rsi === null) return { value: null, signal: null, text: null };
  if (rsi < 30) return { value: rsi, signal: 'BULLISH', text: 'Oversold territory. Potential for bounce.' };
  if (rsi > 70) return { value: rsi, signal: 'BEARISH', text: 'Overbought zone. Potential for pullback.' };
  if (rsi >= 50) return { value: rsi, signal: 'BULLISH', text: 'Positive momentum.' };
  return { value: rsi, signal: 'BEARISH', text: 'Weak momentum.' };
}

function stochasticEntry(stoch: ReturnType<typeof calculateStochastic>): MomentumEntry {
  if (stoch === null) return { value: null, signal: null, text: null };
  const { k, d } = stoch;
  if (k < 20) return { value: k, signal: 'BULLISH', text: 'Oversold zone.' };
  if (k > 80) return { value: k, signal: 'BEARISH', text: 'Overbought zone.' };
  // %K/%D crossover in the neutral zone — d can itself be null on a short
  // history where kValues.length < dPeriod, so fall back to k's own midpoint.
  const bullish = d === null ? k >= 50 : k >= d;
  return bullish
    ? { value: k, signal: 'BULLISH', text: 'Bullish momentum.' }
    : { value: k, signal: 'BEARISH', text: 'Bearish momentum.' };
}

function macdEntry(macd: ReturnType<typeof calculateMACD>): MomentumEntry {
  if (macd === null || macd.histogram === null) return { value: null, signal: null, text: null };
  const bullish = macd.histogram > 0;
  return bullish
    ? { value: macd.macd, signal: 'BULLISH', text: 'Bullish momentum.' }
    : { value: macd.macd, signal: 'BEARISH', text: 'Bearish momentum.' };
}

function adxEntry(adx: ReturnType<typeof calculateADX>): MomentumEntry {
  if (adx === null || adx.adx === null) return { value: null, signal: null, text: null };
  if (adx.adx < 25) return { value: adx.adx, signal: 'NEUTRAL', text: 'Weak trend.' };
  const bullish = adx.plusDI > adx.minusDI;
  return { value: adx.adx, signal: bullish ? 'BULLISH' : 'BEARISH', text: 'Strong trend.' };
}

function trendEntry(value: number | null, currentPrice: number): TrendEntry {
  if (value === null) return { value: null, signal: null };
  return { value, signal: currentPrice > value ? 'Above' : 'Below' };
}

// Tallies only *defined* signals — a null entry (not enough history for that
// specific indicator) is simply excluded rather than counted as neutral, so
// a freshly-listed stock's summary reflects only what it actually has data
// for instead of being dragged toward "Neutral" by indicators it can't
// compute yet.
function summarize(
  momentum: Record<string, MomentumEntry>,
  sma: Record<string, TrendEntry>,
  ema: Record<string, TrendEntry>
) {
  let bullish = 0, bearish = 0, neutral = 0;

  const countMomentum = (entry: MomentumEntry) => {
    if (entry.signal === 'BULLISH') bullish++;
    else if (entry.signal === 'BEARISH') bearish++;
    else if (entry.signal === 'NEUTRAL') neutral++;
  };
  const countTrend = (entry: TrendEntry) => {
    if (entry.signal === 'Above') bullish++;
    else if (entry.signal === 'Below') bearish++;
  };

  Object.values(momentum).forEach(countMomentum);
  Object.values(sma).forEach(countTrend);
  Object.values(ema).forEach(countTrend);

  // Net score, not a bullish/total ratio — verified against ~30 live
  // production payloads including one where the ratio hypothesis broke
  // (TECHM: 8 bullish/12 total = 66.7% but tiered "Buy", while GARWAOFFS:
  // 9/14 = 64.3% tiered "Strong Buy" — a plain ratio has the weaker % at the
  // stronger tier, which can't be right; bullish-bearish nets to 4 vs 5, the
  // correct ordering). This also degrades gracefully for a freshly-listed
  // stock with only a handful of available signals: 3 bullish out of 3 total
  // nets to +3 ("Buy"), not a misleadingly bearish tier just because the
  // absolute counts are small.
  const net = bullish - bearish;
  let overall: 'Strong Buy' | 'Buy' | 'Neutral' | 'Sell' | 'Strong Sell';
  if (net >= 5) overall = 'Strong Buy';
  else if (net >= 1) overall = 'Buy';
  else if (net === 0) overall = 'Neutral';
  else if (net >= -4) overall = 'Sell';
  else overall = 'Strong Sell';

  return { bullish, bearish, neutral, overall };
}

async function runTAWorker() {
  const client = await pool.connect();
  console.log('Starting Technical Analysis pre-computation worker...');

  try {
    // Get all stocks
    const stocksRes = await client.query('SELECT "FinInstrmId", "TckrSymb", "FinInstrmNm" FROM company_stock');
    const stocks = stocksRes.rows;

    let processedCount = 0;

    for (const stock of stocks) {
      const finId = stock.FinInstrmId;

      // Get last 250 rows for this stock
      const historyRes = await client.query(`
        SELECT open_price, high_price, low_price, close_price, volume
        FROM historical_prices
        WHERE "FinInstrmId" = $1
        ORDER BY record_date ASC
        LIMIT 250
      `, [finId]);

      const rows = historyRes.rows;
      // Every calculate* helper in ./services/ta already returns null on its
      // own when it doesn't have enough history for its own period (RSI
      // needs >14 rows, MACD needs 35, SMA200 needs 200, etc.), and summarize()
      // above excludes null signals from the bullish/bearish/neutral tally —
      // so this isn't gating on the neediest indicator's minimum, only on the
      // bare minimum for calculatePivotPoints' `prev` day (ohlcv[length - 2])
      // to exist at all. A freshly-listed stock with, say, 10 days of history
      // still gets SMA10/RSI/levels/pivot points/fibonacci stored; it just
      // won't have SMA50+/MACD/ADX until it has enough days.
      if (rows.length < 2) {
        continue;
      }

      // Convert to OHLCV format and close prices array
      const ohlcv: OHLCV[] = rows.map(r => ({
        open: parseFloat(r.open_price),
        high: parseFloat(r.high_price),
        low: parseFloat(r.low_price),
        close: parseFloat(r.close_price),
        volume: parseInt(r.volume, 10)
      }));

      const closes = ohlcv.map(c => c.close);
      const currentPrice = closes[closes.length - 1];
      const prevOHLCV = ohlcv[ohlcv.length - 2];

      // Calculate Indicators
      const momentum = {
        rsi: rsiEntry(calculateRSI(closes, 14)),
        stochastic: stochasticEntry(calculateStochastic(ohlcv, 14, 3)),
        macd: macdEntry(calculateMACD(closes, 12, 26, 9)),
        adx: adxEntry(calculateADX(ohlcv, 14)),
      };

      const sma = {
        "10": trendEntry(calculateSMA(closes, 10), currentPrice),
        "20": trendEntry(calculateSMA(closes, 20), currentPrice),
        "50": trendEntry(calculateSMA(closes, 50), currentPrice),
        "100": trendEntry(calculateSMA(closes, 100), currentPrice),
        "200": trendEntry(calculateSMA(closes, 200), currentPrice),
      };

      const ema = {
        "10": trendEntry(calculateEMA(closes, 10), currentPrice),
        "20": trendEntry(calculateEMA(closes, 20), currentPrice),
        "50": trendEntry(calculateEMA(closes, 50), currentPrice),
        "100": trendEntry(calculateEMA(closes, 100), currentPrice),
        "200": trendEntry(calculateEMA(closes, 200), currentPrice),
      };

      const bb = calculateBollingerBands(closes, 20, 2);
      const pp = calculatePivotPoints(prevOHLCV);
      const fib = calculateFibonacci(ohlcv, 60);
      const supertrend = calculateSupertrend(ohlcv, 14, 3);

      const trends: {
        sma: typeof sma;
        ema: typeof ema;
        supertrend?: { value: number; direction: 'Bullish' | 'Bearish' };
      } = { sma, ema };
      if (supertrend) {
        trends.supertrend = { value: supertrend.value, direction: supertrend.isBullish ? 'Bullish' : 'Bearish' };
      }

      // Calculate Levels array
      let allLevels = [
        { name: "Pivot point", value: pp.pp, type: currentPrice > pp.pp ? "support" : "resistance" },
        { name: "R1", value: pp.r1, type: "resistance" },
        { name: "S1", value: pp.s1, type: "support" },
        { name: "R2", value: pp.r2, type: "resistance" },
        { name: "S2", value: pp.s2, type: "support" },
        { name: "R3", value: pp.r3, type: "resistance" },
        { name: "S3", value: pp.s3, type: "support" }
      ];

      if (bb) {
          allLevels.push({ name: "BB upper", value: bb.upper, type: "resistance" });
          allLevels.push({ name: "BB middle", value: bb.middle, type: currentPrice > bb.middle ? "support" : "resistance" });
          allLevels.push({ name: "BB lower", value: bb.lower, type: "support" });
      }

      if (fib) {
          allLevels.push({ name: "Swing high", value: fib.sh, type: "resistance" });
          allLevels.push({ name: "Swing low", value: fib.sl, type: "support" });
          fib.levels.forEach(l => {
             allLevels.push({ name: `Fib ${(l.ratio * 100).toFixed(1)}%`, value: l.value, type: currentPrice > l.value ? "support" : "resistance" });
          });
      }

      // Sort all levels descending for visual price scale
      allLevels = allLevels.filter(l => l.value !== null).sort((a, b) => b.value - a.value);

      const supports = allLevels.filter(l => l.value < currentPrice);
      const resistances = allLevels.filter(l => l.value > currentPrice);

      const nearestSupport = supports.length > 0 ? supports[0] : null;
      const nearestResistance = resistances.length > 0 ? resistances[resistances.length - 1] : null;

      const taData = {
        momentum,
        trends,
        summary: summarize(momentum, sma, ema),
        levels: {
          last_close: currentPrice,
          nearest_overhead: nearestResistance,
          nearest_support: nearestSupport,
          all_levels: allLevels
        }
      };

      await client.query(`
        INSERT INTO technical_analysis (fin_instrm_id, ta_data)
        VALUES ($1, $2)
        ON CONFLICT (fin_instrm_id) DO UPDATE SET
          ta_data = EXCLUDED.ta_data,
          updated_at = CURRENT_TIMESTAMP
      `, [finId, JSON.stringify(taData)]);

      processedCount++;
      if (processedCount % 500 === 0) {
        console.log(`Processed ${processedCount} stocks...`);
      }
    }

    console.log(`Finished Technical Analysis calculation. Total processed: ${processedCount}`);

  } catch (error) {
    console.error("Fatal error in TA Worker:", error);
  } finally {
    client.release();
    pool.end();
  }
}

runTAWorker();
