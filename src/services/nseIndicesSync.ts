import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { pool } from '../db/pool';
// @ts-ignore
import format from 'pg-format';
import { execFile } from 'child_process';
import { promisify } from 'util';
import dotenv from 'dotenv';

dotenv.config();

const execFileAsync = promisify(execFile);
const REQUEST_DELAY_MS = parseInt(process.env.INDICES_REQUEST_DELAY_MS || '300', 10);

async function curlFetch(url: string) {
    try {
        const { stdout } = await execFileAsync('curl', [
            '-s', '-m', '15',
            '-H', 'accept: application/json',
            '-H', 'user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            '-H', 'Referer: https://www.nseindia.com/',
            url
        ], { maxBuffer: 10 * 1024 * 1024 });
        return JSON.parse(stdout);
    } catch (error: any) {
        console.error(`NSE Fetch Error (curl):`, error.message);
        return null;
    }
}

function loadNseIndices(): { symbol: string, name: string }[] {
    const jsonPath = path.join(__dirname, '../../nse_indices.json');
    if (!fs.existsSync(jsonPath)) {
        console.warn('nse_indices.json not found');
        return [];
    }
    try {
        const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        return (raw as any[]).map(r => ({ symbol: String(r.symbol).trim(), name: String(r.name).trim() }));
    } catch (err) {
        console.error('Failed to load nse_indices.json:', err);
        return [];
    }
}

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export async function seedNseIndices() {
    const indices = loadNseIndices();
    if (indices.length === 0) return;

    const client = await pool.connect();
    try {
        const values = indices.map(idx => [idx.symbol, idx.name]);
        const query = format(`
            INSERT INTO nse_indices (symbol, name)
            VALUES %L
            ON CONFLICT (symbol) DO UPDATE SET
                name = EXCLUDED.name,
                updated_at = CURRENT_TIMESTAMP
        `, values);
        await client.query(query);
        console.log(`Seeded ${indices.length} indices into nse_indices.`);
    } catch (error) {
        console.error('Error seeding nse_indices:', error);
    } finally {
        client.release();
    }
}

export async function nseIndicesHistoryBackfill() {
    console.log('--- Starting NSE Indices History Backfill ---');
    const indices = loadNseIndices();
    if (indices.length === 0) return;

    let processedCount = 0;
    let totalRows = 0;

    const client = await pool.connect();
    try {
        for (const idx of indices) {
            // Check if already backfilled today
            const res = await client.query('SELECT MAX(record_time)::date AS last_date FROM nse_index_history WHERE symbol = $1', [idx.symbol]);
            const lastDate = res.rows[0]?.last_date;
            
            const today = new Date();
            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);

            if (lastDate && lastDate >= yesterday) {
                processedCount++;
                continue; // Already backfilled recently
            }

            const url = `https://www.nseindia.com/api/NextApi/apiClient/historicalGraph?functionName=getIndexChart&=&index=${encodeURIComponent(idx.symbol)}&flag=1Y`;
            const data = await curlFetch(url);
            
            if (data?.data?.grapthData) {
                const points = data.data.grapthData;
                const values = [];

                for (const p of points) {
                    const epochMs = p[0];
                    const val = p[1];
                    const dateStr = new Date(epochMs).toISOString().split('T')[0];
                    
                    values.push([
                        idx.symbol,
                        `${dateStr} 00:00:00`,
                        val
                    ]);
                }

                if (values.length > 0) {
                    const query = format(`
                        INSERT INTO nse_index_history (symbol, record_time, value)
                        VALUES %L
                        ON CONFLICT (symbol, record_time) DO UPDATE SET
                            value = EXCLUDED.value,
                            updated_at = CURRENT_TIMESTAMP
                    `, values);
                    await client.query(query);
                    totalRows += values.length;
                }
            }

            processedCount++;
            await sleep(REQUEST_DELAY_MS);
        }
    } catch (error) {
        console.error('Error in NSE Indices History Backfill:', error);
    } finally {
        client.release();
    }

    console.log(`NSE Backfill complete: ${processedCount} indices processed, ${totalRows} historical daily rows upserted.`);
}

export async function nseIndicesLiveSync() {
    console.log(`[${new Date().toISOString()}] --- Starting NSE Indices Live Sync ---`);
    const indices = loadNseIndices();
    if (indices.length === 0) return;

    const client = await pool.connect();
    
    try {
        // Prepare map of TckrSymb to FinInstrmId (to correctly resolve dual-listed stocks which use BSE scrip codes as FinInstrmId)
        // BSE Bhavcopy inserts raw tickers (e.g., 'RELIANCE'), while NSE-only inserts have '.NS' (e.g., 'JIOFIN.NS').
        const validCodesRes = await client.query('SELECT "FinInstrmId", "TckrSymb" FROM company_stock');
        const validCodesMap = new Map();
        for (const row of validCodesRes.rows) {
            validCodesMap.set(row.TckrSymb, row.FinInstrmId);
        }
        
        console.log(`[NSE Debug] Initializing live sync. Valid stock codes mapped: ${validCodesMap.size}`);
        
        for (const idx of indices) {
            const url = `https://www.nseindia.com/api/NextApi/apiClient/marketWatchApi?functionName=getIndicesData&symbol=${encodeURIComponent(idx.symbol)}`;
            const res = await curlFetch(url);

            if (!res) {
                console.warn(`[NSE Debug] Failed to fetch data for ${idx.symbol} (Timeout or Error)`);
            } else if (res?.data) {
                console.log(`[NSE Debug] Successfully fetched data for ${idx.symbol}. Constituents count: ${res.data.data?.length}`);
                const aduCount = res.data.aduCount || { advances: null, declines: null, unchange: null };
                const constituents = res.data.data || [];
                
                if (constituents.length > 0) {
                    // Extract Index Data (Priority 1)
                    const indexData = constituents.find((c: any) => c.priority === 1);
                    if (indexData) {
                        const recordTime = indexData.lastUpdateTime 
                            ? new Date(indexData.lastUpdateTime).toISOString().replace('T', ' ').split('.')[0] 
                            : new Date().toISOString().replace('T', ' ').split('.')[0];
                            
                        const todayStr = recordTime.split(' ')[0];
                        console.log(`[NSE Debug] Found indexData for ${idx.symbol}. recordTime: ${recordTime}. Updating daily summary...`);

                        // Insert daily summary
                        const dailyQuery = format(`
                            INSERT INTO nse_index_history (symbol, record_time, value, prev_close, change_val, change_pct, advances, declines, unchanged)
                            VALUES %L
                            ON CONFLICT (symbol, record_time) DO UPDATE SET
                                value = EXCLUDED.value,
                                prev_close = EXCLUDED.prev_close,
                                change_val = EXCLUDED.change_val,
                                change_pct = EXCLUDED.change_pct,
                                advances = EXCLUDED.advances,
                                declines = EXCLUDED.declines,
                                unchanged = EXCLUDED.unchanged,
                                updated_at = CURRENT_TIMESTAMP
                        `, [[idx.symbol, `${todayStr} 00:00:00`, indexData.lastPrice, indexData.previousClose, indexData.change, indexData.pChange, aduCount.advances, aduCount.declines, aduCount.unchange]]);
                        await client.query(dailyQuery);

                        // Insert intraday tick
                        const intradayQuery = format(`
                            INSERT INTO nse_index_history (symbol, record_time, value, prev_close, change_val, change_pct, advances, declines, unchanged)
                            VALUES %L
                            ON CONFLICT (symbol, record_time) DO UPDATE SET
                                value = EXCLUDED.value,
                                prev_close = EXCLUDED.prev_close,
                                change_val = EXCLUDED.change_val,
                                change_pct = EXCLUDED.change_pct,
                                advances = EXCLUDED.advances,
                                declines = EXCLUDED.declines,
                                unchanged = EXCLUDED.unchanged,
                                updated_at = CURRENT_TIMESTAMP
                        `, [[idx.symbol, recordTime, indexData.lastPrice, indexData.previousClose, indexData.change, indexData.pChange, aduCount.advances, aduCount.declines, aduCount.unchange]]);
                        await client.query(intradayQuery);
                        console.log(`[NSE Debug] Successfully inserted index history for ${idx.symbol}`);
                    } else {
                        console.log(`[NSE Debug] indexData NOT FOUND for ${idx.symbol}. Constituents:`, constituents.map((c: any) => c.symbol).slice(0, 5));
                    }

                    // Extract Constituents
                    const constituentStocks = constituents.filter((c: any) => c.priority === 0);
                    
                    const priceValues = [];
                    const relValues = [];
                    const recordDate = new Date().toISOString().split('T')[0];

                    for (const stock of constituentStocks) {
                        const rawTckr = stock.symbol;
                        const dbFinInstrmId = validCodesMap.get(rawTckr);
                        
                        if (dbFinInstrmId) {
                            // Upsert mapping
                            relValues.push([idx.symbol, dbFinInstrmId]);

                            // Upsert live price using exact true API data
                            priceValues.push([
                                dbFinInstrmId,
                                recordDate,
                                stock.open,
                                stock.dayHigh,
                                stock.dayLow,
                                stock.lastPrice, // close_price
                                Math.floor(stock.totalTradedVolume)
                            ]);
                        }
                    }

                    console.log(`[NSE Debug] Matching valid stocks for ${idx.symbol}: ${relValues.length} / ${constituentStocks.length}`);

                    if (relValues.length > 0) {
                        const relQuery = format(`
                            INSERT INTO nse_index_constituents (index_symbol, stock_symbol)
                            VALUES %L
                            ON CONFLICT DO NOTHING
                        `, relValues);
                        await client.query(relQuery);
                    }

                    if (priceValues.length > 0) {
                        const priceQuery = format(`
                            INSERT INTO historical_prices 
                            ("FinInstrmId", record_date, open_price, high_price, low_price, close_price, volume)
                            VALUES %L
                            ON CONFLICT ("FinInstrmId", record_date) DO UPDATE SET 
                                open_price = EXCLUDED.open_price,
                                high_price = EXCLUDED.high_price,
                                low_price = EXCLUDED.low_price,
                                close_price = EXCLUDED.close_price,
                                volume = EXCLUDED.volume
                        `, priceValues);
                        await client.query(priceQuery);
                        console.log(`[NSE Debug] Successfully inserted constituent prices for ${idx.symbol}`);
                    }
                }
            }

            await sleep(REQUEST_DELAY_MS);
        }
    } catch (error) {
        console.error('Error during NSE Indices live sync:', error);
    } finally {
        client.release();
    }
}
