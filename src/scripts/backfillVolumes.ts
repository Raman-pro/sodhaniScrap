import { pool } from '../db/pool';

/**
 * Backfills existing volume data from historical_prices into bse_volume_history
 * and nse_volume_history. All extra Bhavcopy columns (delivery_qty, turnover, etc.)
 * are left as NULL as specified in volumes.md.
 */
async function backfillVolumes() {
  console.log('--- Starting Historical Volume Backfill ---');
  const args = process.argv.slice(2);
  const bseOnly = args.includes('--bse-only');
  const nseOnly = args.includes('--nse-only');
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx !== -1 && args[limitIdx + 1] ? parseInt(args[limitIdx + 1], 10) : null;

  const client = await pool.connect();
  const startTime = Date.now();

  try {
    // 1. Backfill BSE stocks (numeric FinInstrmId)
    if (!nseOnly) {
      console.log('\n[1/2] Fetching list of BSE stocks with historical price/volume data...');
      const bseStocksQuery = `
        SELECT DISTINCT "FinInstrmId"
        FROM company_stock
        WHERE "FinInstrmId" ~ '^[0-9]+$'
        ORDER BY "FinInstrmId"
        ${limit ? `LIMIT ${limit}` : ''}
      `;
      const bseStocksRes = await client.query(bseStocksQuery);
      const bseStocks = bseStocksRes.rows.map(r => r.FinInstrmId);
      console.log(`Found ${bseStocks.length} BSE stocks to backfill.`);

      const CHUNK_SIZE = 100;
      let bseTotalInserted = 0;

      for (let i = 0; i < bseStocks.length; i += CHUNK_SIZE) {
        const chunk = bseStocks.slice(i, i + CHUNK_SIZE);
        const chunkStart = Date.now();

        const insertQuery = `
          INSERT INTO bse_volume_history (scrip_cd, record_date, volume)
          SELECT "FinInstrmId", record_date::date, volume
          FROM historical_prices
          WHERE "FinInstrmId" = ANY($1) AND volume IS NOT NULL
          ON CONFLICT (scrip_cd, record_date) DO NOTHING;
        `;
        const res = await client.query(insertQuery, [chunk]);
        const inserted = res.rowCount || 0;
        bseTotalInserted += inserted;

        const percent = (((i + chunk.length) / bseStocks.length) * 100).toFixed(1);
        console.log(`[BSE Backfill] [${i + chunk.length}/${bseStocks.length}] (${percent}%) Processed ${chunk.length} stocks (+${inserted} rows, total: ${bseTotalInserted}) in ${Date.now() - chunkStart}ms`);
      }

      console.log(`[BSE Backfill Complete] Migrated ${bseTotalInserted} rows into bse_volume_history.`);
    }

    // 2. Backfill NSE stocks (non-numeric FinInstrmId)
    if (!bseOnly) {
      console.log('\n[2/2] Fetching list of NSE stocks with historical price/volume data...');
      const nseStocksQuery = `
        SELECT DISTINCT "FinInstrmId"
        FROM company_stock
        WHERE NOT ("FinInstrmId" ~ '^[0-9]+$')
        ORDER BY "FinInstrmId"
        ${limit ? `LIMIT ${limit}` : ''}
      `;
      const nseStocksRes = await client.query(nseStocksQuery);
      const nseStocks = nseStocksRes.rows.map(r => r.FinInstrmId);
      console.log(`Found ${nseStocks.length} NSE stocks to backfill.`);

      const CHUNK_SIZE = 100;
      let nseTotalInserted = 0;

      for (let i = 0; i < nseStocks.length; i += CHUNK_SIZE) {
        const chunk = nseStocks.slice(i, i + CHUNK_SIZE);
        const chunkStart = Date.now();

        const insertQuery = `
          INSERT INTO nse_volume_history (symbol, series, record_date, volume)
          SELECT "FinInstrmId", 'EQ', record_date::date, volume
          FROM historical_prices
          WHERE "FinInstrmId" = ANY($1) AND volume IS NOT NULL
          ON CONFLICT (symbol, series, record_date) DO NOTHING;
        `;
        const res = await client.query(insertQuery, [chunk]);
        const inserted = res.rowCount || 0;
        nseTotalInserted += inserted;

        const percent = (((i + chunk.length) / nseStocks.length) * 100).toFixed(1);
        console.log(`[NSE Backfill] [${i + chunk.length}/${nseStocks.length}] (${percent}%) Processed ${chunk.length} stocks (+${inserted} rows, total: ${nseTotalInserted}) in ${Date.now() - chunkStart}ms`);
      }

      console.log(`[NSE Backfill Complete] Migrated ${nseTotalInserted} rows into nse_volume_history.`);
    }

    // If full backfill without limits, record completion in sync_metadata
    if (!limit && !bseOnly && !nseOnly) {
      await client.query(`
        INSERT INTO sync_metadata (key, value)
        VALUES ('volume_history_backfill_completed', 'true')
        ON CONFLICT (key) DO UPDATE SET value = 'true'
      `);
      console.log('Recorded volume_history_backfill_completed in sync_metadata.');
    }

    const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n--- Volume Backfill Successfully Finished in ${elapsedSec}s ---`);
  } catch (error) {
    console.error('Fatal error during volume backfill:', error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

backfillVolumes();
