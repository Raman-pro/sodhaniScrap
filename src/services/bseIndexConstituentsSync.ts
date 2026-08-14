import { pool } from '../db/pool';
// @ts-ignore
import format from 'pg-format';
import dotenv from 'dotenv';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { loadIndices, HEADERS } from './indicesSync';

dotenv.config();

const execFileAsync = promisify(execFile);
const REQUEST_DELAY_MS = parseInt(process.env.INDICES_REQUEST_DELAY_MS || '300', 10);

// BSE's HeatMapData endpoint always returns exactly 30 slots. Indices with
// fewer than 30 members are padded with placeholder records whose ticker is
// the literal string "aaaa" - those must be filtered out. Indices with more
// than 30 members are truncated to their day's 30 biggest movers (verified:
// alpha=A and alpha=D return the same 30 reordered, so there is no second
// page to stitch); membership for those indices is therefore partial and
// will grow across runs as different movers surface.
const PADDING_TICKER = 'aaaa';

function curlFetch(url: string) {
    return execFileAsync('curl', [
        '-s', '-m', '15', '--compressed',
        '-H', `accept: ${HEADERS.accept}`,
        '-H', `accept-encoding: ${HEADERS['accept-encoding']}`,
        '-H', `accept-language: ${HEADERS['accept-language']}`,
        '-H', `origin: ${HEADERS.origin}`,
        '-H', `priority: ${HEADERS.priority}`,
        '-H', `referer: ${HEADERS.referer}`,
        '-H', `sec-ch-ua: ${HEADERS['sec-ch-ua']}`,
        '-H', `sec-ch-ua-mobile: ${HEADERS['sec-ch-ua-mobile']}`,
        '-H', `sec-ch-ua-platform: ${HEADERS['sec-ch-ua-platform']}`,
        '-H', `sec-fetch-dest: ${HEADERS['sec-fetch-dest']}`,
        '-H', `sec-fetch-mode: ${HEADERS['sec-fetch-mode']}`,
        '-H', `sec-fetch-site: ${HEADERS['sec-fetch-site']}`,
        '-H', `user-agent: ${HEADERS['user-agent']}`,
        url
    ], { maxBuffer: 10 * 1024 * 1024 }).then(({ stdout }) => stdout);
}

export function parseHeatMap(raw: string): { tckr: string; scripCode: string }[] {
    let text: string;
    try {
        const parsed = JSON.parse(raw);
        text = typeof parsed === 'string' ? parsed : String(parsed ?? '');
    } catch {
        return [];
    }

    const delimIdx = text.indexOf('$#$');
    if (delimIdx === -1) return [];
    const body = text.slice(delimIdx + 3);

    const results: { tckr: string; scripCode: string }[] = [];
    for (const record of body.split('|')) {
        if (!record.trim()) continue;
        const fields = record.split(',');
        if (fields.length < 9) continue;

        const tckr = fields[0].trim();
        const scripCode = fields[8].trim();
        if (!tckr || tckr === PADDING_TICKER || !scripCode) continue;

        results.push({ tckr, scripCode });
    }
    return results;
}

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export async function bseIndexConstituentsSync() {
    console.log(`[${new Date().toISOString()}] --- Starting BSE Index Constituents Sync ---`);
    const indices = loadIndices();
    if (indices.length === 0) {
        console.warn('No indices loaded from indices.json, skipping BSE constituents sync.');
        return;
    }

    const client = await pool.connect();
    let processedCount = 0;
    let totalMatched = 0;

    try {
        // Guard FinInstrmId against company_stock the same way nseIndicesSync does,
        // since bse_index_constituents.sccode is FK-checked but FinInstrmId is not.
        const validCodesRes = await client.query('SELECT "FinInstrmId" FROM company_stock');
        const validCodes = new Set(validCodesRes.rows.map(r => r.FinInstrmId));

        for (const idx of indices) {
            const url = `https://api.bseindia.com/BseIndiaAPI/api/HeatMapData/w?flag=HEAT&alpha=D&indexcode=${encodeURIComponent(idx.sccode)}&random=${Date.now()}`;

            let raw: string | null = null;
            try {
                raw = await curlFetch(url);
            } catch (error: any) {
                console.error(`BSE Constituents Fetch Error (curl) for sccode=${idx.sccode}:`, error.message);
            }

            if (raw) {
                const records = parseHeatMap(raw);
                const matched = records.filter(r => validCodes.has(r.scripCode));

                console.log(`[BSE Constituents] ${idx.scname} (${idx.sccode}): ${matched.length}/${records.length} matched to company_stock`);

                if (matched.length > 0) {
                    const values = matched.map(r => [idx.sccode, r.scripCode]);
                    const query = format(`
                        INSERT INTO bse_index_constituents (sccode, "FinInstrmId")
                        VALUES %L
                        ON CONFLICT (sccode, "FinInstrmId") DO UPDATE SET
                            updated_at = CURRENT_TIMESTAMP
                    `, values);
                    await client.query(query);
                    totalMatched += matched.length;
                }
            }

            processedCount++;
            await sleep(REQUEST_DELAY_MS);
        }
    } catch (error) {
        console.error('Error during BSE Index Constituents sync:', error);
    } finally {
        client.release();
    }

    console.log(`BSE Index Constituents sync complete: ${processedCount} indices processed, ${totalMatched} constituent rows upserted.`);
}
