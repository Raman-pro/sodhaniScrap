import { initDB } from '../src/db/init';
import { bseLiveSync } from '../src/services/bseLiveSync';
import { pool } from '../src/db/pool';

async function main() {
    try {
        console.log('Initializing DB for live sync test...');
        await initDB();
        
        console.log('Running live sync...');
        await bseLiveSync();
        
        const client = await pool.connect();
        const res = await client.query('SELECT "FinInstrmId", record_date FROM historical_prices LIMIT 5');
        console.log('Sample rows inserted:');
        console.table(res.rows);
        client.release();
        
        console.log('Test complete. Exiting gracefully.');
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

main();
