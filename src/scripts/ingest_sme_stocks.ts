import { pool } from '../db/pool';
import { calculateAndUpsertCompanyPriceExtremes } from '../services/priceExtremesService';

interface SMEData {
  symbol: string;
  series: string;
  name: string;
  bhav_10sep: {
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    prev_close: number;
  };
  yahoo_bars: Array<{
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
}

const SME_STOCKS: SMEData[] = [
  {
    "symbol": "ABH",
    "series": "ST",
    "name": "ABH HEALTHCARE LIMITED",
    "bhav_10sep": {
      "date": "2026-09-10",
      "open": 65.85,
      "high": 69.25,
      "low": 65.85,
      "close": 65.95,
      "volume": 714000,
      "prev_close": 69.3
    },
    "yahoo_bars": [
      {
        "date": "2026-09-11",
        "open": 62.7,
        "high": 62.7,
        "low": 62.7,
        "close": 62.7,
        "volume": 43200
      }
    ]
  },
  {
    "symbol": "ADISOFT",
    "series": "SM",
    "name": "ADISOFT TECHNOLOGIES LTD",
    "bhav_10sep": {
      "date": "2026-09-10",
      "open": 252.5,
      "high": 258.0,
      "low": 236.05,
      "close": 243.15,
      "volume": 139200,
      "prev_close": 245.6
    },
    "yahoo_bars": [
      {
        "date": "2026-09-11",
        "open": 242.9,
        "high": 251.4,
        "low": 230.0,
        "close": 235.95,
        "volume": 113600
      }
    ]
  },
  {
    "symbol": "AMBAAUTO",
    "series": "SM",
    "name": "AMBA AUTO SALES AND SER L",
    "bhav_10sep": {
      "date": "2026-09-10",
      "open": 106.0,
      "high": 106.75,
      "low": 103.1,
      "close": 104.0,
      "volume": 18000,
      "prev_close": 106.0
    },
    "yahoo_bars": [
      {
        "date": "2026-09-11",
        "open": 105.0,
        "high": 105.0,
        "low": 103.0,
        "close": 103.0,
        "volume": 5000
      }
    ]
  },
  {
    "symbol": "ANAWIL",
    "series": "SM",
    "name": "ANAWIL WIRE AND ENGIN LTD",
    "bhav_10sep": {
      "date": "2026-09-10",
      "open": 424.85,
      "high": 473.4,
      "low": 415.7,
      "close": 465.05,
      "volume": 565600,
      "prev_close": 415.25
    },
    "yahoo_bars": [
      {
        "date": "2026-09-11",
        "open": 461.0,
        "high": 470.8,
        "low": 445.0,
        "close": 462.3,
        "volume": 254000
      }
    ]
  },
  {
    "symbol": "ASHUTOSH",
    "series": "ST",
    "name": "ASHUTOSH Limited",
    "bhav_10sep": {
      "date": "2026-09-10",
      "open": 152.0,
      "high": 157.8,
      "low": 149.0,
      "close": 156.7,
      "volume": 345600,
      "prev_close": 151.3
    },
    "yahoo_bars": [
      {
        "date": "2026-09-11",
        "open": 154.6,
        "high": 164.5,
        "low": 153.35,
        "close": 164.5,
        "volume": 222000
      }
    ]
  },
  {
    "symbol": "AVIENCE",
    "series": "SM",
    "name": "AVIENCE BIOMEDICALS LTD",
    "bhav_10sep": {
      "date": "2026-09-10",
      "open": 352.95,
      "high": 360.0,
      "low": 342.25,
      "close": 346.8,
      "volume": 64800,
      "prev_close": 336.35
    },
    "yahoo_bars": [
      {
        "date": "2026-09-11",
        "open": 356.1,
        "high": 388.0,
        "low": 322.0,
        "close": 385.35,
        "volume": 100200
      }
    ]
  },
  {
    "symbol": "BMLL",
    "series": "SM",
    "name": "BIO MEDICA LABORATORIES L",
    "bhav_10sep": {
      "date": "2026-09-10",
      "open": 162.0,
      "high": 162.95,
      "low": 160.0,
      "close": 160.0,
      "volume": 10000,
      "prev_close": 160.45
    },
    "yahoo_bars": [
      {
        "date": "2026-09-11",
        "open": 158.0,
        "high": 158.0,
        "low": 157.0,
        "close": 158.0,
        "volume": 5000
      }
    ]
  },
  {
    "symbol": "CLAYCRAFT",
    "series": "SM",
    "name": "CLAY CRAFT INDIA LIMITED",
    "bhav_10sep": {
      "date": "2026-09-10",
      "open": 152.6,
      "high": 159.65,
      "low": 152.6,
      "close": 155.55,
      "volume": 46800,
      "prev_close": 150.85
    },
    "yahoo_bars": [
      {
        "date": "2026-09-11",
        "open": 154.0,
        "high": 157.55,
        "low": 151.2,
        "close": 155.4,
        "volume": 37200
      }
    ]
  },
  {
    "symbol": "CREDENT",
    "series": "SM",
    "name": "CREDENT CONNECT N CARE L",
    "bhav_10sep": {
      "date": "2026-09-10",
      "open": 359.0,
      "high": 373.95,
      "low": 351.05,
      "close": 362.35,
      "volume": 155400,
      "prev_close": 355.35
    },
    "yahoo_bars": [
      {
        "date": "2026-09-11",
        "open": 351.5,
        "high": 362.0,
        "low": 346.0,
        "close": 357.1,
        "volume": 84000
      }
    ]
  },
  {
    "symbol": "DHANSA",
    "series": "SM",
    "name": "DHANSA LABS LIMITED",
    "bhav_10sep": {
      "date": "2026-09-10",
      "open": 33.0,
      "high": 34.05,
      "low": 31.5,
      "close": 34.05,
      "volume": 60000,
      "prev_close": 32.45
    },
    "yahoo_bars": [
      {
        "date": "2026-09-11",
        "open": 35.45,
        "high": 35.75,
        "low": 35.45,
        "close": 35.75,
        "volume": 26000
      }
    ]
  },
  {
    "symbol": "FASCINATE",
    "series": "SM",
    "name": "FASCINATE TEXTILES LTD",
    "bhav_10sep": {
      "date": "2026-09-10",
      "open": 56.25,
      "high": 57.1,
      "low": 55.4,
      "close": 55.9,
      "volume": 212000,
      "prev_close": 54.4
    },
    "yahoo_bars": [
      {
        "date": "2026-09-11",
        "open": 55.3,
        "high": 55.3,
        "low": 53.15,
        "close": 53.15,
        "volume": 373600
      }
    ]
  },
  {
    "symbol": "GENXAI",
    "series": "SM",
    "name": "GENXAI ANALYTICS LIMITED",
    "bhav_10sep": {
      "date": "2026-09-10",
      "open": 83.5,
      "high": 84.65,
      "low": 82.0,
      "close": 82.6,
      "volume": 20400,
      "prev_close": 84.0
    },
    "yahoo_bars": [
      {
        "date": "2026-09-11",
        "open": 81.05,
        "high": 84.0,
        "low": 81.05,
        "close": 82.4,
        "volume": 14400
      }
    ]
  },
  {
    "symbol": "HAPPY",
    "series": "SM",
    "name": "HAPPY STEELS LIMITED",
    "bhav_10sep": {
      "date": "2026-09-10",
      "open": 83.4,
      "high": 91.8,
      "low": 82.0,
      "close": 90.0,
      "volume": 68000,
      "prev_close": 84.95
    },
    "yahoo_bars": [
      {
        "date": "2026-09-11",
        "open": 86.05,
        "high": 89.5,
        "low": 86.05,
        "close": 88.95,
        "volume": 14000
      }
    ]
  },
  {
    "symbol": "ICELCO",
    "series": "SM",
    "name": "IC ELECTRICALS COMPANY L",
    "bhav_10sep": {
      "date": "2026-09-10",
      "open": 125.0,
      "high": 127.0,
      "low": 121.6,
      "close": 126.1,
      "volume": 115200,
      "prev_close": 120.55
    },
    "yahoo_bars": [
      {
        "date": "2026-09-11",
        "open": 127.35,
        "high": 127.35,
        "low": 123.35,
        "close": 125.2,
        "volume": 25200
      }
    ]
  },
  {
    "symbol": "MADHURKNIT",
    "series": "ST",
    "name": "MADHUR KNIT CRAFTS LTD",
    "bhav_10sep": {
      "date": "2026-09-10",
      "open": 73.6,
      "high": 73.6,
      "low": 73.6,
      "close": 73.6,
      "volume": 4800,
      "prev_close": 77.45
    },
    "yahoo_bars": [
      {
        "date": "2026-09-10",
        "open": 73.6,
        "high": 73.6,
        "low": 73.6,
        "close": 73.6,
        "volume": 4800
      }
    ]
  },
  {
    "symbol": "METALIC",
    "series": "ST",
    "name": "METALIC TECHNOFORGE LTD",
    "bhav_10sep": {
      "date": "2026-09-10",
      "open": 137.95,
      "high": 142.85,
      "low": 137.2,
      "close": 140.0,
      "volume": 73600,
      "prev_close": 136.05
    },
    "yahoo_bars": [
      {
        "date": "2026-09-11",
        "open": 138.0,
        "high": 147.0,
        "low": 137.5,
        "close": 147.0,
        "volume": 128000
      }
    ]
  },
  {
    "symbol": "NFPSAMPOOR",
    "series": "SM",
    "name": "NFP SAMPOORNA FOODS LTD",
    "bhav_10sep": {
      "date": "2026-09-10",
      "open": 22.3,
      "high": 22.3,
      "low": 20.6,
      "close": 22.05,
      "volume": 24000,
      "prev_close": 21.3
    },
    "yahoo_bars": [
      {
        "date": "2026-09-11",
        "open": 21.05,
        "high": 21.1,
        "low": 21.0,
        "close": 21.0,
        "volume": 10000
      }
    ]
  },
  {
    "symbol": "OPTIMYSTIX",
    "series": "SM",
    "name": "OPTIMYSTIX ENT INDIA LTD",
    "bhav_10sep": {
      "date": "2026-09-10",
      "open": 145.05,
      "high": 150.0,
      "low": 144.0,
      "close": 148.8,
      "volume": 36800,
      "prev_close": 148.2
    },
    "yahoo_bars": [
      {
        "date": "2026-09-11",
        "open": 145.5,
        "high": 148.8,
        "low": 141.0,
        "close": 148.0,
        "volume": 72800
      }
    ]
  },
  {
    "symbol": "PRAMODINI",
    "series": "SM",
    "name": "PRAMODINI MEDICARE LTD",
    "bhav_10sep": {
      "date": "2026-09-10",
      "open": 130.1,
      "high": 135.9,
      "low": 125.1,
      "close": 127.2,
      "volume": 298800,
      "prev_close": 128.2
    },
    "yahoo_bars": [
      {
        "date": "2026-09-11",
        "open": 129.4,
        "high": 130.9,
        "low": 117.0,
        "close": 118.5,
        "volume": 445200
      }
    ]
  },
  {
    "symbol": "PROPSHOP",
    "series": "SM",
    "name": "PROPSHOP EVENTS AND EXH L",
    "bhav_10sep": {
      "date": "2026-09-10",
      "open": 75.0,
      "high": 75.0,
      "low": 71.55,
      "close": 74.8,
      "volume": 50000,
      "prev_close": 74.5
    },
    "yahoo_bars": [
      {
        "date": "2026-09-11",
        "open": 73.1,
        "high": 74.4,
        "low": 71.0,
        "close": 72.0,
        "volume": 44000
      }
    ]
  },
  {
    "symbol": "QLINE",
    "series": "SM",
    "name": "Q-LINE BIOTECH LIMITED",
    "bhav_10sep": {
      "date": "2026-09-10",
      "open": 687.95,
      "high": 720.0,
      "low": 675.0,
      "close": 714.95,
      "volume": 132000,
      "prev_close": 675.7
    },
    "yahoo_bars": [
      {
        "date": "2026-09-11",
        "open": 704.95,
        "high": 730.0,
        "low": 694.95,
        "close": 726.2,
        "volume": 66000
      }
    ]
  },
  {
    "symbol": "RFBL",
    "series": "ST",
    "name": "RFBL FLEXI PACK LIMITED",
    "bhav_10sep": {
      "date": "2026-09-10",
      "open": 86.85,
      "high": 90.95,
      "low": 86.8,
      "close": 90.15,
      "volume": 210000,
      "prev_close": 91.35
    },
    "yahoo_bars": [
      {
        "date": "2026-09-11",
        "open": 85.65,
        "high": 93.65,
        "low": 85.65,
        "close": 89.0,
        "volume": 549000
      }
    ]
  },
  {
    "symbol": "SHANTIINOR",
    "series": "ST",
    "name": "SHANTIINOR Limited",
    "bhav_10sep": {
      "date": "2026-09-10",
      "open": 176.15,
      "high": 176.15,
      "low": 173.0,
      "close": 176.15,
      "volume": 217600,
      "prev_close": 167.8
    },
    "yahoo_bars": [
      {
        "date": "2026-09-11",
        "open": 184.95,
        "high": 184.95,
        "low": 184.95,
        "close": 184.95,
        "volume": 27200
      }
    ]
  },
  {
    "symbol": "SHREEDHAR",
    "series": "ST",
    "name": "SHREEDHAR SPINNERS LTD",
    "bhav_10sep": {
      "date": "2026-09-10",
      "open": 129.35,
      "high": 129.35,
      "low": 129.35,
      "close": 129.35,
      "volume": 4000,
      "prev_close": 123.2
    },
    "yahoo_bars": [
      {
        "date": "2026-09-11",
        "open": 135.75,
        "high": 135.8,
        "low": 135.75,
        "close": 135.8,
        "volume": 10000
      }
    ]
  },
  {
    "symbol": "SIMCA",
    "series": "ST",
    "name": "SIMCA ADVERTISING LIMITED",
    "bhav_10sep": {
      "date": "2026-09-10",
      "open": 264.0,
      "high": 264.0,
      "low": 258.0,
      "close": 261.05,
      "volume": 18600,
      "prev_close": 262.0
    },
    "yahoo_bars": [
      {
        "date": "2026-09-11",
        "open": 261.05,
        "high": 263.0,
        "low": 257.0,
        "close": 261.8,
        "volume": 35400
      }
    ]
  },
  {
    "symbol": "SKYTECH",
    "series": "SM",
    "name": "SKYTECH INFINITE PLATFM L",
    "bhav_10sep": {
      "date": "2026-09-10",
      "open": 29.35,
      "high": 29.35,
      "low": 29.35,
      "close": 29.35,
      "volume": 9600,
      "prev_close": 30.85
    },
    "yahoo_bars": [
      {
        "date": "2026-09-11",
        "open": 27.9,
        "high": 27.9,
        "low": 27.9,
        "close": 27.9,
        "volume": 27200
      }
    ]
  },
  {
    "symbol": "SUMAX",
    "series": "ST",
    "name": "SUMAX ENGINEERING LIMITED",
    "bhav_10sep": {
      "date": "2026-09-10",
      "open": 120.45,
      "high": 120.45,
      "low": 120.45,
      "close": 120.45,
      "volume": 409200,
      "prev_close": 114.75
    },
    "yahoo_bars": [
      {
        "date": "2026-09-11",
        "open": 126.45,
        "high": 126.45,
        "low": 126.45,
        "close": 126.45,
        "volume": 129600
      }
    ]
  },
  {
    "symbol": "TEAMTECH",
    "series": "ST",
    "name": "TEAMTECH FORMWORK SOL LTD",
    "bhav_10sep": {
      "date": "2026-09-10",
      "open": 135.0,
      "high": 135.0,
      "low": 131.05,
      "close": 131.05,
      "volume": 78000,
      "prev_close": 137.9
    },
    "yahoo_bars": [
      {
        "date": "2026-09-11",
        "open": 131.05,
        "high": 132.5,
        "low": 125.9,
        "close": 129.05,
        "volume": 72000
      }
    ]
  },
  {
    "symbol": "TEJA",
    "series": "SM",
    "name": "TEJA ENGINEERING IND L",
    "bhav_10sep": {
      "date": "2026-09-10",
      "open": 236.0,
      "high": 243.45,
      "low": 235.0,
      "close": 236.05,
      "volume": 8400,
      "prev_close": 237.05
    },
    "yahoo_bars": [
      {
        "date": "2026-09-11",
        "open": 236.3,
        "high": 237.0,
        "low": 218.05,
        "close": 223.25,
        "volume": 42000
      }
    ]
  },
  {
    "symbol": "UTKAL",
    "series": "SM",
    "name": "UTKAL SPEC INDUS INDIA L",
    "bhav_10sep": {
      "date": "2026-09-10",
      "open": 46.0,
      "high": 46.1,
      "low": 45.8,
      "close": 46.0,
      "volume": 26000,
      "prev_close": 44.25
    },
    "yahoo_bars": [
      {
        "date": "2026-09-10",
        "open": 46.0,
        "high": 46.1,
        "low": 45.8,
        "close": 46.0,
        "volume": 26000
      }
    ]
  },
  {
    "symbol": "VALUE360",
    "series": "SM",
    "name": "VALUE 360 COMMUNICATION L",
    "bhav_10sep": {
      "date": "2026-09-10",
      "open": 70.95,
      "high": 70.95,
      "low": 70.95,
      "close": 70.95,
      "volume": 2400,
      "prev_close": 71.3
    },
    "yahoo_bars": [
      {
        "date": "2026-09-11",
        "open": 69.6,
        "high": 70.0,
        "low": 68.4,
        "close": 69.45,
        "volume": 13200
      }
    ]
  },
  {
    "symbol": "VMOBILE",
    "series": "SM",
    "name": "VINIT MOBILE LIMITED",
    "bhav_10sep": {
      "date": "2026-09-10",
      "open": 56.0,
      "high": 58.1,
      "low": 56.0,
      "close": 58.1,
      "volume": 12000,
      "prev_close": 55.35
    },
    "yahoo_bars": [
      {
        "date": "2026-09-11",
        "open": 58.15,
        "high": 60.5,
        "low": 57.5,
        "close": 59.05,
        "volume": 14400
      }
    ]
  }
];

export async function ingestSmeStocks() {
  console.log(`Starting ingestion of ${SME_STOCKS.length} NSE SME stocks...`);
  const client = await pool.connect();

  try {
    let companyCount = 0;
    let priceCount = 0;
    let extremesCount = 0;

    for (const item of SME_STOCKS) {
      const sym = item.symbol;
      const latestBar = item.yahoo_bars.length > 0 ? item.yahoo_bars[item.yahoo_bars.length - 1] : null;
      const lastPric = latestBar ? latestBar.close : item.bhav_10sep.close;
      const tradDt = latestBar ? latestBar.date : item.bhav_10sep.date;

      // 1. Upsert company_stock
      await client.query(`
        INSERT INTO company_stock (
          "FinInstrmId", "TckrSymb", "FinInstrmNm", "Src", "Sgmt", "FinInstrmTp", "SctySrs", "LastPric", "TradDt", "BizDt"
        ) VALUES ($1, $2, $3, 'NSE', 'SM', 'STK', $4, $5, $6, $7)
        ON CONFLICT ("FinInstrmId") DO UPDATE SET
          "TckrSymb" = EXCLUDED."TckrSymb",
          "FinInstrmNm" = COALESCE(EXCLUDED."FinInstrmNm", company_stock."FinInstrmNm"),
          "Src" = EXCLUDED."Src",
          "Sgmt" = EXCLUDED."Sgmt",
          "FinInstrmTp" = EXCLUDED."FinInstrmTp",
          "SctySrs" = EXCLUDED."SctySrs",
          "LastPric" = EXCLUDED."LastPric",
          "TradDt" = EXCLUDED."TradDt",
          "BizDt" = EXCLUDED."BizDt"
      `, [sym, sym, item.name, item.series, lastPric, tradDt, '2026-09-10']);
      companyCount++;

      // 2. Insert 10-Sep Bhavcopy EOD bar
      const b = item.bhav_10sep;
      await client.query(`
        INSERT INTO historical_prices (
          "FinInstrmId", record_date, open_price, high_price, low_price, close_price, adj_close, volume, prev_close
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT ("FinInstrmId", record_date) DO UPDATE SET
          open_price = EXCLUDED.open_price,
          high_price = EXCLUDED.high_price,
          low_price = EXCLUDED.low_price,
          close_price = EXCLUDED.close_price,
          adj_close = EXCLUDED.adj_close,
          volume = EXCLUDED.volume,
          prev_close = EXCLUDED.prev_close
      `, [sym, `${b.date} 00:00:00`, b.open, b.high, b.low, b.close, b.close, b.volume, b.prev_close]);
      priceCount++;

      // 3. Insert Yahoo Finance bars (e.g. 11-Sep bar)
      for (const y of item.yahoo_bars) {
        if (y.date !== b.date) {
          await client.query(`
            INSERT INTO historical_prices (
              "FinInstrmId", record_date, open_price, high_price, low_price, close_price, adj_close, volume, prev_close
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT ("FinInstrmId", record_date) DO UPDATE SET
              open_price = EXCLUDED.open_price,
              high_price = EXCLUDED.high_price,
              low_price = EXCLUDED.low_price,
              close_price = EXCLUDED.close_price,
              adj_close = EXCLUDED.adj_close,
              volume = EXCLUDED.volume,
              prev_close = COALESCE(EXCLUDED.prev_close, historical_prices.prev_close)
          `, [sym, `${y.date} 00:00:00`, y.open, y.high, y.low, y.close, y.close, y.volume, b.close]);
          priceCount++;
        }
      }

      // 4. Calculate and upsert price extremes
      await calculateAndUpsertCompanyPriceExtremes(client, sym);
      extremesCount++;
    }

    console.log(`Ingestion complete!`);
    console.log(`- Upserted ${companyCount} stocks into company_stock`);
    console.log(`- Upserted ${priceCount} bars into historical_prices`);
    console.log(`- Refreshed price extremes for ${extremesCount} companies.`);
  } finally {
    client.release();
  }
}

if (require.main === module) {
  ingestSmeStocks()
    .then(() => {
      console.log('Script execution finished successfully.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Ingestion failed:', err);
      process.exit(1);
    });
}
