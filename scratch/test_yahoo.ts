import YahooFinance from 'yahoo-finance2';
const yahooFinance = new (YahooFinance as any)();

async function main() {
  try {
    const symbol = 'SUPERIRON.BO';
    console.log(`Fetching historical data for ${symbol}...`);
    const result = await yahooFinance.chart(symbol, {
      period1: '1990-01-01',
      period2: '2026-07-29'
    });
    console.log(`Success! Fetched ${result.quotes.length} rows.`);
    if (result.quotes.length > 0) {
      console.log('Sample quote:', result.quotes[0]);
    }
  } catch (error: any) {
    console.error(`Error name:`, error.name);
    console.error(`Error message:`, error.message);
    console.error(`Error keys:`, Object.keys(error));
    if (error.result) {
      console.log(`Error has partial result with ${error.result.length} rows.`);
    }
  }
}

main();
