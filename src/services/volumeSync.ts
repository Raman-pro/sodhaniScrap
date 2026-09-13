import axios from 'axios';
import AdmZip from 'adm-zip';
import format from 'pg-format';
import { pool } from '../db/pool';

const BSE_HEADERS = {
  'accept': '*/*',
  'accept-encoding': 'gzip, deflate, br, zstd',
  'accept-language': 'en-US,en-IN;q=0.9,en;q=0.8',
  'origin': 'https://www.bseindia.com',
  'referer': 'https://www.bseindia.com/',
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
};

const NSE_HEADERS = {
  'accept': '*/*',
  'accept-encoding': 'gzip, deflate, br, zstd',
  'accept-language': 'en-US,en-IN;q=0.9,en;q=0.8',
  'referer': 'https://www.nseindia.com/',
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
};

const MONTH_MAP: Record<string, string> = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12'
};

export interface FormattedDate {
  year: string;   // e.g. '2026'
  month: string;  // e.g. '09'
  day: string;    // e.g. '11'
  dateStr: string;// e.g. '2026-09-11'
  weekday: string;// e.g. 'Fri'
  hours: number;
  minutes: number;
}

export function getIstDateDetails(d: Date = new Date()): FormattedDate {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false
  }).formatToParts(d);

  const year = parts.find(p => p.type === 'year')?.value || '';
  const month = parts.find(p => p.type === 'month')?.value || '';
  const day = parts.find(p => p.type === 'day')?.value || '';
  const weekday = parts.find(p => p.type === 'weekday')?.value || '';
  const hours = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
  const minutes = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);

  return {
    year,
    month,
    day,
    dateStr: `${year}-${month}-${day}`,
    weekday,
    hours,
    minutes
  };
}

export function parseBseDateString(bseDate: string, fallbackDateStr: string): string {
  const clean = bseDate.trim();
  if (clean.length === 8 && /^\d{8}$/.test(clean)) {
    const d = clean.substring(0, 2);
    const m = clean.substring(2, 4);
    const y = clean.substring(4, 8);
    return `${y}-${m}-${d}`;
  }
  return fallbackDateStr;
}

export function parseNseDateString(nseDate: string, fallbackDateStr: string): string {
  // e.g. '11-Sep-2026'
  const parts = nseDate.trim().split('-');
  if (parts.length === 3) {
    const day = parts[0].padStart(2, '0');
    const month = MONTH_MAP[parts[1]] || '01';
    const year = parts[2];
    return `${year}-${month}-${day}`;
  }
  return fallbackDateStr;
}

/**
 * Downloads and parses BSE Gross Deliverable & Volume Bhavcopy (SCBSEALL{DD}{MM}.zip)
 * URL: https://www.bseindia.com/BSEDATA/gross/{YYYY}/SCBSEALL{DD}{MM}.zip
 */
export async function downloadBseBhavcopy(targetDate: Date = new Date()): Promise<{ success: boolean; count: number; error?: string }> {
  const { year, month, day, dateStr } = getIstDateDetails(targetDate);
  const url = `https://www.bseindia.com/BSEDATA/gross/${year}/SCBSEALL${day}${month}.zip`;
  console.log(`[BSE Bhavcopy] Fetching ${url} for date ${dateStr}...`);

  try {
    const response = await axios.get(url, {
      headers: BSE_HEADERS,
      responseType: 'arraybuffer',
      timeout: 30000,
      validateStatus: (status) => status === 200
    });

    const zipBuffer = Buffer.from(response.data);
    const zip = new AdmZip(zipBuffer);
    const zipEntries = zip.getEntries();

    const txtEntry = zipEntries.find(entry => entry.entryName.toLowerCase().endsWith('.txt'));
    if (!txtEntry) {
      throw new Error(`No .txt file found inside BSE zip archive for ${dateStr}`);
    }

    const rawText = txtEntry.getData().toString('utf8');
    const lines = rawText.split(/\r?\n/).filter(line => line.trim().length > 0);

    if (lines.length <= 1) {
      console.warn(`[BSE Bhavcopy] Empty or header-only file for ${dateStr}`);
      return { success: false, count: 0, error: 'Empty file' };
    }

    // Header expected: DATE|SCRIP CODE|DELIVERY QTY|DELIVERY VAL|DAY'S VOLUME|DAY'S TURNOVER|DELV. PER.
    const dataLines = lines.slice(1);
    const parsedRows: any[][] = [];

    for (const line of dataLines) {
      const cols = line.split('|').map(c => c.trim());
      if (cols.length < 7) continue;

      const [dateRaw, scripCd, delivQtyRaw, delivValRaw, volRaw, turnoverRaw, delvPerRaw] = cols;
      if (!scripCd) continue;

      const recordDate = parseBseDateString(dateRaw, dateStr);
      const volume = volRaw ? parseInt(volRaw, 10) : null;
      const deliveryQty = delivQtyRaw ? parseInt(delivQtyRaw, 10) : null;
      const deliveryVal = delivValRaw ? parseFloat(delivValRaw) : null;
      const turnover = turnoverRaw ? parseFloat(turnoverRaw) : null;
      const deliveryPct = delvPerRaw ? parseFloat(delvPerRaw) : null;

      parsedRows.push([
        scripCd,
        recordDate,
        isNaN(volume as number) ? null : volume,
        isNaN(deliveryQty as number) ? null : deliveryQty,
        isNaN(deliveryVal as number) ? null : deliveryVal,
        isNaN(turnover as number) ? null : turnover,
        isNaN(deliveryPct as number) ? null : deliveryPct
      ]);
    }

    console.log(`[BSE Bhavcopy] Parsed ${parsedRows.length} rows. Upserting into bse_volume_history...`);

    const client = await pool.connect();
    let totalInserted = 0;

    try {
      await client.query('BEGIN');

      const BATCH_SIZE = 1000;
      for (let i = 0; i < parsedRows.length; i += BATCH_SIZE) {
        const batch = parsedRows.slice(i, i + BATCH_SIZE);
        const query = format(`
          INSERT INTO bse_volume_history
          (scrip_cd, record_date, volume, delivery_qty, delivery_val, turnover, delivery_pct)
          VALUES %L
          ON CONFLICT (scrip_cd, record_date) DO UPDATE SET
            volume = EXCLUDED.volume,
            delivery_qty = EXCLUDED.delivery_qty,
            delivery_val = EXCLUDED.delivery_val,
            turnover = EXCLUDED.turnover,
            delivery_pct = EXCLUDED.delivery_pct,
            updated_at = CURRENT_TIMESTAMP
        `, batch);

        const res = await client.query(query);
        totalInserted += res.rowCount || 0;
      }

      await client.query(`
        INSERT INTO sync_metadata (key, value)
        VALUES ($1, $2)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
      `, [`bse_volume_sync_${dateStr}`, `synced:${totalInserted}:${new Date().toISOString()}`]);

      await client.query('COMMIT');
      console.log(`[BSE Bhavcopy] Successfully synced ${totalInserted} records for ${dateStr}.`);
      return { success: true, count: totalInserted };
    } catch (err: any) {
      await client.query('ROLLBACK');
      console.error(`[BSE Bhavcopy] DB error during batch insert for ${dateStr}:`, err);
      throw err;
    } finally {
      client.release();
    }
  } catch (error: any) {
    if (error.response?.status === 404) {
      console.log(`[BSE Bhavcopy] File not yet available (HTTP 404) for ${dateStr} at ${url}`);
      return { success: false, count: 0, error: 'NOT_FOUND' };
    }
    console.error(`[BSE Bhavcopy] Failed to download or process BSE bhavcopy: ${error.message}`);
    return { success: false, count: 0, error: error.message };
  }
}

/**
 * Downloads and parses NSE Full Bhavcopy (sec_bhavdata_full_{DD}{MM}{YYYY}.csv)
 * URL: https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_{DD}{MM}{YYYY}.csv
 * Only volume-related attributes are ingested.
 */
export async function downloadNseBhavcopy(targetDate: Date = new Date()): Promise<{ success: boolean; count: number; error?: string }> {
  const { year, month, day, dateStr } = getIstDateDetails(targetDate);
  const url = `https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_${day}${month}${year}.csv`;
  console.log(`[NSE Bhavcopy] Fetching ${url} for date ${dateStr}...`);

  try {
    const response = await axios.get(url, {
      headers: NSE_HEADERS,
      responseType: 'text',
      timeout: 30000,
      validateStatus: (status) => status === 200
    });

    const rawCsv = response.data;
    if (!rawCsv || typeof rawCsv !== 'string') {
      throw new Error(`Empty response received from NSE for ${dateStr}`);
    }

    const lines = rawCsv.split(/\r?\n/).filter(line => line.trim().length > 0);
    if (lines.length <= 1) {
      console.warn(`[NSE Bhavcopy] Empty or header-only file for ${dateStr}`);
      return { success: false, count: 0, error: 'Empty file' };
    }

    // Header: SYMBOL, SERIES, DATE1, PREV_CLOSE, OPEN_PRICE, HIGH_PRICE, LOW_PRICE, LAST_PRICE, CLOSE_PRICE, AVG_PRICE, TTL_TRD_QNTY, TURNOVER_LACS, NO_OF_TRADES, DELIV_QTY, DELIV_PER
    const headerCols = lines[0].split(',').map(c => c.trim().toUpperCase());
    const symbolIdx = headerCols.indexOf('SYMBOL');
    const seriesIdx = headerCols.indexOf('SERIES');
    const dateIdx = headerCols.indexOf('DATE1');
    const volIdx = headerCols.indexOf('TTL_TRD_QNTY');
    const turnoverLacsIdx = headerCols.indexOf('TURNOVER_LACS');
    const tradesIdx = headerCols.indexOf('NO_OF_TRADES');
    const delivQtyIdx = headerCols.indexOf('DELIV_QTY');
    const delivPerIdx = headerCols.indexOf('DELIV_PER');

    if (symbolIdx === -1 || volIdx === -1) {
      throw new Error(`Invalid CSV header format received from NSE: ${lines[0]}`);
    }

    const dataLines = lines.slice(1);
    const parsedRows: any[][] = [];

    for (const line of dataLines) {
      const cols = line.split(',').map(c => c.trim());
      if (cols.length <= symbolIdx || cols.length <= volIdx) continue;

      const symbol = cols[symbolIdx];
      if (!symbol) continue;

      const series = seriesIdx !== -1 && cols[seriesIdx] ? cols[seriesIdx] : 'EQ';
      const rawDate = dateIdx !== -1 ? cols[dateIdx] : '';
      const recordDate = parseNseDateString(rawDate, dateStr);

      const rawVol = cols[volIdx];
      const volume = rawVol && rawVol !== '-' ? parseInt(rawVol, 10) : null;

      const rawDelivQty = delivQtyIdx !== -1 ? cols[delivQtyIdx] : null;
      const deliveryQty = rawDelivQty && rawDelivQty !== '-' ? parseInt(rawDelivQty, 10) : null;

      const rawDelivPer = delivPerIdx !== -1 ? cols[delivPerIdx] : null;
      const deliveryPct = rawDelivPer && rawDelivPer !== '-' ? parseFloat(rawDelivPer) : null;

      const rawTurnoverLacs = turnoverLacsIdx !== -1 ? cols[turnoverLacsIdx] : null;
      // Convert turnover from lacs to rupees (1 lac = 100,000)
      const turnover = rawTurnoverLacs && rawTurnoverLacs !== '-' ? parseFloat(rawTurnoverLacs) * 100000 : null;

      const rawTrades = tradesIdx !== -1 ? cols[tradesIdx] : null;
      const noOfTrades = rawTrades && rawTrades !== '-' ? parseInt(rawTrades, 10) : null;

      parsedRows.push([
        symbol,
        series,
        recordDate,
        isNaN(volume as number) ? null : volume,
        isNaN(deliveryQty as number) ? null : deliveryQty,
        isNaN(deliveryPct as number) ? null : deliveryPct,
        isNaN(turnover as number) ? null : turnover,
        isNaN(noOfTrades as number) ? null : noOfTrades
      ]);
    }

    console.log(`[NSE Bhavcopy] Parsed ${parsedRows.length} rows. Upserting into nse_volume_history...`);

    const client = await pool.connect();
    let totalInserted = 0;

    try {
      await client.query('BEGIN');

      const BATCH_SIZE = 1000;
      for (let i = 0; i < parsedRows.length; i += BATCH_SIZE) {
        const batch = parsedRows.slice(i, i + BATCH_SIZE);
        const query = format(`
          INSERT INTO nse_volume_history
          (symbol, series, record_date, volume, delivery_qty, delivery_pct, turnover, no_of_trades)
          VALUES %L
          ON CONFLICT (symbol, series, record_date) DO UPDATE SET
            volume = EXCLUDED.volume,
            delivery_qty = EXCLUDED.delivery_qty,
            delivery_pct = EXCLUDED.delivery_pct,
            turnover = EXCLUDED.turnover,
            no_of_trades = EXCLUDED.no_of_trades,
            updated_at = CURRENT_TIMESTAMP
        `, batch);

        const res = await client.query(query);
        totalInserted += res.rowCount || 0;
      }

      await client.query(`
        INSERT INTO sync_metadata (key, value)
        VALUES ($1, $2)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
      `, [`nse_volume_sync_${dateStr}`, `synced:${totalInserted}:${new Date().toISOString()}`]);

      await client.query('COMMIT');
      console.log(`[NSE Bhavcopy] Successfully synced ${totalInserted} records for ${dateStr}.`);
      return { success: true, count: totalInserted };
    } catch (err: any) {
      await client.query('ROLLBACK');
      console.error(`[NSE Bhavcopy] DB error during batch insert for ${dateStr}:`, err);
      throw err;
    } finally {
      client.release();
    }
  } catch (error: any) {
    if (error.response?.status === 404) {
      console.log(`[NSE Bhavcopy] File not yet available (HTTP 404) for ${dateStr} at ${url}`);
      return { success: false, count: 0, error: 'NOT_FOUND' };
    }
    console.error(`[NSE Bhavcopy] Failed to download or process NSE bhavcopy: ${error.message}`);
    return { success: false, count: 0, error: error.message };
  }
}

/**
 * Checks if Bhavcopy volume data is already synced for a given date.
 */
export async function isVolumeSyncedForDate(dateStr: string): Promise<{ bse: boolean; nse: boolean }> {
  const client = await pool.connect();
  try {
    const res = await client.query(`
      SELECT key FROM sync_metadata 
      WHERE key IN ($1, $2)
    `, [`bse_volume_sync_${dateStr}`, `nse_volume_sync_${dateStr}`]);

    const keys = new Set(res.rows.map(r => r.key));
    return {
      bse: keys.has(`bse_volume_sync_${dateStr}`),
      nse: keys.has(`nse_volume_sync_${dateStr}`)
    };
  } finally {
    client.release();
  }
}

export interface VolumeSyncResult {
  success: boolean;
  count: number;
  error?: string;
}

/**
 * Synchronizes volume data for a given date across both BSE and NSE.
 */
export async function syncVolumesForDate(
  targetDate: Date = new Date(),
  options: { force?: boolean } = {}
): Promise<{ bse: VolumeSyncResult; nse: VolumeSyncResult }> {
  const { dateStr } = getIstDateDetails(targetDate);
  const status = await isVolumeSyncedForDate(dateStr);

  let bseResult: VolumeSyncResult = { success: true, count: 0 };
  let nseResult: VolumeSyncResult = { success: true, count: 0 };

  if (options.force || !status.bse) {
    bseResult = await downloadBseBhavcopy(targetDate);
  } else {
    console.log(`[Volume Sync] BSE Bhavcopy already synced for ${dateStr}. Use --force to re-sync.`);
  }

  if (options.force || !status.nse) {
    nseResult = await downloadNseBhavcopy(targetDate);
  } else {
    console.log(`[Volume Sync] NSE Bhavcopy already synced for ${dateStr}. Use --force to re-sync.`);
  }

  return { bse: bseResult, nse: nseResult };
}
