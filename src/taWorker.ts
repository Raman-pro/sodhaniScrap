import { pool } from './db/pool';
import { 
  OHLCV, calculateSMA, calculateEMA, calculateRSI, calculateStochastic, 
  calculateMACD, calculateADX, calculateATR, calculateBollingerBands, 
  calculatePivotPoints, calculateFibonacci, calculateSupertrend 
} from './services/ta';

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
      if (rows.length < 50) {
        // Not enough data for meaningful TA
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
      const rsi = calculateRSI(closes, 14);
      const stoch = calculateStochastic(ohlcv, 14, 3);
      const macd = calculateMACD(closes, 12, 26, 9);
      const adx = calculateADX(ohlcv, 14);
      
      const sma10 = calculateSMA(closes, 10);
      const sma20 = calculateSMA(closes, 20);
      const sma50 = calculateSMA(closes, 50);
      const sma100 = calculateSMA(closes, 100);
      const sma200 = calculateSMA(closes, 200);
      
      const ema10 = calculateEMA(closes, 10);
      const ema20 = calculateEMA(closes, 20);
      const ema50 = calculateEMA(closes, 50);
      const ema100 = calculateEMA(closes, 100);
      const ema200 = calculateEMA(closes, 200);
      
      const bb = calculateBollingerBands(closes, 20, 2);
      const pp = calculatePivotPoints(prevOHLCV);
      const fib = calculateFibonacci(ohlcv, 60);
      const supertrend = calculateSupertrend(ohlcv, 14, 3);
      
      // Evaluate signals
      let bullishCount = 0;
      let bearishCount = 0;
      let neutralCount = 0;
      
      const evaluateTrend = (val: number | null) => {
        if (val === null) return null;
        if (currentPrice > val) { bullishCount++; return "Above"; }
        if (currentPrice < val) { bearishCount++; return "Below"; }
        neutralCount++; return "Neutral";
      };
      
      const getRsiSignal = (val: number | null) => {
        if (val === null) return null;
        if (val > 70) { bearishCount++; return { signal: "BEARISH", text: "Overbought zone. Potential for pullback." }; }
        if (val < 30) { bullishCount++; return { signal: "BULLISH", text: "Oversold territory. Potential for bounce." }; }
        if (val >= 50) { bullishCount++; return { signal: "BULLISH", text: "Positive momentum." }; }
        bearishCount++; return { signal: "BEARISH", text: "Weak momentum." };
      };
      
      const getStochSignal = (st: any) => {
        if (!st || st.k === null || st.d === null) return null;
        if (st.k > 80) { bearishCount++; return { signal: "BEARISH", text: "Overbought zone." }; }
        if (st.k < 20) { bullishCount++; return { signal: "BULLISH", text: "Oversold zone." }; }
        if (st.k > st.d) { bullishCount++; return { signal: "BULLISH", text: "Bullish momentum." }; }
        bearishCount++; return { signal: "BEARISH", text: "Bearish momentum." };
      };
      
      const getMacdSignal = (m: any) => {
        if (!m || m.macd === null || m.signal === null) return null;
        if (m.macd > m.signal) { bullishCount++; return { signal: "BULLISH", text: "Bullish momentum." }; }
        bearishCount++; return { signal: "BEARISH", text: "Bearish momentum." };
      };
      
      const getAdxSignal = (a: any) => {
        if (!a || a.adx === null) return null;
        let dir = a.plusDI > a.minusDI ? "BULLISH" : "BEARISH";
        let strength = a.adx > 25 ? "Strong trend" : "Weak trend";
        if (a.adx > 25) {
            if (dir === "BULLISH") bullishCount++; else bearishCount++;
        } else {
            neutralCount++;
        }
        return { signal: a.adx > 25 ? dir : "NEUTRAL", text: `${strength}.` };
      };
      
      const momentum = {
        rsi: { value: rsi, ...getRsiSignal(rsi) },
        stochastic: { value: stoch?.k, ...getStochSignal(stoch) },
        macd: { value: macd?.macd, ...getMacdSignal(macd) },
        adx: { value: adx?.adx, ...getAdxSignal(adx) }
      };
      
      const trends = {
        sma: {
          "10": { value: sma10, signal: evaluateTrend(sma10) },
          "20": { value: sma20, signal: evaluateTrend(sma20) },
          "50": { value: sma50, signal: evaluateTrend(sma50) },
          "100": { value: sma100, signal: evaluateTrend(sma100) },
          "200": { value: sma200, signal: evaluateTrend(sma200) }
        },
        ema: {
          "10": { value: ema10, signal: evaluateTrend(ema10) },
          "20": { value: ema20, signal: evaluateTrend(ema20) },
          "50": { value: ema50, signal: evaluateTrend(ema50) },
          "100": { value: ema100, signal: evaluateTrend(ema100) },
          "200": { value: ema200, signal: evaluateTrend(ema200) }
        }
      };
      
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
      
      let overall = "Neutral";
      if (bullishCount > bearishCount * 2) overall = "Strong Buy";
      else if (bullishCount > bearishCount) overall = "Buy";
      else if (bearishCount > bullishCount * 2) overall = "Strong Sell";
      else if (bearishCount > bullishCount) overall = "Sell";

      const taData = {
        summary: {
          bullish: bullishCount,
          neutral: neutralCount,
          bearish: bearishCount,
          overall
        },
        momentum,
        trends,
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
