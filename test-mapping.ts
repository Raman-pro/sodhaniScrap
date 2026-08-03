import fs from 'fs';
import path from 'path';

const outputConsolidated = path.resolve(process.cwd(), 'output_consolidated');
const outputDir = path.resolve(process.cwd(), 'output');

console.log('outputDir exists?', fs.existsSync(outputDir));
console.log('outputConsolidated exists?', fs.existsSync(outputConsolidated));

const filesDir = fs.existsSync(outputDir) ? fs.readdirSync(outputDir) : [];
const filesCons = fs.existsSync(outputConsolidated) ? fs.readdirSync(outputConsolidated) : [];

console.log('JSON files in outputDir:', filesDir.length);
console.log('JSON files in outputConsolidated:', filesCons.length);

const mappingsPath = path.resolve(process.cwd(), '../sodhani-api/exchange_code_mappings.json');
console.log('mappingsPath:', mappingsPath, 'exists?', fs.existsSync(mappingsPath));

if (fs.existsSync(mappingsPath)) {
  const bseToNse = JSON.parse(fs.readFileSync(mappingsPath, 'utf8'))?.bse_to_nse || {};
  console.log('Loaded mappings. Keys:', Object.keys(bseToNse).length);
  console.log('Mapping for 500325:', bseToNse['500325']);
}
