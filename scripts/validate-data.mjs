#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(root, relPath), 'utf8'));
}

const VALID_CATEGORIES = new Set(['burger', 'wrap', 'chicken', 'fries', 'drink', 'dessert', 'sauce']);
const SOURCE_KINDS = new Set(['nutrition-official']);
const FORBIDDEN_PUBLIC_PATTERNS = [
  /kody_ukryta/i,
  /pricelisto/i,
  /menumcdonald/i,
  /official-api/i,
  /web-ordering\s*api/i,
  /ssr\s*html/i,
  /ssr-namiejscu/i,
  /imageSource/,
  /zrzut ekranu podany/i,
];

const brands = readJson('src/data/brands.json');
const items = readJson('src/data/items.json');
const offers = readJson('src/data/offers.json');

const sourcesDir = path.join(root, 'src/data/sources');
const sourceMap = new Map();
const errors = [];

for (const file of fs.readdirSync(sourcesDir).sort()) {
  if (!file.endsWith('.json')) continue;
  const src = JSON.parse(fs.readFileSync(path.join(sourcesDir, file), 'utf8'));
  if (!src.id || !Array.isArray(src.items)) {
    errors.push(`Source file "${file}" is missing id or items array.`);
    continue;
  }
  if (src.itemCount !== src.items.length) {
    errors.push(`Source "${src.id}" has itemCount=${src.itemCount} but ${src.items.length} items.`);
  }
  if (src.kind && !SOURCE_KINDS.has(src.kind)) {
    errors.push(`Source "${src.id}" has disallowed kind "${src.kind}" (only official nutrition tables allowed).`);
  }
  sourceMap.set(src.id, {
    ...src,
    rowNames: new Set(src.items.map((r) => r.name)),
  });
}

// Public-data hygiene check across src/, index.html, README.md
for (const rel of ['README.md', 'index.html', 'src/App.tsx', 'src/components/CalorieCreator.tsx', 'src/data/items.json', 'src/data/offers.json', 'src/data/sources-summary.json', 'src/data/creator-catalog.json']) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) continue;
  const txt = fs.readFileSync(full, 'utf8');
  for (const pat of FORBIDDEN_PUBLIC_PATTERNS) {
    if (pat.test(txt)) {
      errors.push(`Public hygiene check failed in "${rel}": matched forbidden pattern ${pat}.`);
    }
  }
}

const brandIds = new Set(brands.map((b) => b.id));
if (brandIds.size !== brands.length) errors.push('Duplicate brand IDs found.');

for (const brand of brands) {
  if (!sourceMap.has(brand.nutritionSourceId)) {
    errors.push(`Brand "${brand.id}" references unknown nutritionSourceId "${brand.nutritionSourceId}".`);
  }
}

const itemMap = new Map(items.map((i) => [i.id, i]));
if (itemMap.size !== items.length) errors.push('Duplicate item IDs found.');

function checkLocalImage(label, imgPathValue) {
  if (!imgPathValue) return;
  if (imgPathValue.startsWith('http://') || imgPathValue.startsWith('https://')) return;
  if (!imgPathValue.startsWith('./')) {
    errors.push(`${label} image path must start with "./" for GitHub Pages compatibility: "${imgPathValue}"`);
    return;
  }
  const full = path.join(root, 'public', imgPathValue.slice(2));
  if (!fs.existsSync(full)) {
    errors.push(`${label} image missing on disk: ${full}`);
  }
}

for (const item of items) {
  if (!brandIds.has(item.brandId)) {
    errors.push(`Item "${item.id}" references unknown brandId "${item.brandId}".`);
  }
  if (!VALID_CATEGORIES.has(item.category)) {
    errors.push(`Item "${item.id}" has invalid category "${item.category}".`);
  }
  const src = sourceMap.get(item.source?.sourceId);
  if (!src) {
    errors.push(`Item "${item.id}" references unknown sourceId "${item.source?.sourceId}".`);
  } else if (item.source?.verified === 'official' && !src.rowNames.has(item.source.tableRowName)) {
    errors.push(
      `Item "${item.id}" is marked verified="official" but tableRowName "${item.source.tableRowName}" was not found in "${src.id}".`,
    );
  }
  for (const field of ['kcal', 'proteinG', 'fatG', 'carbsG']) {
    const val = item.nutrition?.[field];
    if (typeof val !== 'number' || Number.isNaN(val) || val < 0) {
      errors.push(`Item "${item.id}" has invalid nutrition.${field}.`);
    }
  }
  checkLocalImage(`Item "${item.id}"`, item.image);
}

const offerIds = new Set();
for (const offer of offers) {
  if (offerIds.has(offer.id)) errors.push(`Duplicate offer ID "${offer.id}".`);
  offerIds.add(offer.id);

  if (!brandIds.has(offer.brandId)) {
    errors.push(`Offer "${offer.id}" references unknown brandId "${offer.brandId}".`);
  }
  if (!['regular', 'coupon'].includes(offer.offerType)) {
    errors.push(`Offer "${offer.id}" has invalid offerType "${offer.offerType}".`);
  }
  if (!['regulamin', 'user', 'menu'].includes(offer.source?.priceVerifiedBy)) {
    errors.push(`Offer "${offer.id}" has invalid source.priceVerifiedBy "${offer.source?.priceVerifiedBy}".`);
  }
  if (typeof offer.pricePln !== 'number' || offer.pricePln <= 0) {
    errors.push(`Offer "${offer.id}" has invalid pricePln.`);
  }
  checkLocalImage(`Offer "${offer.id}"`, offer.image);

  if (!Array.isArray(offer.slots) || offer.slots.length === 0) {
    errors.push(`Offer "${offer.id}" must have at least one slot.`);
    continue;
  }

  let defaultKcal = 0;
  let defaultPrice = offer.pricePln;
  const seenSlotIds = new Set();

  for (const slot of offer.slots) {
    if (seenSlotIds.has(slot.id)) {
      errors.push(`Offer "${offer.id}" has duplicate slot id "${slot.id}".`);
    }
    seenSlotIds.add(slot.id);

    if (!Array.isArray(slot.options) || slot.options.length === 0) {
      errors.push(`Offer "${offer.id}" slot "${slot.id}" must have at least one option.`);
      continue;
    }

    const seenOptIds = new Set();
    let defaultFoundInOptions = false;
    for (const opt of slot.options) {
      if (seenOptIds.has(opt.itemId)) {
        errors.push(`Offer "${offer.id}" slot "${slot.id}" has duplicate option "${opt.itemId}".`);
      }
      seenOptIds.add(opt.itemId);
      if (opt.itemId === slot.defaultItemId) defaultFoundInOptions = true;

      const it = itemMap.get(opt.itemId);
      if (!it) {
        errors.push(`Offer "${offer.id}" slot "${slot.id}" option "${opt.itemId}" not in items.json.`);
      } else if (it.brandId !== offer.brandId) {
        errors.push(
          `Offer "${offer.id}" (${offer.brandId}) slot "${slot.id}" references item "${it.id}" of brand "${it.brandId}".`,
        );
      }
    }

    if (!defaultFoundInOptions) {
      errors.push(
        `Offer "${offer.id}" slot "${slot.id}" defaultItemId "${slot.defaultItemId}" is not in slot.options.`,
      );
    }

    const qty = slot.quantity ?? 1;
    const defItem = itemMap.get(slot.defaultItemId);
    if (defItem) {
      defaultKcal += defItem.nutrition.kcal * qty;
      const defOpt = slot.options.find((o) => o.itemId === slot.defaultItemId);
      defaultPrice += defOpt?.priceDeltaPln ?? 0;
    }
  }

  let bestRatioKcal = defaultKcal;
  let bestRatioPrice = defaultPrice;
  let bestRatio = defaultPrice > 0 ? defaultKcal / defaultPrice : 0;

  const combos = offer.slots.reduce((acc, s) => acc * Math.max(1, (s.options ?? []).length), 1);
  if (combos <= 2000) {
    const walk = (idx, kSum, pSum) => {
      if (idx === offer.slots.length) {
        const r = pSum > 0 ? kSum / pSum : 0;
        if (r > bestRatio) {
          bestRatio = r;
          bestRatioKcal = kSum;
          bestRatioPrice = pSum;
        }
        return;
      }
      const slot = offer.slots[idx];
      const qty = slot.quantity ?? 1;
      for (const opt of slot.options ?? []) {
        const it = itemMap.get(opt.itemId);
        if (!it) continue;
        walk(idx + 1, kSum + it.nutrition.kcal * qty, pSum + (opt.priceDeltaPln ?? 0));
      }
    };
    walk(0, 0, offer.pricePln);
  }

  console.log(
    `✓ ${offer.id.padEnd(26)} | ${offer.offerType.padEnd(7)} | ${offer.pricePln.toFixed(2).padStart(6)} zł | default ${(defaultKcal / defaultPrice).toFixed(1).padStart(5)} kcal/zł (${defaultKcal} kcal) | max ${bestRatio.toFixed(1).padStart(5)} kcal/zł (${bestRatioKcal} kcal @ ${bestRatioPrice.toFixed(2)} zł)`,
  );
}

if (errors.length > 0) {
  console.error('\nValidation errors:');
  for (const err of errors) console.error(' ✗', err);
  process.exit(1);
}

console.log(
  `\nValidation passed: ${brands.length} brands, ${items.length} modular items, ${offers.length} offers, ${sourceMap.size} saved official source tables.`,
);
