import { execFile } from 'child_process';
import path from 'path';
import format from 'pg-format';
import dotenv from 'dotenv';
import { pool } from '../db/pool';

dotenv.config();

const PYTHON_BIN = process.env.PYTHON_BIN || 'python';
const SCRIPT_PATH = path.join(__dirname, '..', '..', 'python', 'get_business_standard_response.py');
const RESEARCH_REPORTS_DAYS = process.env.RESEARCH_REPORTS_DAYS || '15';

interface ScrapedReport {
  company: string;
  action: string;
  target_price: string;
  broker: string;
  date: string;
  report_url: string;
}

interface CompanyCandidate {
  FinInstrmId: string;
  TckrSymb: string | null;
  FinInstrmNm: string | null;
}

function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveCompanyMatch(
  reportCompany: string,
  candidates: CompanyCandidate[],
): CompanyCandidate | null {
  const normReport = normalizeCompanyName(reportCompany);
  if (!normReport) return null;

  const tickerMatches = candidates.filter(
    (c) => c.TckrSymb && normalizeCompanyName(c.TckrSymb) === normReport,
  );
  if (tickerMatches.length === 1) return tickerMatches[0];

  const nameMatches = candidates.filter((c) => {
    if (!c.FinInstrmNm) return false;
    const normName = normalizeCompanyName(c.FinInstrmNm);
    return normName.startsWith(normReport) || normReport.startsWith(normName);
  });
  if (nameMatches.length === 1) return nameMatches[0];

  return null;
}

function parseTargetPrice(raw: string): number | null {
  const cleaned = raw.replace(/,/g, '').trim();
  const value = parseFloat(cleaned);
  return Number.isFinite(value) ? value : null;
}

function parseReportDate(raw: string): string | null {
  const normalized = raw.replace('-Sept-', '-Sep-');
  const parts = normalized.split('-');
  if (parts.length !== 3) return null;

  const months: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  };
  const monthKey = parts[1].toLowerCase().slice(0, 3);
  const month = months[monthKey];
  if (!month) return null;

  const day = parts[0].padStart(2, '0');
  const year = parts[2];
  return `${year}-${month}-${day}`;
}

function runScraper(): Promise<ScrapedReport[]> {
  return new Promise((resolve, reject) => {
    execFile(
      PYTHON_BIN,
      [SCRIPT_PATH, '--days', RESEARCH_REPORTS_DAYS],
      { timeout: 60_000, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          console.error('research reports scraper failed:', stderr || error.message);
          reject(error);
          return;
        }
        try {
          resolve(JSON.parse(stdout) as ScrapedReport[]);
        } catch (parseErr) {
          reject(parseErr);
        }
      },
    );
  });
}

export async function researchReportsSync(): Promise<void> {
  console.log('--- Starting Business Standard Research Reports Sync ---');
  const client = await pool.connect();

  try {
    const reports = await runScraper();
    console.log(`Fetched ${reports.length} research reports.`);
    if (reports.length === 0) return;

    const candidatesRes = await client.query<CompanyCandidate>(
      `SELECT "FinInstrmId", "TckrSymb", "FinInstrmNm" FROM company_stock`,
    );
    const candidates = candidatesRes.rows;

    const valuesToInsert = [];
    for (const report of reports) {
      const reportDate = parseReportDate(report.date);
      if (!reportDate) {
        console.warn(`Skipping report with unparseable date: ${report.date}`);
        continue;
      }

      const match = resolveCompanyMatch(report.company, candidates);
      valuesToInsert.push([
        report.company,
        match?.FinInstrmId ?? null,
        match?.TckrSymb ?? null,
        report.action || null,
        parseTargetPrice(report.target_price),
        report.broker || null,
        reportDate,
        report.report_url || null,
      ]);
    }

    if (valuesToInsert.length === 0) return;

    const query = format(
      `
        INSERT INTO research_reports
        (company, fin_instrm_id, tckr_symb, action, target_price, broker, report_date, report_url)
        VALUES %L
        ON CONFLICT (company, broker, report_date, target_price) DO NOTHING
      `,
      valuesToInsert,
    );

    const res = await client.query(query);
    console.log(`--- Research Reports Sync Complete. Inserted ${res.rowCount || 0} new records. ---`);
  } catch (error) {
    console.error('Error in researchReportsSync:', error);
  } finally {
    client.release();
  }
}
