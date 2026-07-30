import { pool } from './pool';

export async function initDB() {
  const client = await pool.connect();
  try {
    console.log('Initializing database schema...');
    
    // Create company_stock table
    await client.query(`
      CREATE TABLE IF NOT EXISTS "company_stock"(
          "FinInstrmId" BIGINT NOT NULL,
          "TradDt" DATE NULL,
          "BizDt" DATE NULL,
          "Sgmt" VARCHAR(10) NULL,
          "Src" VARCHAR(10) NULL,
          "FinInstrmTp" VARCHAR(10) NULL,
          "ISIN" VARCHAR(12) NULL,
          "TckrSymb" VARCHAR(20) NULL,
          "SctySrs" VARCHAR(10) NULL,
          "XpryDt" DATE NULL,
          "FininstrmActlXpryDt" DATE NULL,
          "StrkPric" DECIMAL(14, 4) NULL,
          "OptnTp" VARCHAR(2) NULL,
          "FinInstrmNm" VARCHAR(255) NULL,
          "LastPric" DECIMAL(14, 4) NULL,
          "OpnIntrst" BIGINT NULL,
          "ChngInOpnIntrst" BIGINT NULL,
          "TtlTradgVol" BIGINT NULL,
          "TtlTrfVal" DECIMAL(24, 4) NULL,
          "TtlNbOfTxsExctd" BIGINT NULL,
          "SsnId" VARCHAR(10) NULL,
          "NewBrdLotQty" BIGINT NULL,
          PRIMARY KEY("FinInstrmId")
      );
    `);

    // Create index on TckrSymb if not exists
    await client.query(`
      CREATE INDEX IF NOT EXISTS "company_stock_tckrsymb_index" ON "company_stock"("TckrSymb");
    `);

    // Create historical_prices table
    await client.query(`
      CREATE TABLE IF NOT EXISTS "historical_prices"(
          "FinInstrmId" BIGINT NOT NULL,
          "record_date" TIMESTAMP NOT NULL,
          "open_price" DECIMAL(14, 6) NULL,
          "high_price" DECIMAL(14, 6) NULL,
          "low_price" DECIMAL(14, 6) NULL,
          "close_price" DECIMAL(14, 6) NULL,
          "adj_close" DOUBLE PRECISION NULL,
          "volume" BIGINT NULL,
          "dividends" DECIMAL(10, 4) NULL,
          "stock_splits" DECIMAL(10, 4) NULL,
          PRIMARY KEY("FinInstrmId", "record_date"),
          CONSTRAINT "historical_prices_fininstrmid_foreign" 
            FOREIGN KEY("FinInstrmId") 
            REFERENCES "company_stock"("FinInstrmId")
      );
    `);

    // Ensure newer columns exist if the table was created in an older schema version
    await client.query(`
      ALTER TABLE "historical_prices" 
      ADD COLUMN IF NOT EXISTS "volume" BIGINT NULL,
      ADD COLUMN IF NOT EXISTS "adj_close" DOUBLE PRECISION NULL,
      ADD COLUMN IF NOT EXISTS "dividends" DECIMAL(10, 4) NULL,
      ADD COLUMN IF NOT EXISTS "stock_splits" DECIMAL(10, 4) NULL;
    `);

    // Create B-Tree index for optimization
    await client.query(`
      CREATE INDEX IF NOT EXISTS "historical_prices_idx" ON "historical_prices"("FinInstrmId", "record_date" DESC);
    `);

    // Create sync_metadata table for tracking state
    await client.query(`
      CREATE TABLE IF NOT EXISTS "sync_metadata"(
          "key" VARCHAR(255) PRIMARY KEY,
          "value" TEXT NOT NULL
      );
    `);

    // Create bse_announcements table
    await client.query(`
      CREATE TABLE IF NOT EXISTS "bse_announcements"(
          "newsid" VARCHAR(255) PRIMARY KEY,
          "scrip_cd" VARCHAR(255) NULL,
          "news_dt" TIMESTAMP NULL,
          "newssub" TEXT NULL,
          "headline" TEXT NULL,
          "slongname" TEXT NULL,
          "announcement_type" VARCHAR(255) NULL,
          "attachmentname" TEXT NULL,
          "categoryname" VARCHAR(255) NULL
      );
    `);

    // Create indexes for announcements
    await client.query(`
      CREATE INDEX IF NOT EXISTS "bse_announcements_scrip_cd_idx" ON "bse_announcements"("scrip_cd");
      CREATE INDEX IF NOT EXISTS "bse_announcements_news_dt_idx" ON "bse_announcements"("news_dt");
      CREATE INDEX IF NOT EXISTS "bse_announcements_categoryname_idx" ON "bse_announcements"("categoryname");
    `);

    // Create bse_spurt_volume table
    await client.query(`
      CREATE TABLE IF NOT EXISTS "bse_spurt_volume"(
          "scrip_cd" VARCHAR(255) NOT NULL,
          "record_date" DATE NOT NULL DEFAULT CURRENT_DATE,
          "scripname" VARCHAR(255) NULL,
          "long_name" TEXT NULL,
          "trd_vol" DECIMAL(14, 4) NULL,
          "wkavgqty" DECIMAL(14, 4) NULL,
          "volumechangetimes" DECIMAL(14, 4) NULL,
          "ltradert" DECIMAL(14, 4) NULL,
          "change_val" DECIMAL(14, 4) NULL,
          "change_percent" DECIMAL(14, 4) NULL,
          "turnover" DECIMAL(14, 4) NULL,
          "nsurl" TEXT NULL,
          PRIMARY KEY("scrip_cd", "record_date")
      );
    `);

    // Create bse_top_gainers_losers table
    await client.query(`
      CREATE TABLE IF NOT EXISTS "bse_top_gainers_losers"(
          "record_time" TIMESTAMP NOT NULL,
          "type" VARCHAR(10) NOT NULL,
          "rank" INT NOT NULL,
          "scrip_cd" VARCHAR(255) NOT NULL,
          "scripname" VARCHAR(255) NULL,
          "long_name" TEXT NULL,
          "ltradert" DECIMAL(14, 4) NULL,
          "change_val" DECIMAL(14, 4) NULL,
          "change_percent" DECIMAL(14, 4) NULL,
          PRIMARY KEY("type", "rank")
      );
    `);

    // Schema migration: if table existed with old PK ("record_time", "type", "rank"), fix it.
    try {
        // Check if the old primary key exists
        const res = await client.query(`
            SELECT constraint_name 
            FROM information_schema.table_constraints 
            WHERE table_name = 'bse_top_gainers_losers' AND constraint_type = 'PRIMARY KEY'
        `);
        if (res.rows.length > 0) {
            const pkName = res.rows[0].constraint_name;
            const columnsRes = await client.query(`
                SELECT column_name 
                FROM information_schema.key_column_usage 
                WHERE constraint_name = $1
            `, [pkName]);
            
            const columns = columnsRes.rows.map(r => r.column_name);
            if (columns.includes('record_time')) {
                console.log('Migrating bse_top_gainers_losers to new primary key...');
                // Delete duplicates, keeping the most recent one for each type and rank
                await client.query(`
                    DELETE FROM "bse_top_gainers_losers" a USING "bse_top_gainers_losers" b 
                    WHERE a.type = b.type AND a.rank = b.rank AND a.record_time < b.record_time;
                `);
                
                // Drop the old primary key
                await client.query(`ALTER TABLE "bse_top_gainers_losers" DROP CONSTRAINT "${pkName}";`);
                // Add the new primary key
                await client.query(`ALTER TABLE "bse_top_gainers_losers" ADD PRIMARY KEY ("type", "rank");`);
                console.log('Migration complete.');
            }
        }
    } catch (e) {
        console.error('Migration check failed, skipping:', e);
    }

    console.log('Database schema initialized successfully.');
  } catch (error) {
    console.error('Error initializing database schema:', error);
    throw error;
  } finally {
    client.release();
  }
}
