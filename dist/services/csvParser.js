"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseCompaniesJson = parseCompaniesJson;
exports.parseBhavcopy = parseBhavcopy;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const csv_parser_1 = __importDefault(require("csv-parser"));
async function parseCompaniesJson() {
    const jsonPath = path_1.default.join(__dirname, '../../companies.json');
    if (!fs_1.default.existsSync(jsonPath)) {
        console.warn('companies.json not found, returning empty array');
        return [];
    }
    const data = await fs_1.default.promises.readFile(jsonPath, 'utf8');
    const parsed = JSON.parse(data);
    const companies = [];
    if (parsed.bse_only) {
        for (const code of parsed.bse_only) {
            companies.push({ FinInstrmId: code, TckrSymb: `${code}.BO` });
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
    return companies;
}
async function parseBhavcopy() {
    const defaultCsvPath = path_1.default.join(__dirname, '../../BhavCopy_BSE_CM_0_0_0_20260722_F_0000.CSV');
    const csvPath = process.env.BHAVCOPY_CSV_PATH
        ? path_1.default.join(__dirname, process.env.BHAVCOPY_CSV_PATH)
        : defaultCsvPath;
    const mapping = new Map();
    if (!fs_1.default.existsSync(csvPath)) {
        console.warn('BhavCopy CSV not found, mapping will be empty.');
        return mapping;
    }
    return new Promise((resolve, reject) => {
        fs_1.default.createReadStream(csvPath)
            .pipe((0, csv_parser_1.default)())
            .on('data', (row) => {
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
