# Market Data Ingestion Pipeline Architecture

## System Overview
This service is a unified, long-running Node.js (TypeScript) daemon responsible for maintaining a highly accurate, up-to-date PostgreSQL database of stock market prices for 2,500+ Indian equities. It is designed to be fully idempotent, self-healing, and capable of recovering from network or power failures without data duplication.

## Core Tech Stack
*   **Runtime:** Node.js with TypeScript.
*   **Database Engine:** PostgreSQL.
*   **Database Driver:** `pg` (node-postgres) for high-performance connection pooling.
*   **Historical Data Provider:** `yahoo-finance2` (TypeScript-native Yahoo Finance client).
*   **Live Data Provider:** Direct REST polling to BSE India undocumented APIs.
*   **File Parsing:** `csv-parser` for streaming large Bhavcopy files without blowing up RAM.

---

## Execution Flow (The 3-Phase Lifecycle)

When the service (`npm run start`) is executed, it progresses through three distinct phases:

### Phase 1: Bootstrapping & Schema Verification
Before fetching any external data, the system ensures the environment is safe and properly structured.
1. **Connection Pooling:** Initializes a `pg.Pool` (e.g., 10-20 concurrent connections) to prevent database connection exhaustion.
2. **Schema Assertions:** Executes `CREATE TABLE IF NOT EXISTS` for both `company_stock` and `historical_prices`.
you can refer to `sample_db_schema.sql` for all database configuration.

3. **Constraint Validation:** Verifies the presence of the composite primary key (`FinInstrmId`, `record_date`) to guarantee idempotent upserts.
4. **Master List Sync:** Reads `companies.json` and the BSE CSV mapping file. It runs a bulk `ON CONFLICT DO NOTHING` insert into the `company_stock` table to ensure foreign-key dependencies are satisfied before price data is ingested.

### Phase 2: Historical Catch-Up (Yahoo Finance Sync)
The system ensures that the historical data is complete up to the current day.
1. **Gap Analysis:** Queries the database (`SELECT MAX(record_date) FROM historical_prices WHERE "FinInstrmId" = $1`) for each active ticker to determine where the data drops off.
2. **Delta Fetching:** Iterates through the master list. If a stock is missing data for the last 5 days, it uses `yahoo-finance2` to fetch only the missing 5 days, rather than requesting the `max` period every time.
3. **Idempotent Upsert:** Inserts the Yahoo Finance data using the `ON CONFLICT ("FinInstrmId", "record_date") DO UPDATE` query. If the data already exists, it silently overwrites it with the latest values.

### Phase 3: The Live Updation Loop (BSE Polling)
Once historical data is verified and caught up, the script enters an infinite `setInterval` loop to handle real-time/intraday changes.
1. **Polling Execution:** Triggers asynchronous `fetch` calls to the BSE `MktRGainerLoserDataeqto` endpoints (Gainers, Losers, and Neutrals).
2. **Data Transformation:** Maps the BSE JSON keys (`scrip_cd`, `openrate`, `ltradert`) directly into the PostgreSQL schema (`FinInstrmId`, `open_price`, `close_price`).
3. **Batch Upserting:** Bundles all updated stocks into a single parameterized transaction (using `pg-format` or manual tuple construction). 
4. **Sleep/Throttle:** Pauses execution for a set interval (e.g., 5 minutes) before polling again, respecting BSE rate limits.

---

## Database Schema (Single Source of Truth)

The system relies on a vertically stacked "long and narrow" table structure, optimized for fast time-series retrieval.

### 1. company_stock
Holds the static metadata and mapping IDs.
*   `FinInstrmId` (BIGINT, Primary Key) - BSE Scrip Code.
*   `TckrSymb` (VARCHAR) - Yahoo Finance mapped symbol.
*   *(Other static metadata columns...)*

### 2. historical_prices
Houses the time-series OHLCV data. 
*   `FinInstrmId` (BIGINT, Foreign Key)
*   `record_date` (DATE)
*   `open_price`, `high_price`, `low_price`, `close_price` (DECIMAL)
*   `volume` (BIGINT)
*   **Primary Key Constraint:** `PRIMARY KEY ("FinInstrmId", "record_date")`
*   **Optimization:** B-Tree Index on `("FinInstrmId", "record_date" DESC)` for sub-millisecond chart lookups.

---

## Key Engineering Decisions

| Principle | Implementation | Justification |
| :--- | :--- | :--- |
| **No Local File State** | Removed Parquet/JSON disk writes. Data goes directly from RAM to Postgres. | Eliminates disk I/O bottlenecks and prevents corrupted files during sudden server restarts. |
| **Idempotency** | Extensive use of `ON CONFLICT DO UPDATE`. | Scripts can fail midway, be manually restarted, or run simultaneously without ever duplicating a chart candle. |
| **Memory Efficiency** | Node streams for CSV parsing; Batched DB inserts (chunks of 1,000). | Prevents the V8 Javascript engine from hitting heap limits (Out of Memory errors) when processing millions of rows. |
| **Header Spoofing** | Strict hardcoded `sec-ch-ua` and `Referer` headers for BSE API. | BSE actively blocks automated scrapers. Matching Chrome user-agent signatures is required for continuous polling. |

## Deployment Strategy
This TypeScript module should be compiled to JavaScript (`tsc`) and run via a process manager like **PM2** or inside a **Docker container**. This ensures the script automatically restarts if an unhandled network exception occurs during the Phase 3 polling loop.