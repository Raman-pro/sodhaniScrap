import { pool } from './db/pool';

async function checkMissing() {
  const client = await pool.connect();
  try {
    const historyResult = await client.query(`
      SELECT DISTINCT ON (hp."FinInstrmId") 
        cs."TckrSymb"
      FROM historical_prices hp
      JOIN company_stock cs ON cs."FinInstrmId" = hp."FinInstrmId"
      WHERE cs."TckrSymb" IS NOT NULL
      ORDER BY hp."FinInstrmId", hp."record_date" DESC
    `);
    
    let tckrs = historyResult.rows.map((r: any) => r.TckrSymb.trim().toUpperCase());
    console.log('Total TckrSymbs from DB:', tckrs.length);
    console.log('Sample of first 20 TckrSymbs in DB:');
    console.log(tckrs.slice(0, 20).join(', '));
    
  } finally {
    client.release();
    pool.end();
  }
}

checkMissing();
