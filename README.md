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

### Indices Worker (BSE + NSE)
A separate worker (`src/indices.ts`) ingests index-level data for **both exchanges** and polls all of it from a single process:

* **BSE indices** — SENSEX and ~77 other sectoral/thematic indices, defined in `indices.json`, via the BSE Graph Data API used by the website. On start it seeds `bse_indices` from `indices.json`, backfills `INDICES_HISTORY_YEARS` (default 1 year) of daily closes per index into `bse_index_history`, then polls every `INDICES_POLL_INTERVAL_MS` (default 10 minutes) to refresh today's close and capture the full intraday minute series, all into the same `bse_index_history` table. The backfill is resumable — subsequent runs only fetch the gap since each index's last synced date.
* **NSE indices** — NIFTY 50, BANK, FIN SERVICE, FPI 150, MID SELECT, and NEXT 50, defined in `nse_indices.json`, via NSE's `NextApi` endpoints. On start it seeds `nse_indices`, backfills 1 year of daily closes into `nse_index_history`, then polls on the same `INDICES_POLL_INTERVAL_MS` cadence for today's close, the latest intraday tick, and market-breadth counts (advances/declines/unchanged). Each poll also refreshes that index's constituent mapping (`nse_index_constituents`) and pushes live OHLCV for each constituent straight into `historical_prices`.
* **BSE index constituents** — a lower-frequency pass (`BSE_CONSTITUENTS_INTERVAL_MS`, default 1 hour) that scrapes BSE's public heatmap feed (`HeatMapData`) for every index in `indices.json` and upserts the ticker → index membership into `bse_index_constituents`. Unlike NSE, **this feed is capped at exactly 30 rows per index by BSE itself** — complete for indices with ≤30 members (SENSEX, BANKEX, sectorals), but only that day's 30 biggest movers for broader indices (BSE 500, BSE 1000, …), so membership for those grows/rotates across runs rather than being a stable, complete set. It does not write prices — those stay owned by the core BSE live sync (Phase 3) to avoid two writers on the same `historical_prices` rows.

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

   # Indices Worker Configuration (shared by both BSE and NSE index syncs)
   INDICES_POLL_INTERVAL_MS=600000
   INDICES_HISTORY_YEARS=1
   INDICES_REQUEST_DELAY_MS=300

   # BSE index constituents sync cadence (default 1 hour) - kept far slower
   # than INDICES_POLL_INTERVAL_MS since membership barely changes intraday
   BSE_CONSTITUENTS_INTERVAL_MS=3600000
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

### Running the Indices Worker (BSE + NSE)

To run the BSE + NSE indices fetcher (including BSE index constituents) in parallel, open another terminal window and run:

```bash
npm run start:indices
```

To skip database init, seeding, and the history backfill and jump straight into the live polling loop:

```bash
npm run skip_start:indices
```

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
* `bse_indices`: Static master list of BSE indices (`sccode`, `scname`) seeded from `indices.json`.
* `bse_index_history`: Unified BSE index series (daily closes and intraday ticks). Composite primary key on `("sccode", "record_time")`. Daily bars are stored at midnight with `session` NULL; intraday ticks carry a real time-of-day and `session` of `preopen`/`regular` — `session IS NULL` distinguishes a daily bar from a tick.
* `bse_index_constituents`: BSE index → member stock mapping (`sccode`, `"FinInstrmId"`), scraped from BSE's `HeatMapData` heatmap feed. That feed is hard-capped at 30 rows per index, so this table is complete only for indices with ≤30 members — see the Indices Worker section above.
* `nse_indices`: Static master list of NSE indices (`symbol`, `name`) seeded from `nse_indices.json`.
* `nse_index_history`: Unified NSE index series (daily closes and intraday ticks), including market-breadth counts (`advances`, `declines`, `unchanged`). Composite primary key on `("symbol", "record_time")`. Unlike the BSE table, `session` is always NULL here — a daily bar vs. an intraday tick is distinguished by whether `record_time`'s time-of-day component is exactly midnight.
* `nse_index_constituents`: NSE index → member stock mapping (`index_symbol`, `stock_symbol`, the latter actually holding a `company_stock."FinInstrmId"`). Unlike BSE, this is the complete membership for every index (NIFTY 50 → 50 rows, NIFTY FPI 150 → 150 rows, etc.), refreshed on every poll.
