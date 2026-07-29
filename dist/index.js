"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const init_1 = require("./db/init");
const bootstrap_1 = require("./services/bootstrap");
const yahooHistory_1 = require("./services/yahooHistory");
const bseLiveSync_1 = require("./services/bseLiveSync");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '300000', 10);
async function startLivePolling() {
    console.log(`Starting Phase 3 Live Polling Loop every ${POLL_INTERVAL_MS / 1000} seconds...`);
    // Run immediately first
    await (0, bseLiveSync_1.bseLiveSync)();
    // Then schedule
    setInterval(async () => {
        await (0, bseLiveSync_1.bseLiveSync)();
    }, POLL_INTERVAL_MS);
}
async function main() {
    try {
        const skipStart = process.argv.includes('--skip_start');
        if (!skipStart) {
            console.log('Starting Market Data Ingestion Pipeline...');
            // Phase 1: Bootstrapping & Schema Verification
            await (0, init_1.initDB)();
            await (0, bootstrap_1.bootstrapMasterList)();
            // Phase 2: Historical Catch-Up (Yahoo Finance Sync)
            await (0, yahooHistory_1.fetchHistoricalCatchup)();
        }
        else {
            console.log('--- SKIP START DETECTED ---');
            console.log('Skipping Phase 1 (Bootstrap) and Phase 2 (Historical Catch-up).');
        }
        // Phase 3: The Live Updation Loop (BSE Polling)
        startLivePolling();
    }
    catch (err) {
        console.error('Fatal error during initialization:', err);
        process.exit(1);
    }
}
main();
