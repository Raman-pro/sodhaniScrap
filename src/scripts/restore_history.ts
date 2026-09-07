import { pool } from '../db/pool';
import YahooFinance from 'yahoo-finance2';
// @ts-ignore
import format from 'pg-format';
import fs from 'fs';
import path from 'path';

const yahooFinance = new (YahooFinance as any)();

// Optional single-stock test flag: npx tsx src/scripts/restore_history.ts --symbol=500510
const targetSymbolArg = process.argv.find(arg => arg.startsWith('--symbol='));
const targetSymbol = targetSymbolArg ? targetSymbolArg.split('=')[1].trim() : null;

async function backfillHistory() {
  console.log('=== Starting Historical Backfill (2002 - 2026) ===');
  if (targetSymbol) {
    console.log(`Running in TARGET mode for single stock: ${targetSymbol}`);
  }

  const client = await pool.connect();
  const companiesDataPath = path.join(__dirname, '../../companies.json');
  let bseToNseMap: Record<string, string> = {};
  try {
    if (fs.existsSync(companiesDataPath)) {
      const companiesData = JSON.parse(fs.readFileSync(companiesDataPath, 'utf8'));
      bseToNseMap = companiesData.bse_to_nse || {};
    }
  } catch (err) {
    console.error('Failed to load companies.json:', err);
  }

  try {
    let query = `
      SELECT c."FinInstrmId", c."TckrSymb"
      FROM company_stock c
    `;
    const params: any[] = [];
    if (targetSymbol) {
      query += ` WHERE c."FinInstrmId"::text = $1 OR UPPER(c."TckrSymb") = UPPER($1)`;
      params.push(targetSymbol);
    }
    query += ` ORDER BY c."FinInstrmId" ASC`;

    const res = await client.query(query, params);
    const stocks = res.rows;
    console.log(`Found ${stocks.length} stocks to process.`);

    const period1 = '2002-03-01';
    const period2 = '2026-08-07';

    const upsertToDb = async (quotes: any[], FinInstrmId: string) => {
      if (!quotes || quotes.length === 0) return 0;

      const cleanQuotes = quotes.filter((q: any) => q.close !== null && q.open !== null);
      if (cleanQuotes.length === 0) return 0;

      const values = cleanQuotes.map((q: any) => [
        FinInstrmId,
        q.date.toISOString().split('T')[0], // Strict 00:00:00 midnight UTC
        q.open,
        q.high,
        q.low,
        q.close,
        q.adjclose || q.adjClose || null,
        q.volume || 0
      ]);

      const sql = format(`
        INSERT INTO historical_prices 
        ("FinInstrmId", record_date, open_price, high_price, low_price, close_price, adj_close, volume)
        VALUES %L
        ON CONFLICT ("FinInstrmId", record_date) DO NOTHING
      `, values);

      const insertRes = await client.query(sql);
      return insertRes.rowCount || 0;
    };

    const attemptFetch = async (sym: string) => {
      try {
        const result = await yahooFinance.chart(sym, { period1, period2 }, { validateResult: false });
        return result.quotes || [];
      } catch (err: any) {
        return [];
      }
    };

    let processed = 0;
    let totalInsertedRows = 0;

    for (let i = 0; i < stocks.length; i++) {
      const stock = stocks[i];
      const { FinInstrmId, TckrSymb } = stock;

      const isBseCode = /^\d{6}$/.test(FinInstrmId);
      const primarySymbol = isBseCode 
        ? `${FinInstrmId}.BO` 
        : (TckrSymb && TckrSymb.endsWith('.NS') ? TckrSymb : `${FinInstrmId}.NS`);

      let fallbackSymbol = null;
      if (TckrSymb && TckrSymb !== primarySymbol && TckrSymb !== FinInstrmId) {
        fallbackSymbol = TckrSymb.endsWith('.BO') || TckrSymb.endsWith('.NS') 
          ? TckrSymb 
          : `${TckrSymb}.BO`;
      }

      const nseSymbol = bseToNseMap[FinInstrmId] ? `${bseToNseMap[FinInstrmId]}.NS` : null;

      // 1. Try Primary
      let quotes = await attemptFetch(primarySymbol);

      // 2. Try Fallback if 0 quotes
      if ((!quotes || quotes.length === 0) && fallbackSymbol && fallbackSymbol !== primarySymbol) {
        quotes = await attemptFetch(fallbackSymbol);
      }

      // 3. Try NSE symbol if still 0 quotes
      if ((!quotes || quotes.length === 0) && nseSymbol && nseSymbol !== primarySymbol && nseSymbol !== fallbackSymbol) {
        quotes = await attemptFetch(nseSymbol);
      }

      if (quotes && quotes.length > 0) {
        const inserted = await upsertToDb(quotes, FinInstrmId);
        totalInsertedRows += inserted;
      }

      processed++;

      if (processed % 50 === 0 || processed === stocks.length || targetSymbol) {
        console.log(`Progress: [${processed}/${stocks.length}] stocks processed. Total historical rows backfilled: ${totalInsertedRows}`);
      }

      // Small throttle every 10 stocks to remain well within Yahoo rate limits
      if (processed % 10 === 0) {
        await new Promise(r => setTimeout(r, 200));
      }
    }

    console.log(`\n=== Backfill Complete! Successfully inserted ${totalInsertedRows} missing historical bars across ${processed} stocks. ===`);
  } catch (error) {
    console.error('Fatal error during backfill:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

backfillHistory();
