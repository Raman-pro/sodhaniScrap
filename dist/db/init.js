"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initDB = initDB;
const pool_1 = require("./pool");
async function initDB() {
    const client = await pool_1.pool.connect();
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
          "record_date" DATE NOT NULL,
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
        console.log('Database schema initialized successfully.');
    }
    catch (error) {
        console.error('Error initializing database schema:', error);
        throw error;
    }
    finally {
        client.release();
    }
}
