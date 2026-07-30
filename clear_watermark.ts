import { pool } from './src/db/pool';

async function main() {
    await pool.query("DELETE FROM sync_metadata WHERE key = 'last_newsid'");
    console.log('Watermark cleared! Next run will fetch up to 50 pages.');
    process.exit(0);
}

main().catch(console.error);
