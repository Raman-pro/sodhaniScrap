import fs from 'fs';
import path from 'path';
import { pool } from '../db/pool';

async function backfillNseSrc() {
    console.log('Starting migration to set Src=NSE for NSE-only companies...');

    const jsonPath = path.join(__dirname, '../../companies.json');
    if (!fs.existsSync(jsonPath)) {
        console.error('companies.json not found, aborting.');
        return;
    }

    const parsed = JSON.parse(await fs.promises.readFile(jsonPath, 'utf8'));
    const nseOnly: string[] = parsed.nse_only || [];

    if (nseOnly.length === 0) {
        console.log('No nse_only entries found in companies.json, nothing to do.');
        return;
    }

    console.log(`Found ${nseOnly.length} nse_only symbols in companies.json.`);

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const updateRes = await client.query(`
            UPDATE "company_stock"
            SET "Src" = 'NSE'
            WHERE "FinInstrmId" = ANY($1)
        `, [nseOnly]);
        console.log(`Updated ${updateRes.rowCount} rows in company_stock (of ${nseOnly.length} nse_only symbols).`);

        await client.query('COMMIT');
        console.log('Migration completed successfully.');

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Migration failed. Rolled back.', error);
    } finally {
        client.release();
        await pool.end();
    }
}

backfillNseSrc().catch(console.error);
