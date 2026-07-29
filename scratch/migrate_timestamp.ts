import { pool } from '../src/db/pool';

async function migrate() {
    const client = await pool.connect();
    try {
        console.log('Checking for historical_prices table...');
        const res = await client.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'historical_prices'
            );
        `);
        
        if (res.rows[0].exists) {
            console.log('Table exists. Altering record_date column type to TIMESTAMP...');
            await client.query(`
                ALTER TABLE "historical_prices" 
                ALTER COLUMN "record_date" TYPE TIMESTAMP 
                USING "record_date"::TIMESTAMP;
            `);
            console.log('Migration successful.');
        } else {
            console.log('Table historical_prices does not exist. Nothing to migrate.');
        }
    } catch (e) {
        console.error('Migration failed:', e);
    } finally {
        client.release();
        process.exit(0);
    }
}

migrate();
