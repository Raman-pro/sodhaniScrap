import axios from 'axios';
import { pool } from '../db/pool';
// @ts-ignore
import format from 'pg-format';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { updateLivePriceExtremes } from './priceExtremesService';
import { isPayloadStale, parseBseDate, parseExchangeDateTimeToIso } from '../utils/exchangeState';
const execFileAsync = promisify(execFile);

function getNseStockCodes(dbRows: any[]): Set<string> {
  const nseCodes = new Set<string>();

  try {
    const jsonPath = path.join(__dirname, '../../companies.json');
    if (fs.existsSync(jsonPath)) {
      const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      if (data.bse_to_nse) {
        for (const bseCode of Object.keys(data.bse_to_nse)) {
          nseCodes.add(bseCode);
        }
      }
      if (data.nse_only) {
        for (const nseCode of data.nse_only) {
          nseCodes.add(nseCode);
        }
      }
    }
  } catch (err: any) {
    console.warn('Could not read companies.json for dual-listed mapping:', err.message);
  }

  for (const r of dbRows) {
    if (r.Src === 'NSE') {
      nseCodes.add(r.FinInstrmId);
    }
  }

  return nseCodes;
}

const BSE_HEADERS = {
    "accept": "application/json, text/plain, */*",
    "accept-language": "en-US,en-IN;q=0.9,en;q=0.8",
    "priority": "u=1, i",
    "sec-ch-ua": "\"Not;A=Brand\";v=\"8\", \"Chromium\";v=\"150\", \"Google Chrome\";v=\"150\"",
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": "\"macOS\"",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-site",
    "Referer": "https://www.bseindia.com/"
};


async function fetchBSEData(url: string) {
  try {
    const { stdout } = await execFileAsync('curl', [
      '-s',
      '-m', '15',
      '-H', 'accept: application/json',
      '-H', 'user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      '-H', 'Referer: https://www.bseindia.com/',
      url
    ], { maxBuffer: 10 * 1024 * 1024 });
    return JSON.parse(stdout);
  } catch (error: any) {
    console.error(`BSE Fetch Error for ${url}:`, error.message);
    return [];
  }
}

export async function bseLiveSync() {
  console.log(`[${new Date().toISOString()}] Phase 3: Executing BSE Live Sync...`);
  
  const gainerUrl = 'https://api.bseindia.com/BseIndiaAPI/api/MktRGainerLoserDataeqto/w?GLtype=gainer&IndxGrp=AllMkt&IndxGrpval=AllMkt&orderby=all';
  const loserUrl = 'https://api.bseindia.com/BseIndiaAPI/api/MktRGainerLoserDataeqto/w?GLtype=loser&IndxGrp=AllMkt&IndxGrpval=AllMkt&orderby=all';

  console.log('Fetching gainers from:', gainerUrl);
  console.log('Fetching losers from:', loserUrl);

  // Fetch gainers and losers using curl wrapper
  const gainers = await fetchBSEData(gainerUrl);
  await new Promise(resolve => setTimeout(resolve, 2000));
  const losers = await fetchBSEData(loserUrl);

  // Fully numeric BSE scrip codes must start with 5 to be equities (other numeric ranges are
  // debt, mutual funds, etc.); non-numeric codes aren't part of that numbering scheme so leave them be.
  const isEquityCode = (scripCd: any) => {
    const code = String(scripCd);
    return /^\d+$/.test(code) ? code.startsWith('5') : true;
  };

  const gainersList = (gainers?.Table || []).filter((item: any) => isEquityCode(item.scrip_cd));
  const losersList = ((losers as any)?.Table || []).filter((item: any) => isEquityCode(item.scrip_cd));
  console.log(`Fetched ${gainersList.length} gainers, ${losersList.length} losers from BSE.`);
  if (gainersList.length > 0) {
    console.log(`Top gainer: ${gainersList[0].scripname} change_percent=${gainersList[0].change_percent}`);
  }
  if (losersList.length > 0) {
    console.log(`Top loser: ${losersList[0].scripname} change_percent=${losersList[0].change_percent}`);
  }
  
  const allData = [...gainersList, ...losersList];
  
  if (allData.length === 0) {
    console.log('No data fetched from BSE.');
    return;
  }

  // Find latest timestamp across the payload
  let latestDtTm = '';
  for (const item of allData) {
    if (item.dt_tm && item.dt_tm > latestDtTm) {
      latestDtTm = item.dt_tm;
    }
  }

  if (latestDtTm && isPayloadStale('bse_live_sync', latestDtTm)) {
    console.log(`[BSE Live Sync] Payload timestamp unchanged (${latestDtTm}). Skipping DB write.`);
    return;
  }

  // Verify derived trade date is not an inadvertent weekend tick
  if (latestDtTm) {
    const tradeDateStr = parseBseDate(latestDtTm);
    const tradeDay = new Date(`${tradeDateStr}T12:00:00Z`).getUTCDay();
    if (tradeDay === 0 || tradeDay === 6) {
      console.warn(`[BSE Live Sync] Derived trade date ${tradeDateStr} is a weekend. Skipping DB write.`);
      return;
    }
  }

  const seen = new Set<string>();
  const values: any[] = [];
  
  for (const item of allData) {
    const recordDate = item.dt_tm 
      ? parseExchangeDateTimeToIso(item.dt_tm) 
      : (latestDtTm ? parseExchangeDateTimeToIso(latestDtTm) : new Date().toISOString());
    const key = `${item.scrip_cd}_${recordDate}`;
    
    if (!seen.has(key)) {
      seen.add(key);

      // The official exchange previous close ships in the same record as the
      // last traded price, so it rides along on this row rather than needing a
      // second pass that back-writes into yesterday's bar.
      const prevClose = parseFloat(item.prevdayclose);

      values.push([
        item.scrip_cd.toString(), // FinInstrmId
        recordDate,
        item.openrate,
        item.highrate,
        item.lowrate,
        item.ltradert, // close_price
        item.trd_vol,
        prevClose > 0 ? prevClose : null
      ]);
    }
  }

  if (values.length === 0) return;

  const client = await pool.connect();

  try {
    const validCodesRes = await client.query('SELECT "FinInstrmId", "TckrSymb", "Src" FROM company_stock');
    const validCodes = new Set(validCodesRes.rows.map(r => r.FinInstrmId));
    const nseCodes = getNseStockCodes(validCodesRes.rows);
    
    // NSE is the authority on previous close for dual-listed scrips. nseLiveSync
    // runs after this one and writes its own row (at its own timestamp) for the
    // same trading day, so keeping the BSE value here would leave two different
    // prev_close values on the same day with no way to tell which one wins.
    // Drop it for those codes instead; the NSE row supplies it.
    const validValues = values
      .filter(v => validCodes.has(v[0]))
      .map(v => (nseCodes.has(v[0]) ? [...v.slice(0, 7), null] : v));

    if (validValues.length === 0) {
      console.log('No valid equities matched in database. Skipping live sync.');
      return;
    }

    const query = format(`
      INSERT INTO historical_prices
      ("FinInstrmId", record_date, open_price, high_price, low_price, close_price, volume, prev_close)
      VALUES %L
      ON CONFLICT ("FinInstrmId", record_date)
      DO UPDATE SET
        open_price = COALESCE(EXCLUDED.open_price, historical_prices.open_price),
        high_price = EXCLUDED.high_price,
        low_price = EXCLUDED.low_price,
        close_price = EXCLUDED.close_price,
        volume = EXCLUDED.volume,
        prev_close = COALESCE(EXCLUDED.prev_close, historical_prices.prev_close)
    `, validValues);

    await client.query(query);
    console.log(`Successfully updated live prices for ${validValues.length} equities.`);

    try {
      const liveUpdates = validValues.map((v) => {
        const finInstrmId = v[0];
        const recordDate = v[1];
        const high = parseFloat(v[3] || v[5] || '0');
        const low = parseFloat(v[4] || v[5] || '0');
        const tradeDate = String(recordDate).split('T')[0];
        return { finInstrmId, high, low, tradeDate };
      }).filter(u => u.high > 0 && u.low > 0);

      await updateLivePriceExtremes(client, liveUpdates);
      console.log(`Successfully updated live price extremes for ${liveUpdates.length} equities.`);
    } catch (extremesErr: any) {
      console.error('Error updating live price extremes:', extremesErr.message);
    }

    // Update top 10 gainers and losers
    const topGainersLosersValues = [];
    
    const safeIsoDate = (dtTm?: string) => {
      if (dtTm) {
        try {
          const d = new Date(dtTm.replace('T', ' ') + " GMT+0530");
          if (!isNaN(d.getTime())) return d.toISOString();
        } catch {}
      }
      return new Date().toISOString();
    };

    // Process Gainers (Top 50)
    for (let i = 0; i < Math.min(50, gainersList.length); i++) {
        const item = gainersList[i];
        const recordTime = safeIsoDate(item.dt_tm);
        topGainersLosersValues.push([
            recordTime,
            'gainer',
            i + 1,
            item.scrip_cd.toString(),
            item.scripname,
            item.LONG_NAME || null,
            item.ltradert,
            item.change_val,
            item.change_percent
        ]);
    }
    
    // Process Losers (Top 50)
    for (let i = 0; i < Math.min(50, losersList.length); i++) {
        const item = losersList[i];
        const recordTime = safeIsoDate(item.dt_tm);
        topGainersLosersValues.push([
            recordTime,
            'loser',
            i + 1,
            item.scrip_cd.toString(),
            item.scripname,
            item.LONG_NAME || null,
            item.ltradert,
            item.change_val,
            item.change_percent
        ]);
    }

    if (topGainersLosersValues.length > 0) {
        const glQuery = format(`
          INSERT INTO bse_top_gainers_losers 
          ("record_time", "type", "rank", "scrip_cd", "scripname", "long_name", "ltradert", "change_val", "change_percent")
          VALUES %L
          ON CONFLICT ("type", "rank") DO UPDATE SET
            "record_time" = EXCLUDED.record_time,
            "scrip_cd" = EXCLUDED.scrip_cd,
            "scripname" = EXCLUDED.scripname,
            "long_name" = EXCLUDED.long_name,
            "ltradert" = EXCLUDED.ltradert,
            "change_val" = EXCLUDED.change_val,
            "change_percent" = EXCLUDED.change_percent
        `, topGainersLosersValues);
        
        await client.query(glQuery);
        console.log(`Successfully updated Top 10 Gainers and Losers (${topGainersLosersValues.length} records).`);
    }

  } catch (err) {
    console.error('Error during BSE live sync DB upsert:', err);
  } finally {
    client.release();
  }
}
