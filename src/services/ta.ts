export interface OHLCV {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export function calculateSMA(data: number[], period: number): number | null {
  if (data.length < period) return null;
  const slice = data.slice(data.length - period);
  const sum = slice.reduce((a, b) => a + b, 0);
  return sum / period;
}

export function calculateEMA(data: number[], period: number): number | null {
  if (data.length < period) return null;
  
  // Initialize with SMA
  const initialData = data.slice(0, period);
  let ema = initialData.reduce((a, b) => a + b, 0) / period;
  
  const alpha = 2 / (period + 1);
  
  for (let i = period; i < data.length; i++) {
    ema = data[i] * alpha + ema * (1 - alpha);
  }
  
  return ema;
}

// RSI exactly as described with Wilder's smoothing
export function calculateRSI(data: number[], period: number = 14): number | null {
  if (data.length <= period) return null;

  let avgGain = 0;
  let avgLoss = 0;

  // Initial average gain/loss
  for (let i = 1; i <= period; i++) {
    const change = data[i] - data[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss -= change;
  }
  avgGain /= period;
  avgLoss /= period;

  // Wilder's smoothing for the rest
  for (let i = period + 1; i < data.length; i++) {
    const change = data[i] - data[i - 1];
    let gain = 0, loss = 0;
    if (change > 0) gain = change;
    else loss = -change;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

// ATR
export function calculateATR(ohlcv: OHLCV[], period: number = 14): number | null {
  if (ohlcv.length <= period) return null;
  
  const trs = [];
  for (let i = 1; i < ohlcv.length; i++) {
    const current = ohlcv[i];
    const prev = ohlcv[i - 1];
    const tr = Math.max(
      current.high - current.low,
      Math.abs(current.high - prev.close),
      Math.abs(current.low - prev.close)
    );
    trs.push(tr);
  }

  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;

  for (let i = period; i < trs.length; i++) {
    atr = ((atr * (period - 1)) + trs[i]) / period;
  }

  return atr;
}

// Stochastic (14, 3) where %D is 3-period SMA of %K
export function calculateStochastic(ohlcv: OHLCV[], kPeriod: number = 14, dPeriod: number = 3) {
  if (ohlcv.length < kPeriod) return null;
  
  const kValues = [];
  for (let i = kPeriod - 1; i < ohlcv.length; i++) {
    const slice = ohlcv.slice(i - kPeriod + 1, i + 1);
    const highest = Math.max(...slice.map(c => c.high));
    const lowest = Math.min(...slice.map(c => c.low));
    
    const current = ohlcv[i];
    let k = 50; // default if highest == lowest
    if (highest !== lowest) {
      k = ((current.close - lowest) / (highest - lowest)) * 100;
    }
    kValues.push(k);
  }
  
  const currentK = kValues[kValues.length - 1];
  const currentD = calculateSMA(kValues, dPeriod);
  
  return { k: currentK, d: currentD };
}

// Supertrend
export function calculateSupertrend(ohlcv: OHLCV[], period: number = 14, multiplier: number = 3) {
    if (ohlcv.length <= period) return null;
    
    let atr = calculateATR(ohlcv, period);
    if (atr === null) return null;
    
    const trs = [];
    for (let i = 1; i < ohlcv.length; i++) {
      const current = ohlcv[i];
      const prev = ohlcv[i - 1];
      const tr = Math.max(
        current.high - current.low,
        Math.abs(current.high - prev.close),
        Math.abs(current.low - prev.close)
      );
      trs.push(tr);
    }
    
    let currentATR = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
    
    let isBullish = true;
    let finalUpperBand = 0;
    let finalLowerBand = 0;
    
    const firstCandle = ohlcv[period];
    let hl2 = (firstCandle.high + firstCandle.low) / 2;
    finalUpperBand = hl2 + multiplier * currentATR;
    finalLowerBand = hl2 - multiplier * currentATR;
    
    for (let i = period + 1; i < ohlcv.length; i++) {
      const current = ohlcv[i];
      const prev = ohlcv[i - 1];
      
      currentATR = ((currentATR * (period - 1)) + trs[i - 1]) / period;
      hl2 = (current.high + current.low) / 2;
      
      const basicUpper = hl2 + multiplier * currentATR;
      const basicLower = hl2 - multiplier * currentATR;
      
      if (basicUpper < finalUpperBand || prev.close > finalUpperBand) {
          finalUpperBand = basicUpper;
      }
      
      if (basicLower > finalLowerBand || prev.close < finalLowerBand) {
          finalLowerBand = basicLower;
      }
      
      if (current.close <= finalUpperBand && isBullish && current.close < finalLowerBand) {
          isBullish = false;
      } else if (current.close >= finalLowerBand && !isBullish && current.close > finalUpperBand) {
          isBullish = true;
      }
    }
    
    return {
        value: isBullish ? finalLowerBand : finalUpperBand,
        isBullish
    };
}

// MACD
export function calculateMACD(data: number[], fast: number = 12, slow: number = 26, signal: number = 9) {
    if (data.length < slow + signal) return null;
    
    const macdLine = [];
    for (let i = slow - 1; i < data.length; i++) {
        const slice = data.slice(0, i + 1);
        const emaFast = calculateEMA(slice, fast)!;
        const emaSlow = calculateEMA(slice, slow)!;
        macdLine.push(emaFast - emaSlow);
    }
    
    const currentMACD = macdLine[macdLine.length - 1];
    const signalLine = calculateEMA(macdLine, signal);
    
    return {
        macd: currentMACD,
        signal: signalLine,
        histogram: signalLine !== null ? currentMACD - signalLine : null
    };
}

// ADX
export function calculateADX(ohlcv: OHLCV[], period: number = 14) {
    if (ohlcv.length <= period * 2) return null;
    
    const plusDM = [];
    const minusDM = [];
    const trs = [];
    
    for (let i = 1; i < ohlcv.length; i++) {
        const current = ohlcv[i];
        const prev = ohlcv[i-1];
        
        const upMove = current.high - prev.high;
        const downMove = prev.low - current.low;
        
        let pDM = 0;
        let mDM = 0;
        
        if (upMove > downMove && upMove > 0) pDM = upMove;
        if (downMove > upMove && downMove > 0) mDM = downMove;
        
        plusDM.push(pDM);
        minusDM.push(mDM);
        
        trs.push(Math.max(
          current.high - current.low,
          Math.abs(current.high - prev.close),
          Math.abs(current.low - prev.close)
        ));
    }
    
    let smoothedTR = trs.slice(0, period).reduce((a, b) => a + b, 0);
    let smoothedPlusDM = plusDM.slice(0, period).reduce((a, b) => a + b, 0);
    let smoothedMinusDM = minusDM.slice(0, period).reduce((a, b) => a + b, 0);
    
    const dx = [];
    for (let i = period; i < trs.length; i++) {
        smoothedTR = smoothedTR - (smoothedTR / period) + trs[i];
        smoothedPlusDM = smoothedPlusDM - (smoothedPlusDM / period) + plusDM[i];
        smoothedMinusDM = smoothedMinusDM - (smoothedMinusDM / period) + minusDM[i];
        
        const plusDI = 100 * (smoothedPlusDM / smoothedTR);
        const minusDI = 100 * (smoothedMinusDM / smoothedTR);
        
        const currentDX = 100 * (Math.abs(plusDI - minusDI) / (plusDI + minusDI || 1));
        dx.push(currentDX);
    }
    
    const adx = calculateSMA(dx, period);
    
    const lastPlusDI = 100 * (smoothedPlusDM / smoothedTR);
    const lastMinusDI = 100 * (smoothedMinusDM / smoothedTR);
    
    return {
        adx,
        plusDI: lastPlusDI,
        minusDI: lastMinusDI
    };
}

// Bollinger Bands
export function calculateBollingerBands(data: number[], period: number = 20, multiplier: number = 2) {
    if (data.length < period) return null;
    
    const slice = data.slice(data.length - period);
    const sma = slice.reduce((a, b) => a + b, 0) / period;
    
    const variance = slice.reduce((a, b) => a + Math.pow(b - sma, 2), 0) / period;
    const stdDev = Math.sqrt(variance);
    
    return {
        middle: sma,
        upper: sma + multiplier * stdDev,
        lower: sma - multiplier * stdDev
    };
}

// Pivot Points
export function calculatePivotPoints(prev: OHLCV) {
    const pp = (prev.high + prev.low + prev.close) / 3;
    return {
        pp,
        r1: (2 * pp) - prev.low,
        s1: (2 * pp) - prev.high,
        r2: pp + (prev.high - prev.low),
        s2: pp - (prev.high - prev.low),
        r3: prev.high + 2 * (pp - prev.low),
        s3: prev.low - 2 * (prev.high - pp)
    };
}

// Fibonacci (60 day lookback)
export function calculateFibonacci(ohlcv: OHLCV[], lookback: number = 60) {
    if (ohlcv.length === 0) return null;
    const slice = ohlcv.slice(-lookback);
    
    let sh = slice[0].high;
    let sl = slice[0].low;
    
    for (const c of slice) {
        if (c.high > sh) sh = c.high;
        if (c.low < sl) sl = c.low;
    }
    
    const range = sh - sl;
    if (range === 0) return null;
    
    let shIndex = slice.findIndex(c => c.high === sh);
    let slIndex = slice.findIndex(c => c.low === sl);
    
    const isUptrend = slIndex < shIndex;
    
    const ratios = [0.236, 0.382, 0.5, 0.618, 0.786];
    const levels = ratios.map(r => ({
        ratio: r,
        value: isUptrend ? sh - r * range : sl + r * range
    }));
    
    return {
        sh,
        sl,
        isUptrend,
        levels
    };
}
