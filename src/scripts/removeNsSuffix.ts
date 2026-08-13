import { pool } from '../db/pool';

async function removeNsSuffix() {
    console.log('Starting migration to remove .NS suffix...');
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Drop foreign key constraint
        console.log('Dropping foreign key constraint on historical_prices...');
        await client.query(`
            ALTER TABLE "historical_prices" 
            DROP CONSTRAINT IF EXISTS "historical_prices_fininstrmid_foreign"
        `);

        // 2. Update historical_prices
        console.log('Removing .NS suffix from historical_prices...');
        const updateHistRes = await client.query(`
            UPDATE "historical_prices"
            SET "FinInstrmId" = REPLACE("FinInstrmId", '.NS', '')
            WHERE "FinInstrmId" LIKE '%.NS'
        `);
        console.log(`Updated ${updateHistRes.rowCount} rows in historical_prices.`);

        // 3. Update company_stock
        console.log('Removing .NS suffix from company_stock...');
        const updateStockRes = await client.query(`
            UPDATE "company_stock"
            SET 
                "FinInstrmId" = REPLACE("FinInstrmId", '.NS', ''),
                "TckrSymb" = REPLACE("TckrSymb", '.NS', '')
            WHERE "FinInstrmId" LIKE '%.NS' OR "TckrSymb" LIKE '%.NS'
        `);
        console.log(`Updated ${updateStockRes.rowCount} rows in company_stock.`);

        // 4. Re-add foreign key constraint
        console.log('Re-adding foreign key constraint...');
        await client.query(`
            ALTER TABLE "historical_prices"
            ADD CONSTRAINT "historical_prices_fininstrmid_foreign"
            FOREIGN KEY ("FinInstrmId") REFERENCES "company_stock"("FinInstrmId")
        `);

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

removeNsSuffix().catch(console.error);
