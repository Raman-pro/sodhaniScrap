import { pool } from './src/db/pool';

async function main() {
    const res = await pool.query("SELECT * FROM bse_announcements WHERE newsid = '7c97e834-0c0e-4fef-b9bd-9d68693e49ed'");
    console.log('Found 7c97e834:', res.rows.length);
    
    process.exit(0);
}

main().catch(console.error);
