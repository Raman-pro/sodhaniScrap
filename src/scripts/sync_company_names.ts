import { pool } from '../db/pool';

async function syncCompanyNames() {
  console.log('Syncing company names into company_stock from company_sectors...');
  const client = await pool.connect();
  try {
    const res = await client.query(`
      UPDATE company_stock cs
      SET "FinInstrmNm" = ci.company_name
      FROM company_sectors ci
      WHERE (cs."FinInstrmId"::text = ci.fin_instrm_id OR cs."TckrSymb" = ci.fin_instrm_id)
        AND (cs."FinInstrmNm" IS NULL OR cs."FinInstrmNm" = '')
        AND ci.company_name IS NOT NULL AND ci.company_name != '';
    `);
    console.log(`Successfully updated ${res.rowCount || 0} company names in company_stock!`);
  } catch (err) {
    console.error('Error syncing company names:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

syncCompanyNames();
