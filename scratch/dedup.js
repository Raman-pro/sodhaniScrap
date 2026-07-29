const fs = require('fs');

const file = 'failed_fetches.log';
if (!fs.existsSync(file)) {
  console.log('No failed_fetches.log found.');
  process.exit(0);
}

const lines = fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean);
console.log(`Original lines: ${lines.length}`);

// Deduplicate based on everything after the timestamp.
// Example: "2026-07-29T05:55:16.599Z - 544381, Primary: 544381.BO..."
const seen = new Set();
const deduped = [];

for (const line of lines) {
  const parts = line.split(' - ');
  if (parts.length > 1) {
    const errorBody = parts.slice(1).join(' - ');
    if (!seen.has(errorBody)) {
      seen.add(errorBody);
      deduped.push(line);
    }
  } else {
    // If it doesn't match the format, just keep it if unique
    if (!seen.has(line)) {
      seen.add(line);
      deduped.push(line);
    }
  }
}

fs.writeFileSync(file, deduped.join('\n') + '\n');
console.log(`Deduplicated lines: ${deduped.length}`);
console.log(`Removed ${lines.length - deduped.length} duplicates.`);
