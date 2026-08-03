import { pool } from './db/pool';

async function checkDb() {
  const client = await pool.connect();
  try {
    const cs = await client.query(`SELECT * FROM company_stock WHERE "FinInstrmId"::text = '541400'`);
    console.log('company_stock:', cs.rows);
    
    const hp = await client.query(`SELECT COUNT(*) FROM historical_prices WHERE "FinInstrmId" = 541400`);
    console.log('historical_prices count:', hp.rows[0].count);
    
    const sm = await client.query(`SELECT * FROM stock_metrics WHERE symbol IN ('541400', 'ZIMLAB')`);
    console.log('stock_metrics:', sm.rows);
  } finally {
    client.release();
    pool.end();
  }
}

checkDb();
