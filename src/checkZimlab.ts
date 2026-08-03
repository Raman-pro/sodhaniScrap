import { pool } from './db/pool';

async function checkZimlab() {
  const client = await pool.connect();
  try {
    const res = await client.query(`SELECT * FROM stock_metrics WHERE symbol IN ('541400', 'ZIMLAB')`);
    console.log('stock_metrics rows for 541400/ZIMLAB:', res.rows);
    
    const csRes = await client.query(`SELECT * FROM company_stock WHERE "FinInstrmId"::text = '541400' OR UPPER("TckrSymb") = 'ZIMLAB'`);
    console.log('company_stock rows:', csRes.rows);
    
  } finally {
    client.release();
    pool.end();
  }
}

checkZimlab();
