import fs from 'fs';
import path from 'path';
import { pool } from '../db/pool';

// Helper to safely parse numbers from strings like "₹ 1,284" or "7.78 %"
function parseCleanNumber(val: any): number {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  const str = String(val).replace(/,/g, '');
  const match = str.match(/-?\d+(\.\d+)?/);
  return match ? parseFloat(match[0]) : 0;
}

export async function metricsSync() {
  console.log('Starting daily metrics sync for all stocks...');
  const client = await pool.connect();
  
  try {
    // Try to load BSE to NSE mappings
    let bseToNse: Record<string, string> = {};
    try {
      // Assuming sodhaniScrap is next to sodhani-api in /opt/ or locally
      const mappingsPath = path.resolve(process.cwd(), '../sodhani-api/exchange_code_mappings.json');
      if (fs.existsSync(mappingsPath)) {
        bseToNse = JSON.parse(fs.readFileSync(mappingsPath, 'utf8'))?.bse_to_nse || {};
      }
    } catch(e: any) {
      console.error('Could not load mappings:', e.message);
    }

    // Get all stocks that have historical prices
    const historyResult = await client.query(`
      SELECT DISTINCT ON (hp."FinInstrmId") 
        cs."TckrSymb",
        hp.close_price
      FROM historical_prices hp
      JOIN company_stock cs ON cs."FinInstrmId" = hp."FinInstrmId"
      WHERE cs."TckrSymb" IS NOT NULL
      ORDER BY hp."FinInstrmId", hp."record_date" DESC
    `);
    
    console.log(`Found ${historyResult.rows.length} stocks with historical prices.`);

    const outputConsolidated = path.resolve(process.cwd(), 'output_consolidated');
    const outputDir = path.resolve(process.cwd(), 'output');
    
    let processed = 0;
    
    for (const row of historyResult.rows) {
      const symbol = row.TckrSymb.toUpperCase();
      const nseSymbol = bseToNse[symbol] || symbol;
      const cmp = parseFloat(row.close_price);
      
      if (isNaN(cmp)) continue;

      // Try NSE symbol first, then BSE symbol
      let jsonPath = path.join(outputConsolidated, `${nseSymbol}.json`);
      if (!fs.existsSync(jsonPath)) {
        jsonPath = path.join(outputDir, `${nseSymbol}.json`);
      }
      if (!fs.existsSync(jsonPath)) {
        jsonPath = path.join(outputConsolidated, `${symbol}.json`);
      }
      if (!fs.existsSync(jsonPath)) {
        jsonPath = path.join(outputDir, `${symbol}.json`);
      }
      
      if (!fs.existsSync(jsonPath)) continue; // No json for this stock

      try {
        const rawData = fs.readFileSync(jsonPath, 'utf8');
        const json = JSON.parse(rawData);

        const mktCapJson = parseCleanNumber(json.key_metrics?.["Market Cap"]);
        const currentPriceJson = parseCleanNumber(json.key_metrics?.["Current Price"]);
        const roce = parseCleanNumber(json.key_metrics?.["ROCE"]);

        // Calculate Shares Outstanding and Live Mkt Cap
        let sharesOutstanding = 0;
        if (currentPriceJson > 0) {
          sharesOutstanding = mktCapJson / currentPriceJson;
        }
        const liveMktCap = cmp * sharesOutstanding;

        // Extract from profit_loss
        let annualEps = 0;
        let dividendPayout = 0;
        if (Array.isArray(json.profit_loss)) {
          const epsRow = json.profit_loss.find((r: any) => r[""] === "EPS in Rs");
          const divRow = json.profit_loss.find((r: any) => r[""] === "Dividend Payout %");
          const headerRow = json.profit_loss[0];
          
          if (headerRow) {
            const keys = Object.keys(headerRow).filter(k => k !== "");
            if (keys.length > 0) {
              const latestYear = keys[keys.length - 1];
              if (epsRow) annualEps = parseCleanNumber(epsRow[latestYear]);
              if (divRow) dividendPayout = parseCleanNumber(divRow[latestYear]);
            }
          }
        }

        let pe = 0;
        if (annualEps > 0) {
          pe = cmp / annualEps;
        }

        let annualDividendPerShare = annualEps * (dividendPayout / 100);
        let divYld = 0;
        if (cmp > 0) {
          divYld = (annualDividendPerShare / cmp) * 100;
        }

        // Extract from quarterly
        let npQtr = 0;
        let profitVar = 0;
        let salesQtr = 0;
        let salesVar = 0;

        if (Array.isArray(json.quarterly)) {
          const netProfitRow = json.quarterly.find((r: any) => r[""] === "Net Profit");
          const salesRow = json.quarterly.find((r: any) => r[""] === "Sales");
          const headerRow = json.quarterly[0];
          
          if (headerRow) {
            const keys = Object.keys(headerRow).filter(k => k !== "");
            if (keys.length > 0) {
              const latestQtr = keys[keys.length - 1];
              
              if (netProfitRow) {
                npQtr = parseCleanNumber(netProfitRow[latestQtr]);
                if (Array.isArray(netProfitRow.children)) {
                   const profitVarRow = netProfitRow.children.find((r: any) => r[""] === "YOY Profit Growth %");
                   if (profitVarRow) profitVar = parseCleanNumber(profitVarRow[latestQtr]);
                }
              }

              if (salesRow) {
                salesQtr = parseCleanNumber(salesRow[latestQtr]);
                if (Array.isArray(salesRow.children)) {
                   const salesVarRow = salesRow.children.find((r: any) => r[""] === "YOY Sales Growth %");
                   if (salesVarRow) salesVar = parseCleanNumber(salesVarRow[latestQtr]);
                }
              }
            }
          }
        }

        // Upsert into stock_metrics table
        await client.query(`
          INSERT INTO "stock_metrics" (
            "symbol", "cmp", "pe", "mkt_cap", "div_yld", 
            "np_qtr", "profit_var", "sales_qtr", "sales_var", "roce", "updated_at"
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP)
          ON CONFLICT ("symbol") DO UPDATE SET
            "cmp" = EXCLUDED."cmp",
            "pe" = EXCLUDED."pe",
            "mkt_cap" = EXCLUDED."mkt_cap",
            "div_yld" = EXCLUDED."div_yld",
            "np_qtr" = EXCLUDED."np_qtr",
            "profit_var" = EXCLUDED."profit_var",
            "sales_qtr" = EXCLUDED."sales_qtr",
            "sales_var" = EXCLUDED."sales_var",
            "roce" = EXCLUDED."roce",
            "updated_at" = CURRENT_TIMESTAMP
        `, [
          symbol, cmp, pe, liveMktCap, divYld, 
          npQtr, profitVar, salesQtr, salesVar, roce
        ]);
        
        processed++;
      } catch (err) {
        console.error(`Failed to process metrics for ${symbol}:`, err);
      }
    }
    
    console.log(`Successfully synced metrics for ${processed} stocks.`);
  } catch (error) {
    console.error('Error during metrics sync:', error);
  } finally {
    client.release();
  }
}
