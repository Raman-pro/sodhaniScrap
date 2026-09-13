import { pool } from '../db/pool';

async function main() {
  const isExecute = process.argv.includes('--execute');

  console.log('=====================================================');
  console.log(`  Weekend Ticks Remediation Script (${isExecute ? 'EXECUTE MODE' : 'DRY RUN MODE'})`);
  console.log('=====================================================\n');

  const client = await pool.connect();
  try {
    // 1. Audit legitimate historical sessions (MUST NOT BE DELETED)
    const legitResult = await client.query(`
      SELECT 
        record_date::date as dt, 
        TO_CHAR(record_date, 'Dy') as dow, 
        COUNT(*) as total_rows
      FROM historical_prices 
      WHERE EXTRACT(DOW FROM record_date) IN (0, 6) 
        AND adj_close IS NOT NULL
      GROUP BY dt, dow
      ORDER BY dt DESC;
    `);

    console.log(`[Audit] Found ${legitResult.rows.length} genuine exchange weekend dates (Diwali Muhurat, Budget, DR sessions).`);
    console.log('[Audit] These records have adj_close IS NOT NULL and will be 100% PRESERVED:\n');
    console.table(legitResult.rows.slice(0, 10));

    // 2. Audit synthetic scraper rows (TARGET FOR CLEANUP)
    const syntheticResult = await client.query(`
      SELECT 
        record_date::date as dt, 
        TO_CHAR(record_date, 'Dy') as dow, 
        COUNT(*) as total_rows
      FROM historical_prices 
      WHERE EXTRACT(DOW FROM record_date) IN (0, 6) 
        AND adj_close IS NULL
      GROUP BY dt, dow
      ORDER BY dt DESC;
    `);

    let totalSyntheticRows = 0;
    for (const row of syntheticResult.rows) {
      totalSyntheticRows += parseInt(row.total_rows, 10);
    }

    console.log(`\n[Audit] Found ${syntheticResult.rows.length} weekend dates with synthetic scraper rows:`);
    console.table(syntheticResult.rows);
    console.log(`\nTotal synthetic weekend rows identified: ${totalSyntheticRows}`);

    if (!isExecute) {
      console.log('\n[Dry Run] NO CHANGES MADE. To execute deletion, re-run with --execute.');
      return;
    }

    console.log('\n[Execute] Deleting synthetic weekend rows...');
    const deleteResult = await client.query(`
      DELETE FROM historical_prices 
      WHERE EXTRACT(DOW FROM record_date) IN (0, 6) 
        AND adj_close IS NULL;
    `);

    console.log(`[Execute] Successfully deleted ${deleteResult.rowCount} synthetic weekend records.`);

  } catch (err: any) {
    console.error('Error during cleanup script execution:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
