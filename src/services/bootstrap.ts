import { pool } from '../db/pool';
import { parseCompaniesJson, parseBhavcopy } from './csvParser';
import { CompanyStock } from '../types';

export async function bootstrapMasterList() {
  console.log('Phase 1: Bootstrapping Master Sync...');
  
  const companies = await parseCompaniesJson();
  const bhavcopyMapping = await parseBhavcopy();

  if (companies.length === 0 && bhavcopyMapping.size === 0) {
    console.log('No data to bootstrap master list.');
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    for (const company of companies) {
      const csvRow = bhavcopyMapping.get(company.FinInstrmId) || {};
      
      if (!company.TckrSymb && csvRow.TckrSymb) {
        company.TckrSymb = csvRow.TckrSymb;
      }
      
      const query = `
        INSERT INTO company_stock (
          "FinInstrmId", "TradDt", "BizDt", "Sgmt", "Src", "FinInstrmTp", 
          "ISIN", "TckrSymb", "SctySrs", "FinInstrmNm", "LastPric"
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT ("FinInstrmId") DO UPDATE SET
          "TradDt" = EXCLUDED."TradDt",
          "BizDt" = EXCLUDED."BizDt",
          "Sgmt" = EXCLUDED."Sgmt",
          "Src" = EXCLUDED."Src",
          "FinInstrmTp" = EXCLUDED."FinInstrmTp",
          "ISIN" = EXCLUDED."ISIN",
          "TckrSymb" = EXCLUDED."TckrSymb",
          "SctySrs" = EXCLUDED."SctySrs",
          "FinInstrmNm" = EXCLUDED."FinInstrmNm",
          "LastPric" = EXCLUDED."LastPric"
      `;
      const values = [
        company.FinInstrmId,
        csvRow.TradDt || null,
        csvRow.BizDt || null,
        csvRow.Sgmt || null,
        csvRow.Src || null,
        csvRow.FinInstrmTp || null,
        csvRow.ISIN || null,
        csvRow.TckrSymb || company.TckrSymb || null,
        csvRow.SctySrs || null,
        csvRow.FinInstrmNm || company.FinInstrmNm || null,
        csvRow.LastPric ? parseFloat(csvRow.LastPric) : null
      ];
      await client.query(query, values);
    }

    await client.query('COMMIT');
    console.log(`Bootstrap complete. Processed ${companies.length} companies.`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error during master sync:', error);
    throw error;
  } finally {
    client.release();
  }
}
