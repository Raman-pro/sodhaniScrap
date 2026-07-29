

---

### 📋 Copy/Paste Prompt for AI Agent

**Objective:** Build a robust, long-running Node.js (TypeScript) daemon that manages a stock market data ingestion pipeline for 2,500+ Indian equities. The service must initialize the database, backfill missing historical data using `yahoo-finance2`, and then enter a continuous polling loop to update live prices from exact BSE APIs.

**Context & Environment:**

* **Runtime:** Node.js (v18+) with TypeScript.
* **Database:** PostgreSQL.
* **Local Files Available:** `companies.json` and a BSE Bhavcopy CSV (e.g., `BhavCopy_BSE_CM_0_0_0_20260722_F_0000.CSV`).
* **Core Dependencies to Install:** `pg` (and `@types/pg`), `yahoo-finance2`, `csv-parser`, `pg-format`, `dotenv`, `axios` or native `fetch`.

**1. Architectural & File Structure Requirements:**
Do not write a single monolithic file. Architect the project properly using the following structure:

* `src/db/` - Database connection pool and schema initialization queries.
* `src/types/` - TypeScript interfaces for DB rows, API responses, and mapped types.
* `src/services/` - Modules for specific tasks (e.g., `yahooHistory.ts`, `bseLiveSync.ts`, `csvParser.ts`).
* `src/index.ts` - The main orchestrator that manages the 3-phase lifecycle.

**2. Strict Database Rules (DO NOT DEVIATE):**

* **Schema:** You must use ONLY TWO tables: `company_stock` (master list) and `historical_prices`. Do NOT create separate tables per stock, **refer to schema in `sample_db_schema.sql`**
* **Idempotency:** Every single database insert MUST use `ON CONFLICT ("FinInstrmId", "record_date") DO UPDATE SET...`. The script must be able to crash, restart, and run repeatedly without ever creating duplicate rows.
* **No File State:** Do not write any fetched data to JSON or Parquet files. All fetched data goes directly into PostgreSQL.

**3. The 3-Phase Implementation:**

**Phase 1: Bootstrapping & Master Sync**

* Initialize a `pg.Pool`.
* Execute `CREATE TABLE IF NOT EXISTS` for both tables. Ensure `historical_prices` has a composite primary key on `("FinInstrmId", "record_date")` and a foreign key to `company_stock`.
* Read the local `companies.json` and the BSE Bhavcopy CSV. Extract the mapping of `FinInstrmId` (BSE Scrip Code) to `TckrSymb` (Yahoo ticker symbol).
* Perform a bulk `ON CONFLICT DO NOTHING` insert into `company_stock` to ensure all foreign keys are valid.

**Phase 2: Historical Catch-Up (Yahoo Finance)**

* For every active stock, query `MAX(record_date)` to find out when it was last updated.
* Use `yahoo-finance2` to fetch the missing history. Use `.BO` or `.NS` suffixes where appropriate based on the mapping.
* Bulk upsert the fetched Yahoo OHLCV data into `historical_prices` (Format dates as `YYYY-MM-DD`).

**Phase 3: The Live Polling Loop (BSE APIs)**

* Create a `setInterval` loop that runs every 5 minutes.
* You MUST fetch from the following exact URLs using native `fetch` or `axios`:
* **Gainers:** `[https://api.bseindia.com/BseIndiaAPI/api/MktRGainerLoserDataeqto/w?GLtype=gainer&IndxGrp=AllMkt&IndxGrpval=AllMkt&orderby=all](https://api.bseindia.com/BseIndiaAPI/api/MktRGainerLoserDataeqto/w?GLtype=gainer&IndxGrp=AllMkt&IndxGrpval=AllMkt&orderby=all)`
* **Losers:** `[https://api.bseindia.com/BseIndiaAPI/api/MktRGainerLoserDataeqto/w?GLtype=loser&IndxGrp=AllMkt&IndxGrpval=AllMkt&orderby=all](https://api.bseindia.com/BseIndiaAPI/api/MktRGainerLoserDataeqto/w?GLtype=loser&IndxGrp=AllMkt&IndxGrpval=AllMkt&orderby=all)`


* **CRITICAL:** You must include the following headers in your requests to bypass BSE's scraper protection. Do not omit any of these:
```json
{
    "accept": "application/json, text/plain, */*",
    "accept-language": "en-US,en-IN;q=0.9,en;q=0.8",
    "priority": "u=1, i",
    "sec-ch-ua": "\"Not;A=Brand\";v=\"8\", \"Chromium\";v=\"150\", \"Google Chrome\";v=\"150\"",
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": "\"macOS\"",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-site",
    "Referer": "https://www.bseindia.com/"
}

```


* Map the BSE JSON fields to match the database (`scrip_cd` -> `FinInstrmId`, `openrate` -> `open_price`, `ltradert` -> `close_price`, `trd_vol` -> `volume`). Assume the `record_date` is the current date (today).
* Batch all the updated BSE data (Gainers + Losers) and run a single bulk `ON CONFLICT DO UPDATE` transaction against `historical_prices`.

**Output Instructions:**

* Generate all necessary `.ts` files based on the requested architecture.
* Ensure all database queries are parameterized to prevent SQL injection.
* Include comprehensive `console.log` statements so the progress of all three phases is visible in the terminal.