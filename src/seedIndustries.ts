import fs from 'fs';
import path from 'path';
import csv from 'csv-parser';
import { pool } from './db/pool';

async function seedIndustries() {
  const csvPath = path.resolve(__dirname, '../../sodhani-api/companies_rebuilt.csv');
  
  if (!fs.existsSync(csvPath)) {
    console.error(`CSV not found at ${csvPath}`);
    process.exit(1);
  }

  const client = await pool.connect();
  
  try {
    console.log('Creating company_sectors table...');
    await client.query('DROP TABLE IF EXISTS company_sectors;');
    await client.query(`
      CREATE TABLE company_sectors (
        fin_instrm_id VARCHAR(50) PRIMARY KEY,
        company_name VARCHAR(255),
        sector_name VARCHAR(255),
        industry_name VARCHAR(255),
        leaf_name VARCHAR(255),
        sector_code VARCHAR(50),
        industry_code VARCHAR(50),
        leaf_code VARCHAR(50)
      )
    `);

    console.log('Reading CSV and inserting rows...');
    let count = 0;
    
    const results: any[] = [];
    await new Promise((resolve, reject) => {
      fs.createReadStream(csvPath)
        .pipe(csv())
        .on('data', (data) => results.push(data))
        .on('end', resolve)
        .on('error', reject);
    });

    for (const data of results) {
      const fin_instrm_id = data['Company Code'];
      const company_name = data['Name'];
      const sector_name = data['sector_name'];
      const industry_name = data['industry_name'];
      const leaf_name = data['leaf_name'];
      const sector_code = data['sector_code'];
      const industry_code = data['industry_code'];
      const leaf_code = data['leaf_code'];

      if (fin_instrm_id) {
        try {
          await client.query(`
            INSERT INTO company_sectors (
              fin_instrm_id, company_name, sector_name, industry_name, leaf_name, 
              sector_code, industry_code, leaf_code
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          `, [fin_instrm_id, company_name, sector_name, industry_name, leaf_name, sector_code, industry_code, leaf_code]);
          count++;
          if (count % 500 === 0) {
            console.log(`Inserted ${count} rows...`);
          }
        } catch (err) {
          console.error(`Error inserting row for ${fin_instrm_id}:`, err);
        }
      }
    }

    console.log(`Finished seeding! Total rows inserted/updated: ${count}`);
    
  } catch (err) {
    console.error('Fatal error during seed:', err);
  } finally {
    client.release();
    pool.end();
  }
}

seedIndustries();
