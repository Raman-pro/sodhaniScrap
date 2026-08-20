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
      if (rows.length < 14) {
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
      
      const momentum = {
        rsi: rsi,
        stochastic: stoch,
        macd: macd,
        adx: adx
      };
      
      const trends = {
        sma: {
          "10": sma10,
          "20": sma20,
          "50": sma50,
          "100": sma100,
          "200": sma200
        },
        ema: {
          "10": ema10,
          "20": ema20,
          "50": ema50,
          "100": ema100,
          "200": ema200
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
      
      const taData = {
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
