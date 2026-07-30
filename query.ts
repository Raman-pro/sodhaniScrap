import { pool } from './src/db/pool';

async function main() {
    const res = await pool.query('SELECT count(*) FROM bse_announcements');
    console.log('Count:', res.rows[0].count);
    
    const lastNews = await pool.query("SELECT * FROM sync_metadata WHERE key = 'last_newsid'");
    console.log('Last News ID metadata:', lastNews.rows);
    
    const latestRows = await pool.query('SELECT newsid, news_dt FROM bse_announcements ORDER BY news_dt DESC LIMIT 5');
    console.log('Latest announcements in DB:', latestRows.rows);
    
    process.exit(0);
}

main().catch(console.error);
