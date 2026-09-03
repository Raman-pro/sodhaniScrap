import fs from 'fs';
import path from 'path';
import { pool } from '../db/pool';
import YahooFinance from 'yahoo-finance2';
const yahooFinance = new (YahooFinance as any)({ suppressNotices: ['yahooSurvey'] });

// Helper to safely parse numbers from strings like "₹ 1,284" or "7.78 %"
function parseCleanNumber(val: any): number {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  const str = String(val).replace(/,/g, '');
  const match = str.match(/-?\d+(\.\d+)?/);
  return match ? parseFloat(match[0]) : 0;
}

// Helper for case-insensitive file matching (Linux is case-sensitive)
async function findJsonCaseInsensitive(dir: string, basename: string): Promise<string | null> {
  try {
    if (!fs.existsSync(dir)) return null;
    const files = await fs.promises.readdir(dir);
    const lowerBasename = basename.toLowerCase();
    const targetFile = files.find(f => {
      const nameWithoutExt = f.replace(/\.[^/.]+$/, "");
      return nameWithoutExt.toLowerCase() === lowerBasename;
    });
    if (targetFile) {
      return path.join(dir, targetFile);
    }
  } catch (err) {
    // ignore
  }
  return null;
}

export async function metricsSync() {
  console.log('Starting daily metrics sync for all stocks...');
  const client = await pool.connect();
  
  try {
    // Try to load BSE to NSE mappings
    let bseToNse: Record<string, string> = {};
    try {
      const mappingsPath = path.resolve(process.cwd(), '../sodhani-api/exchange_code_mappings.json');
      if (fs.existsSync(mappingsPath)) {
        bseToNse = JSON.parse(fs.readFileSync(mappingsPath, 'utf8'))?.bse_to_nse || {};
        console.log(`Loaded ${Object.keys(bseToNse).length} BSE->NSE mappings.`);
      } else {
        console.warn('Mapping file not found at:', mappingsPath);
      }
    } catch(e: any) {
      console.error('Could not load mappings:', e.message);
    }

    // Get all stocks and their latest price directly from company_stock to avoid querying the massive historical_prices table
    const historyResult = await client.query(`
      SELECT 
        "TckrSymb",
        "FinInstrmId",
        COALESCE("LastPric", 0) as close_price
      FROM company_stock
      WHERE "TckrSymb" IS NOT NULL
    `);
    
    console.log(`Found ${historyResult.rows.length} stocks with historical prices.`);

    const outputConsolidated = path.resolve(process.cwd(), 'output_consolidated');
    const outputDir = path.resolve(process.cwd(), 'output');
    
    let processed = 0;
    
    for (const row of historyResult.rows) {
      const symbol = row.TckrSymb.trim().replace(/\.(NS|BO)$/i, '').toUpperCase();
      const nseSymbol = bseToNse[symbol] || symbol;
      const finId = row.FinInstrmId ? row.FinInstrmId.toString() : '';
      let cmp = parseFloat(row.close_price);
      
      if (isNaN(cmp)) cmp = 0;

      const metricsSymbol = finId || symbol;

      // Try NSE symbol first, then BSE TckrSymb, then the numerical BSE Scrip Code (FinInstrmId)
      let jsonPath = await findJsonCaseInsensitive(outputConsolidated, nseSymbol) ||
                     await findJsonCaseInsensitive(outputDir, nseSymbol) ||
                     await findJsonCaseInsensitive(outputConsolidated, symbol) ||
                     await findJsonCaseInsensitive(outputDir, symbol);
                     
      if (!jsonPath && finId) {
        jsonPath = await findJsonCaseInsensitive(outputConsolidated, finId) ||
                   await findJsonCaseInsensitive(outputDir, finId);
      }
      
      if (symbol === 'SHANKESH') {
         console.log(`[DEBUG SHANKESH] jsonPath: ${jsonPath}, cmp: ${cmp}, finId: ${finId}`);
      }

      if (!jsonPath) continue; // No json for this stock

      try {
        const rawData = fs.readFileSync(jsonPath, 'utf8');
        const json = JSON.parse(rawData);

        // Sync company_sectors classification
        let industryData = json.industry;
        let companyName = json.overview?.company_name || symbol;

        let standaloneJson: any = null;
        if (jsonPath.includes('output_consolidated')) {
          const standalonePath = jsonPath.replace('output_consolidated', 'output');
          if (fs.existsSync(standalonePath)) {
            try {
              standaloneJson = JSON.parse(fs.readFileSync(standalonePath, 'utf8'));
              if (!industryData || !industryData.industry_code) {
                industryData = standaloneJson.industry;
                if (standaloneJson.overview?.company_name) {
                  companyName = standaloneJson.overview.company_name;
                }
              }
            } catch (e) {}
          }
        }

        if (industryData?.industry_code && industryData?.industry_name) {
          const codes = industryData.industry_code.split('/');
          const names = industryData.industry_name.split('/');
          if (codes.length >= 4 && names.length >= 4) {
            const sectorCode = codes[0];
            const industryCode = codes[2];
            const leafCode = codes[3];
            const sectorName = names[0];
            const industryName = names[2];
            const leafName = names[3];
            const finInstrmId = finId || symbol;

            await client.query(`
              INSERT INTO company_sectors (
                fin_instrm_id, company_name, sector_name, industry_name, leaf_name, 
                sector_code, industry_code, leaf_code
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
              ON CONFLICT (fin_instrm_id) DO UPDATE SET
                company_name = EXCLUDED.company_name,
                sector_name = EXCLUDED.sector_name,
                industry_name = EXCLUDED.industry_name,
                leaf_name = EXCLUDED.leaf_name,
                sector_code = EXCLUDED.sector_code,
                industry_code = EXCLUDED.industry_code,
                leaf_code = EXCLUDED.leaf_code
            `, [finInstrmId, companyName, sectorName, industryName, leafName, sectorCode, industryCode, leafCode]);
          }
        }

        let mktCapJson = parseCleanNumber(json.key_metrics?.["Market Cap"]);
        let currentPriceJson = parseCleanNumber(json.key_metrics?.["Current Price"]);
        const roce = parseCleanNumber(json.key_metrics?.["ROCE"]);

        if ((mktCapJson === 0 || currentPriceJson === 0) && standaloneJson) {
           mktCapJson = parseCleanNumber(standaloneJson.key_metrics?.["Market Cap"]) || mktCapJson;
           currentPriceJson = parseCleanNumber(standaloneJson.key_metrics?.["Current Price"]) || currentPriceJson;
        }

        // Calculate Shares Outstanding and Live Mkt Cap
        let sharesOutstanding = 0;
        if (currentPriceJson > 0) {
          sharesOutstanding = mktCapJson / currentPriceJson;
        }
        let liveMktCap = cmp * sharesOutstanding;

        // Extract from profit_loss
        let annualEps = 0;
        let dividendPayout = 0;

        const extractEps = (sourceJson: any) => {
          if (Array.isArray(sourceJson.profit_loss)) {
            const epsRow = sourceJson.profit_loss.find((r: any) => r[""] === "EPS in Rs");
            const divRow = sourceJson.profit_loss.find((r: any) => r[""] === "Dividend Payout %");
            const headerRow = sourceJson.profit_loss[0];
            
            if (headerRow) {
              const keys = Object.keys(headerRow).filter(k => k !== "");
              if (keys.length > 0) {
                const latestYear = keys[keys.length - 1];
                return {
                  eps: epsRow ? parseCleanNumber(epsRow[latestYear]) : 0,
                  div: divRow ? parseCleanNumber(divRow[latestYear]) : 0
                };
              }
            }
          }
          return { eps: 0, div: 0 };
        };

        const consEps = extractEps(json);
        annualEps = consEps.eps;
        dividendPayout = consEps.div;

        if (annualEps === 0 && standaloneJson) {
           const stdEps = extractEps(standaloneJson);
           if (stdEps.eps > 0) {
              annualEps = stdEps.eps;
              dividendPayout = stdEps.div;
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

        if (liveMktCap === 0 || pe === 0 || cmp === 0) {
          const yfTicker = nseSymbol !== symbol ? `${nseSymbol}.NS` : `${symbol}.BO`;
          if (symbol === 'SHANKESH') {
             console.log(`[DEBUG SHANKESH] Triggering YF fallback for ${yfTicker}`);
          }
          try {
            const quote = await yahooFinance.quote(yfTicker);
            if (symbol === 'SHANKESH') {
               console.log(`[DEBUG SHANKESH] YF quote returned marketCap: ${quote.marketCap}, trailingPE: ${quote.trailingPE}, regularMarketPrice: ${quote.regularMarketPrice}`);
            }
            if (cmp === 0 && quote.regularMarketPrice) {
              cmp = quote.regularMarketPrice;
            }
            if (liveMktCap === 0 && quote.marketCap) {
              liveMktCap = quote.marketCap / 10000000;
            }
            if (pe === 0 && quote.trailingPE) {
              pe = quote.trailingPE;
            }
            if (divYld === 0 && quote.trailingAnnualDividendYield) {
              divYld = quote.trailingAnnualDividendYield * 100;
            }
            console.log(`Used Yahoo Finance fallback for ${symbol}`);
          } catch (e: any) {
            console.log(`Yahoo Finance fallback failed for ${yfTicker}: ${e.message}`);
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
          metricsSymbol, cmp, pe, liveMktCap, divYld, 
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
