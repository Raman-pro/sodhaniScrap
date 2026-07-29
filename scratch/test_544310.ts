import YahooFinance from 'yahoo-finance2';
const yahooFinance = new (YahooFinance as any)();

async function main() {
  const symbol = 'YASHHV.BO';
  const result = await yahooFinance.chart(symbol, {
    period1: '1990-01-01',
    period2: '2026-07-29'
  });
  const quotes = result.quotes || [];
  
  console.log(`Total rows from chart(): ${quotes.length}`);
  console.log(`\nRows with null values:`);
  for (const q of quotes) {
    if (q.close === null || q.open === null || q.high === null || q.low === null) {
      console.log(`  Date: ${q.date.toISOString().split('T')[0]}, open: ${q.open}, high: ${q.high}, low: ${q.low}, close: ${q.close}, volume: ${q.volume}`);
    }
  }

  // Count valid rows (rows we CAN insert)
  const validRows = quotes.filter((q: any) => q.close !== null && q.open !== null);
  console.log(`\nValid rows (non-null close & open): ${validRows.length}`);
  console.log(`Rows with nulls: ${quotes.length - validRows.length}`);
}

main();
