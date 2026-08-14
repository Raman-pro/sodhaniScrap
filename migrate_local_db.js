const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool();

async function runMigration() {
    console.log('Connecting to database to migrate BIGINT to VARCHAR...');
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        console.log('1. Deleting large FinInstrmIds (hashes)...');
        await client.query('DELETE FROM historical_prices WHERE LENGTH("FinInstrmId"::text) > 6');
        await client.query('DELETE FROM company_stock WHERE LENGTH("FinInstrmId"::text) > 6');

        console.log('2. Dropping foreign key constraint temporarily...');
        await client.query('ALTER TABLE historical_prices DROP CONSTRAINT IF EXISTS historical_prices_fininstrmid_foreign');

        console.log('3. Altering column types from BIGINT to VARCHAR(50)...');
        await client.query('ALTER TABLE company_stock ALTER COLUMN "FinInstrmId" TYPE VARCHAR(50)');
        await client.query('ALTER TABLE historical_prices ALTER COLUMN "FinInstrmId" TYPE VARCHAR(50)');

        console.log('4. Re-adding foreign key constraint...');
        await client.query('ALTER TABLE historical_prices ADD CONSTRAINT historical_prices_fininstrmid_foreign FOREIGN KEY ("FinInstrmId") REFERENCES company_stock("FinInstrmId")');

        await client.query('COMMIT');
        console.log('Migration successful! Columns are now VARCHAR(50).');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Migration failed:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

runMigration();
