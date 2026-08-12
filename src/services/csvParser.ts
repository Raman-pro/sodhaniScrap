import fs from 'fs';
import path from 'path';
import csvParser from 'csv-parser';
import { CompanyStock } from '../types';

interface BSECsvRow {
  FinInstrmId: string;
  TckrSymb: string;
  [key: string]: any;
}

export async function parseCompaniesJson(): Promise<CompanyStock[]> {
  const jsonPath = path.join(__dirname, '../../companies.json');
  if (!fs.existsSync(jsonPath)) {
    console.warn('companies.json not found, returning empty array');
    return [];
  }
  const data = await fs.promises.readFile(jsonPath, 'utf8');
  const parsed = JSON.parse(data);
  const companies: CompanyStock[] = [];

  if (parsed.bse_only) {
    for (const code of parsed.bse_only) {
      companies.push({ FinInstrmId: code, TckrSymb: `${code}.BO` });
    }
  }

  if (parsed.bse_to_nse) {
    for (const bseCode of Object.keys(parsed.bse_to_nse)) {
      const nseCode = parsed.bse_to_nse[bseCode];
      companies.push({ FinInstrmId: bseCode, TckrSymb: `${nseCode}.NS` });
    }
  }

  // Commented out per user request: only process bse_only stocks
  // if (parsed.both && parsed.nse_to_bse) {
  //   for (const nse of parsed.both) {
  //     const bseCode = parsed.nse_to_bse[nse];
  //     if (bseCode) {
  //       companies.push({ FinInstrmId: bseCode, TckrSymb: `${nse}.NS` });
  //     }
  //   }
  // }

  if (parsed.nse_only) {
    const crypto = require('crypto');
    for (const nse of parsed.nse_only) {
      // Generate a stable 14-digit integer from the symbol string to fit in BIGINT
      const hash = crypto.createHash('md5').update(nse).digest('hex');
      const num = parseInt(hash.substring(0, 11), 16); 
      const nseId = (1000000 + num).toString();
      companies.push({ FinInstrmId: nseId, TckrSymb: `${nse}.NS` });
    }
  }

  return companies;
}

export async function parseBhavcopy(): Promise<Map<string, any>> {
  const defaultCsvPath = path.join(__dirname, '../../BhavCopy_BSE_CM_0_0_0_20260722_F_0000.CSV');
  const csvPath = process.env.BHAVCOPY_CSV_PATH
    ? path.join(__dirname, process.env.BHAVCOPY_CSV_PATH)
    : defaultCsvPath;

  const mapping = new Map<string, any>();

  if (!fs.existsSync(csvPath)) {
    console.warn('BhavCopy CSV not found, mapping will be empty.');
    return mapping;
  }

  return new Promise((resolve, reject) => {
    fs.createReadStream(csvPath)
      .pipe(csvParser())
      .on('data', (row: any) => {
        if (row.FinInstrmId) {
          mapping.set(row.FinInstrmId.toString(), row);
        }
      })
      .on('end', () => {
        resolve(mapping);
      })
      .on('error', (err) => {
        reject(err);
      });
  });
}
