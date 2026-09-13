import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const MONTH_MAP: Record<string, string> = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12'
};

export interface MarketState {
  isOpen: boolean;
  tradeDate: string;
  message: string;
  source: 'api' | 'fallback';
}

// In-memory cache for market status API to prevent throttling
let cachedMarketState: { state: MarketState; expiresAt: number } | null = null;
const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

// In-memory map to track last seen payload timestamps per feed/source
const lastSeenTimestamps: Record<string, string> = {};

/**
 * Checks if the current payload timestamp matches the last processed timestamp.
 * Returns true if stale (unchanged), false if fresh (new tick).
 * Automatically updates the tracked timestamp when a fresh tick is encountered.
 */
export function isPayloadStale(sourceKey: string, currentTimestamp: string | null | undefined): boolean {
  if (!currentTimestamp) return false;
  const clean = currentTimestamp.trim();
  if (!clean) return false;

  const previous = lastSeenTimestamps[sourceKey];
  if (previous && previous === clean) {
    return true;
  }

  lastSeenTimestamps[sourceKey] = clean;
  return false;
}

/**
 * Resets the in-memory staleness tracker (useful for unit tests).
 */
export function resetStalenessTracker(sourceKey?: string) {
  if (sourceKey) {
    delete lastSeenTimestamps[sourceKey];
  } else {
    for (const key of Object.keys(lastSeenTimestamps)) {
      delete lastSeenTimestamps[key];
    }
  }
}

/**
 * Extracts the calendar date string (YYYY-MM-DD) from an NSE timestamp string.
 * Examples:
 *   "11-Sep-2026 16:00:00" -> "2026-09-11"
 *   "11-Sep-2026"          -> "2026-09-11"
 *   "2026-09-11 15:39:59"  -> "2026-09-11"
 */
export function parseNseDate(rawDateStr: string | null | undefined, fallback?: string): string {
  if (!rawDateStr) return fallback || getIstDateString();
  const clean = rawDateStr.trim();

  // Pattern 1: DD-Mon-YYYY (e.g. 11-Sep-2026 16:00:00)
  const ddmonyyyyMatch = clean.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
  if (ddmonyyyyMatch) {
    const [, day, monStr, year] = ddmonyyyyMatch;
    const month = MONTH_MAP[monStr] || '01';
    return `${year}-${month}-${day.padStart(2, '0')}`;
  }

  // Pattern 2: YYYY-MM-DD (e.g. 2026-09-11 15:39:59)
  const yyyymmddMatch = clean.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (yyyymmddMatch) {
    const [, year, month, day] = yyyymmddMatch;
    return `${year}-${month}-${day}`;
  }

  return fallback || getIstDateString();
}

/**
 * Extracts the calendar date string (YYYY-MM-DD) from a BSE timestamp string.
 * Examples:
 *   "2026-09-11T16:00:00" -> "2026-09-11"
 *   "2026-09-11 16:00:00" -> "2026-09-11"
 */
export function parseBseDate(rawDateStr: string | null | undefined, fallback?: string): string {
  if (!rawDateStr) return fallback || getIstDateString();
  const clean = rawDateStr.trim();

  const yyyymmddMatch = clean.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (yyyymmddMatch) {
    const [, year, month, day] = yyyymmddMatch;
    return `${year}-${month}-${day}`;
  }

  return fallback || getIstDateString();
}

/**
 * Returns the current date formatted as YYYY-MM-DD strictly in Indian Standard Time (IST).
 */
export function getIstDateString(d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(d);

  const year = parts.find(p => p.type === 'year')?.value || '';
  const month = parts.find(p => p.type === 'month')?.value || '';
  const day = parts.find(p => p.type === 'day')?.value || '';

  return `${year}-${month}-${day}`;
}

/**
 * Converts a raw exchange date and time string into a valid ISO string with IST (+05:30) offset.
 * Example: "11-Sep-2026 16:00:00" -> "2026-09-11T10:30:00.000Z"
 */
export function parseExchangeDateTimeToIso(rawDateStr: string | null | undefined): string {
  if (!rawDateStr) return new Date().toISOString();
  const clean = rawDateStr.trim();

  // If already in ISO format
  if (clean.includes('T') && clean.endsWith('Z')) {
    return clean;
  }

  // BSE format: "2026-09-11T16:00:00" -> parse as IST
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/.test(clean)) {
    const normalized = clean.replace('T', ' ');
    const d = new Date(`${normalized} GMT+0530`);
    if (!isNaN(d.getTime())) return d.toISOString();
  }

  // NSE format: "11-Sep-2026 16:00:00" -> parse as IST
  const nseMatch = clean.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})(?:\s+(\d{2}):(\d{2}):(\d{2}))?/);
  if (nseMatch) {
    const [, day, monStr, year, hh = '15', mm = '30', ss = '00'] = nseMatch;
    const month = MONTH_MAP[monStr] || '01';
    const isoLike = `${year}-${month}-${day.padStart(2, '0')} ${hh}:${mm}:${ss} GMT+0530`;
    const d = new Date(isoLike);
    if (!isNaN(d.getTime())) return d.toISOString();
  }

  return new Date().toISOString();
}

/**
 * Defensive fallback: checks if current IST time is within regular market hours.
 * Window: 09:15 to 16:10 IST, Monday through Friday.
 */
export function isWithinMarketWindow(now: Date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: 'numeric',
    weekday: 'short',
    hour12: false
  }).formatToParts(now);

  const weekday = parts.find(p => p.type === 'weekday')?.value || '';
  if (weekday === 'Sat' || weekday === 'Sun') return false;

  const hours = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
  const minutes = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
  const timeNum = hours * 100 + minutes;

  return timeNum >= 915 && timeNum <= 1610;
}

/**
 * Queries the official NSE Market Status API (https://www.nseindia.com/api/marketStatus).
 * Caches responses for 2 minutes.
 * If the API is unreachable, gracefully falls back to the time window check.
 */
export async function fetchMarketState(): Promise<MarketState> {
  const now = Date.now();
  if (cachedMarketState && cachedMarketState.expiresAt > now) {
    return cachedMarketState.state;
  }

  try {
    const { stdout } = await execFileAsync('curl', [
      '-s', '-m', '10',
      '-H', 'accept: application/json',
      '-H', 'user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      '-H', 'Referer: https://www.nseindia.com/',
      'https://www.nseindia.com/api/marketStatus'
    ], { maxBuffer: 5 * 1024 * 1024 });

    const data = JSON.parse(stdout);
    const capitalMarket = (data.marketState || []).find((m: any) => m.market === 'Capital Market');

    if (capitalMarket) {
      const status = String(capitalMarket.marketStatus || '').toLowerCase();
      const isOpen = status === 'open';
      const tradeDate = capitalMarket.tradeDate ? parseNseDate(capitalMarket.tradeDate) : getIstDateString();
      const message = capitalMarket.marketStatusMessage || (isOpen ? 'Market is Open' : 'Market is Closed');

      const state: MarketState = {
        isOpen,
        tradeDate,
        message,
        source: 'api'
      };

      cachedMarketState = { state, expiresAt: now + CACHE_TTL_MS };
      return state;
    }
  } catch (err: any) {
    // Graceful fallback to time window if API is down or throttled
  }

  const isOpen = isWithinMarketWindow();
  const state: MarketState = {
    isOpen,
    tradeDate: getIstDateString(),
    message: isOpen ? 'Market is within regular IST trading hours (fallback)' : 'Market is outside regular IST trading hours (fallback)',
    source: 'fallback'
  };

  // Cache fallback for 1 minute
  cachedMarketState = { state, expiresAt: now + 60 * 1000 };
  return state;
}
