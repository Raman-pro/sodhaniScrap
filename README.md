# Stock Market Data Ingestion Pipeline

A highly robust, idempotent, long-running Node.js daemon that ingests stock market data for 2,500+ Indian equities. The service is designed to safely handle sudden crashes and restarts without creating duplicate rows in the database, maintaining a highly available time-series database.

## Architecture and Workflow

When the daemon starts via `npm start`, it runs through 3 phases:

1. **Phase 1: Bootstrapping & Master Sync**
   Ensures the PostgreSQL database connection pool is running, generates the schema if missing, and syncs the master list of 2500+ equities using `companies.json` and BSE Bhavcopy mapping.
2. **Phase 2: Historical Catch-Up (Yahoo Finance Sync)**
   Iterates through the master list to query the maximum record date. Automatically downloads and upserts the exact missing days via `yahoo-finance2` using bulk, idempotent operations.
3. **Phase 3: Live Polling Loop (BSE Sync)**
   Enters an infinite polling loop (default: every 5 minutes). Securely fetches gainers and losers directly from the BSE APIs (using exact spoofed headers), appending intra-day price action to the time-series.

### Corporate Announcements Worker
The corporate announcements fetcher is separated into its own independent worker so it can be scaled, paused, or run on a different cadence than the core price ingestion daemon.

## Prerequisites

* **Node.js**: v18 or later.
* **Database**: PostgreSQL database.

## Setup Instructions

1. **Install Dependencies**
   Navigate to the project root and install the necessary dependencies:
   ```bash
   npm install
   ```

2. **Database & Application Configuration**
   Ensure your local PostgreSQL database is running. Create a `.env` file in the root directory with the following configuration options:
   ```env
   # Database connection
   DATABASE_URL=postgresql://<user>:<password>@localhost:5432/<dbname>

   # Live Sync Polling interval (default 5 minutes)
   POLL_INTERVAL_MS=300000

   # BSE Live Sync Endpoints
   BSE_GAINER_URL=https://api.bseindia.com/BseIndiaAPI/api/MktRGainerLoserDataeqto/w?GLtype=gainer&IndxGrp=AllMkt&IndxGrpval=AllMkt&orderby=all
   BSE_LOSER_URL=https://api.bseindia.com/BseIndiaAPI/api/MktRGainerLoserDataeqto/w?GLtype=loser&IndxGrp=AllMkt&IndxGrpval=AllMkt&orderby=all

   # Optional path to the local BSE BhavCopy CSV mapping file
   BHAVCOPY_CSV_PATH=../../BhavCopy_BSE_CM_0_0_0_20260722_F_0000.CSV

   # Yahoo Finance starting date fallback
   YAHOO_DEFAULT_START_DATE=1990-01-01

   # Announcements Worker Configuration
   BSE_ANNOUNCEMENTS_URL=https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w
   ANNOUNCEMENTS_POLL_INTERVAL_MS=600000
   ANNOUNCEMENTS_START_DATE=2026-07-01
   ```

3. **Provide Source Files**
   Ensure `companies.json` and the CSV referenced by `BHAVCOPY_CSV_PATH` are available locally.

## How to Run

Do **NOT** try to run the `.ts` files directly using standard `node src/index.ts` as Node doesn't understand TypeScript natively.

Instead, start the full ingestion application using the `npm start` script (which uses `tsx` behind the scenes):

```bash
npm start
```

### Running the Corporate Announcements Worker

To run the BSE announcements fetcher in parallel, open a second terminal window and run:

```bash
npm run start:announcements
```
*(This script accepts the `--skip_start` flag if you want to bypass database initialization).*

### Skipping Bootstrapping (Live Sync Only)

If the database is already fully bootstrapped with historical data and you simply want to jump directly into the **Phase 3 Live Polling Loop**, you can run:

```bash
npm run skip_start
```

### Building for Production

If you want to compile the project down to pure JavaScript before running (e.g. for deployment via PM2 or Docker):

```bash
npm run build
node dist/index.js

# To run the announcements worker in production:
node dist/announcements.js
```

## Database Schema Highlights

The pipeline enforces a tight schema:
* `company_stock`: Static master list (`FinInstrmId`, `TckrSymb`, etc.)
* `historical_prices`: Narrow time-series table. Uses a composite primary key on `("FinInstrmId", "record_date")` and a B-Tree Index on `("FinInstrmId", "record_date" DESC)` to allow sub-millisecond chart lookups.
* `bse_announcements`: Contains fetched corporate announcements. Uses indexed columns for efficient filtering.
* `sync_metadata`: Generic key-value store to maintain state (e.g., `last_newsid`) entirely within the database.
