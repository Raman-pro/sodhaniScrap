import { PoolClient, Pool } from 'pg';

export interface LivePriceUpdate {
  finInstrmId: string;
  high: number;
  low: number;
  tradeDate?: string;
}

/**
 * Calculates and upserts price extremes (1d, 1w, 1m, 1y, 5y, all) for a single company
 * based on its rows in historical_prices.
 */
export async function calculateAndUpsertCompanyPriceExtremes(
  client: PoolClient | Pool,
  finInstrmId: string
): Promise<void> {
  const query = `
    WITH bounds AS (
      SELECT MAX(record_date) as max_date
      FROM historical_prices
      WHERE "FinInstrmId" = $1
    )
    INSERT INTO company_price_extremes (
      "FinInstrmId",
      high_1d, low_1d,
      high_1w, low_1w,
      high_1m, low_1m,
      high_1y, low_1y,
      high_5y, low_5y,
      high_all, low_all,
      last_trade_date,
      updated_at
    )
    SELECT 
      hp."FinInstrmId",
      MAX(CASE WHEN DATE(hp.record_date) = DATE(b.max_date) THEN hp.high_price END) as high_1d,
      MIN(CASE WHEN DATE(hp.record_date) = DATE(b.max_date) THEN hp.low_price END) as low_1d,
      MAX(CASE WHEN hp.record_date >= b.max_date - INTERVAL '7 days' THEN hp.high_price END) as high_1w,
      MIN(CASE WHEN hp.record_date >= b.max_date - INTERVAL '7 days' THEN hp.low_price END) as low_1w,
      MAX(CASE WHEN hp.record_date >= b.max_date - INTERVAL '1 month' THEN hp.high_price END) as high_1m,
      MIN(CASE WHEN hp.record_date >= b.max_date - INTERVAL '1 month' THEN hp.low_price END) as low_1m,
      MAX(CASE WHEN hp.record_date >= b.max_date - INTERVAL '1 year' THEN hp.high_price END) as high_1y,
      MIN(CASE WHEN hp.record_date >= b.max_date - INTERVAL '1 year' THEN hp.low_price END) as low_1y,
      MAX(CASE WHEN hp.record_date >= b.max_date - INTERVAL '5 years' THEN hp.high_price END) as high_5y,
      MIN(CASE WHEN hp.record_date >= b.max_date - INTERVAL '5 years' THEN hp.low_price END) as low_5y,
      MAX(hp.high_price) as high_all,
      MIN(hp.low_price) as low_all,
      DATE(b.max_date) as last_trade_date,
      CURRENT_TIMESTAMP as updated_at
    FROM historical_prices hp
    CROSS JOIN bounds b
    WHERE hp."FinInstrmId" = $1
      AND b.max_date IS NOT NULL
    GROUP BY hp."FinInstrmId", b.max_date
    ON CONFLICT ("FinInstrmId") DO UPDATE SET
      high_1d = EXCLUDED.high_1d,
      low_1d = EXCLUDED.low_1d,
      high_1w = EXCLUDED.high_1w,
      low_1w = EXCLUDED.low_1w,
      high_1m = EXCLUDED.high_1m,
      low_1m = EXCLUDED.low_1m,
      high_1y = EXCLUDED.high_1y,
      low_1y = EXCLUDED.low_1y,
      high_5y = EXCLUDED.high_5y,
      low_5y = EXCLUDED.low_5y,
      high_all = EXCLUDED.high_all,
      low_all = EXCLUDED.low_all,
      last_trade_date = EXCLUDED.last_trade_date,
      updated_at = CURRENT_TIMESTAMP;
  `;

  await client.query(query, [finInstrmId]);
}

/**
 * Bulk recalculates and populates company_price_extremes for all companies in company_stock
 * that have records in historical_prices.
 */
export async function syncAllPriceExtremes(client: PoolClient | Pool): Promise<number> {
  const query = `
    INSERT INTO company_price_extremes (
      "FinInstrmId",
      high_1d, low_1d,
      high_1w, low_1w,
      high_1m, low_1m,
      high_1y, low_1y,
      high_5y, low_5y,
      high_all, low_all,
      last_trade_date,
      updated_at
    )
    SELECT 
      hp."FinInstrmId",
      MAX(CASE WHEN DATE(hp.record_date) = DATE(b.max_date) THEN hp.high_price END) as high_1d,
      MIN(CASE WHEN DATE(hp.record_date) = DATE(b.max_date) THEN hp.low_price END) as low_1d,
      MAX(CASE WHEN hp.record_date >= b.max_date - INTERVAL '7 days' THEN hp.high_price END) as high_1w,
      MIN(CASE WHEN hp.record_date >= b.max_date - INTERVAL '7 days' THEN hp.low_price END) as low_1w,
      MAX(CASE WHEN hp.record_date >= b.max_date - INTERVAL '1 month' THEN hp.high_price END) as high_1m,
      MIN(CASE WHEN hp.record_date >= b.max_date - INTERVAL '1 month' THEN hp.low_price END) as low_1m,
      MAX(CASE WHEN hp.record_date >= b.max_date - INTERVAL '1 year' THEN hp.high_price END) as high_1y,
      MIN(CASE WHEN hp.record_date >= b.max_date - INTERVAL '1 year' THEN hp.low_price END) as low_1y,
      MAX(CASE WHEN hp.record_date >= b.max_date - INTERVAL '5 years' THEN hp.high_price END) as high_5y,
      MIN(CASE WHEN hp.record_date >= b.max_date - INTERVAL '5 years' THEN hp.low_price END) as low_5y,
      MAX(hp.high_price) as high_all,
      MIN(hp.low_price) as low_all,
      DATE(b.max_date) as last_trade_date,
      CURRENT_TIMESTAMP as updated_at
    FROM historical_prices hp
    JOIN (
      SELECT "FinInstrmId", MAX(record_date) as max_date
      FROM historical_prices
      GROUP BY "FinInstrmId"
    ) b ON hp."FinInstrmId" = b."FinInstrmId"
    GROUP BY hp."FinInstrmId", b.max_date
    ON CONFLICT ("FinInstrmId") DO UPDATE SET
      high_1d = EXCLUDED.high_1d,
      low_1d = EXCLUDED.low_1d,
      high_1w = EXCLUDED.high_1w,
      low_1w = EXCLUDED.low_1w,
      high_1m = EXCLUDED.high_1m,
      low_1m = EXCLUDED.low_1m,
      high_1y = EXCLUDED.high_1y,
      low_1y = EXCLUDED.low_1y,
      high_5y = EXCLUDED.high_5y,
      low_5y = EXCLUDED.low_5y,
      high_all = EXCLUDED.high_all,
      low_all = EXCLUDED.low_all,
      last_trade_date = EXCLUDED.last_trade_date,
      updated_at = CURRENT_TIMESTAMP;
  `;

  const result = await client.query(query);
  return result.rowCount || 0;
}

/**
 * Dynamically updates company_price_extremes with incoming live price ticks.
 * Checks whether live prices establish new highs or lows and updates accordingly.
 */
export async function updateLivePriceExtremes(
  client: PoolClient | Pool,
  updates: LivePriceUpdate[]
): Promise<void> {
  if (!updates || updates.length === 0) return;

  for (const update of updates) {
    const { finInstrmId, high, low, tradeDate } = update;
    if (isNaN(high) || isNaN(low) || high <= 0 || low <= 0) continue;

    const dateParam = tradeDate || new Date().toISOString().split('T')[0];

    const query = `
      INSERT INTO company_price_extremes (
        "FinInstrmId",
        high_1d, low_1d,
        high_1w, low_1w,
        high_1m, low_1m,
        high_1y, low_1y,
        high_5y, low_5y,
        high_all, low_all,
        last_trade_date,
        updated_at
      )
      VALUES ($1, $2, $3, $2, $3, $2, $3, $2, $3, $2, $3, $2, $3, $4::date, CURRENT_TIMESTAMP)
      ON CONFLICT ("FinInstrmId") DO UPDATE SET
        high_1d = CASE 
          WHEN company_price_extremes.last_trade_date IS NULL OR company_price_extremes.last_trade_date < EXCLUDED.last_trade_date 
          THEN EXCLUDED.high_1d
          ELSE GREATEST(company_price_extremes.high_1d, EXCLUDED.high_1d)
        END,
        low_1d = CASE 
          WHEN company_price_extremes.last_trade_date IS NULL OR company_price_extremes.last_trade_date < EXCLUDED.last_trade_date 
          THEN EXCLUDED.low_1d
          ELSE LEAST(company_price_extremes.low_1d, EXCLUDED.low_1d)
        END,
        high_1w = GREATEST(company_price_extremes.high_1w, EXCLUDED.high_1w),
        low_1w = LEAST(company_price_extremes.low_1w, EXCLUDED.low_1w),
        high_1m = GREATEST(company_price_extremes.high_1m, EXCLUDED.high_1m),
        low_1m = LEAST(company_price_extremes.low_1m, EXCLUDED.low_1m),
        high_1y = GREATEST(company_price_extremes.high_1y, EXCLUDED.high_1y),
        low_1y = LEAST(company_price_extremes.low_1y, EXCLUDED.low_1y),
        high_5y = GREATEST(company_price_extremes.high_5y, EXCLUDED.high_5y),
        low_5y = LEAST(company_price_extremes.low_5y, EXCLUDED.low_5y),
        high_all = GREATEST(company_price_extremes.high_all, EXCLUDED.high_all),
        low_all = LEAST(company_price_extremes.low_all, EXCLUDED.low_all),
        last_trade_date = GREATEST(company_price_extremes.last_trade_date, EXCLUDED.last_trade_date),
        updated_at = CURRENT_TIMESTAMP;
    `;

    await client.query(query, [finInstrmId, high, low, dateParam]);
  }
}
