import { pool } from './src/db/pool';

async function fetchOne() {
  try {
    const res = await pool.query('SELECT ta_data FROM technical_analysis LIMIT 1');
    if (res.rows.length > 0) {
      console.log(JSON.stringify(res.rows[0].ta_data, null, 2));
    } else {
      console.log('No data found in technical_analysis table.');
    }
  } catch (error) {
    console.error('Error fetching data:', error);
  } finally {
    await pool.end();
  }
}

fetchOne();
