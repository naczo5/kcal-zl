#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function normalize(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

const rawQuery = process.argv.slice(2).join(' ').trim();
const query = normalize(rawQuery);
if (!query) {
  console.error('Usage: node scripts/find-nutrition.mjs <search-term>');
  process.exit(1);
}

const items = JSON.parse(fs.readFileSync(path.join(root, 'src/data/items.json'), 'utf8'));
console.log('=== Existing modular items (src/data/items.json) ===');
let matchedItems = 0;
for (const item of items) {
  if (normalize(`${item.id} ${item.name} ${item.brandId}`).includes(query)) {
    matchedItems++;
    const n = item.nutrition;
    console.log(
      `  [${item.id}] ${item.brandId} | ${item.name} (${item.portionLabel}) -> ${n.kcal} kcal, ${n.kj ?? '?'} kJ | P:${n.proteinG}g F:${n.fatG}g C:${n.carbsG}g Sugars:${n.sugarsG ?? '?'}g Salt:${n.saltG ?? '?'}g | ${item.source?.verified} | ${item.image}`
    );
  }
}
if (matchedItems === 0) console.log('  (none)');

const sourcesDir = path.join(root, 'src/data/sources');
console.log('\n=== Saved official source tables (src/data/sources/*.json) ===');
let matchedRows = 0;
for (const file of fs.readdirSync(sourcesDir).sort()) {
  if (!file.endsWith('.json')) continue;
  const src = JSON.parse(fs.readFileSync(path.join(sourcesDir, file), 'utf8'));
  for (const row of src.items ?? []) {
    if (normalize(`${row.name} ${row.category ?? ''}`).includes(query)) {
      matchedRows++;
      const sizeStr = row.portionSize ? ` (${row.portionSize})` : '';
      const flags = typeof row.kcal !== 'number' ? ' [NON-NUMERIC]' : '';
      console.log(
        `  [${src.id}] ${row.name}${sizeStr} -> ${row.kcal} kcal, ${row.kj ?? '?'} kJ | P:${row.proteinG ?? '?'}g F:${row.fatG ?? '?'}g C:${row.carbsG ?? '?'}g Sugars:${row.sugarsG ?? '?'}g Salt:${row.saltG ?? '?'}g${flags}`
      );
    }
  }
}
if (matchedRows === 0) console.log('  (none)');
