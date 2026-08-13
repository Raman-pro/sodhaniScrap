const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool();

async function run() {
  try {
    const res = await pool.query('SELECT "FinInstrmId", "TckrSymb" FROM company_stock WHERE "TckrSymb" LIKE \'%.NS\' LIMIT 5');
    console.log(res.rows);
  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
}
run();
