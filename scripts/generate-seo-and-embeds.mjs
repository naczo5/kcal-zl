#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(root, relPath), 'utf8'));
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function escapeHtmlAttr(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtNum(val, digits = 1) {
  return val.toFixed(digits).replace('.', ',');
}

const brands = readJson('src/data/brands.json');
const items = readJson('src/data/items.json');
const offers = readJson('src/data/offers.json');

// Write lightweight sources-summary.json and creator-catalog.json so the browser bundle
// gets clean official nutrition entries without raw PDF/URL metadata
const sourcesDir = path.join(root, 'src', 'data', 'sources');
const sourceFiles = fs
  .readdirSync(sourcesDir)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => JSON.parse(fs.readFileSync(path.join(sourcesDir, f), 'utf8')));

const sourcesSummary = sourceFiles.map((src) => ({
  id: src.id,
  brandId: src.brandId,
  kind: src.kind ?? 'nutrition-official',
  title: src.title,
  sourceUrl: src.sourceUrl,
  secondarySourceUrl: src.secondarySourceUrl,
  fetchedAt: src.fetchedAt,
  itemCount: src.itemCount,
}));
fs.writeFileSync(
  path.join(root, 'src', 'data', 'sources-summary.json'),
  `${JSON.stringify(sourcesSummary, null, 2)}\n`,
  'utf8',
);

const numOrUndef = (v) => (typeof v === 'number' && !Number.isNaN(v) ? v : undefined);

function parseSlashNum(val, idx = 1) {
  if (typeof val === 'number') return val;
  if (typeof val === 'string' && val.includes('/')) {
    const parts = val.split('/').map((s) => Number(s.trim().replace(',', '.'))).filter((n) => !Number.isNaN(n));
    return parts[idx] ?? parts[0];
  }
  return undefined;
}

const creatorCatalog = [];
const coveredRowKeys = new Set();

for (const it of items) {
  creatorCatalog.push({
    id: it.id,
    brandId: it.brandId,
    name: it.name,
    portionLabel: it.portionLabel,
    categoryLabel: it.category,
    image: it.image,
    nutrition: it.nutrition,
  });
  if (it.source?.sourceId && it.source?.tableRowName) {
    coveredRowKeys.add(`${it.source.sourceId}|${it.source.tableRowName}|${Math.round(it.nutrition.kcal)}`);
  }
}

const usedCreatorIds = new Set(creatorCatalog.map((c) => c.id));
const slugify = (s) =>
  String(s)
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 52) || 'item';

// Count name occurrences per brand to disambiguate duplicate names (e.g. KFC sizes / variants)
for (const src of sourceFiles) {
  const nameCounts = new Map();
  for (const row of src.items ?? []) {
    nameCounts.set(row.name, (nameCounts.get(row.name) ?? 0) + 1);
  }
  for (const row of src.items ?? []) {
    const kcal = parseSlashNum(row.kcal);
    if (typeof kcal !== 'number' || Number.isNaN(kcal)) continue;
    const rowKey = `${src.id}|${row.name}|${Math.round(kcal)}`;
    if (coveredRowKeys.has(rowKey)) continue;
    coveredRowKeys.add(rowKey);

    let displayName = row.name;
    let searchAlias;
    if (displayName.includes('/')) {
      const [pl, en] = displayName.split('/').map((s) => s.trim());
      if (pl && en && !/^\d/.test(en) && !pl.toLowerCase().includes('woda')) {
        displayName = pl;
        searchAlias = en;
      }
    }

    const portionNum = numOrUndef(row.portionG) ?? numOrUndef(row.portionSize);
    const portionLabel = portionNum ? `${portionNum} g` : undefined;
    const catLabel = String(row.category ?? '').split('/')[0].trim();
    if ((nameCounts.get(row.name) ?? 0) > 1) {
      const suffix = portionLabel ?? catLabel;
      if (suffix) displayName = `${displayName} (${suffix})`;
    }

    const baseId = `cat-${src.brandId}-${slugify(displayName)}`;
    let id = baseId;
    let n = 2;
    while (usedCreatorIds.has(id)) {
      id = `${baseId}-${n++}`;
    }
    usedCreatorIds.add(id);

    const kj = parseSlashNum(row.kj);
    const nutrition = {
      kcal: Math.round(kcal),
      ...(kj !== undefined ? { kj: Math.round(kj) } : {}),
      proteinG: numOrUndef(row.proteinG) ?? 0,
      fatG: numOrUndef(row.fatG) ?? 0,
      ...(numOrUndef(row.satFatG) !== undefined ? { satFatG: row.satFatG } : {}),
      carbsG: numOrUndef(row.carbsG) ?? 0,
      ...(numOrUndef(row.sugarsG) !== undefined ? { sugarsG: row.sugarsG } : {}),
      ...(numOrUndef(row.saltG) !== undefined ? { saltG: row.saltG } : {}),
    };

    creatorCatalog.push({
      id,
      brandId: src.brandId,
      name: displayName,
      ...(portionLabel ? { portionLabel } : {}),
      categoryLabel: catLabel || 'menu',
      ...(searchAlias ? { searchAlias } : {}),
      nutrition,
    });
  }
}

fs.writeFileSync(
  path.join(root, 'src', 'data', 'creator-catalog.json'),
  `${JSON.stringify(creatorCatalog)}\n`,
  'utf8',
);

const brandMap = new Map(brands.map((b) => [b.id, b]));
const itemMap = new Map(items.map((i) => [i.id, i]));

const ranked = offers
  .map((offer) => {
    const brand = brandMap.get(offer.brandId);
    let bestKcal = 0;
    let bestPrice = offer.pricePln;
    let bestRatio = 0;

    const combos = offer.slots.reduce((acc, s) => acc * Math.max(1, s.options.length), 1);
    if (combos <= 2000) {
      const walk = (idx, kSum, pSum) => {
        if (idx === offer.slots.length) {
          const r = pSum > 0 ? kSum / pSum : 0;
          if (r > bestRatio) {
            bestRatio = r;
            bestKcal = kSum;
            bestPrice = pSum;
          }
          return;
        }
        const slot = offer.slots[idx];
        const qty = slot.quantity ?? 1;
        for (const opt of slot.options) {
          const it = itemMap.get(opt.itemId);
          if (!it) continue;
          walk(idx + 1, kSum + it.nutrition.kcal * qty, pSum + (opt.priceDeltaPln ?? 0));
        }
      };
      walk(0, 0, offer.pricePln);
    }

    return {
      offer,
      brand,
      kcal: Math.round(bestKcal),
      pricePln: Number(bestPrice.toFixed(2)),
      ratio: bestRatio,
    };
  })
  .sort((a, b) => b.ratio - a.ratio);

const leader = ranked[0];
const embedsDir = path.join(root, 'public', 'embeds');
fs.mkdirSync(embedsDir, { recursive: true });

// 1. GitHub-ready SVG badge (leader-badge.svg)
if (leader) {
  const leftText = 'lider kcal/zł';
  const rightText = `${leader.brand?.shortName ?? leader.offer.brandId} ${leader.offer.name} • ${fmtNum(leader.ratio, 1)} kcal/zł`;
  const leftW = Math.round(leftText.length * 7.2 + 22);
  const rightW = Math.round(rightText.length * 6.8 + 24);
  const totalW = leftW + rightW;

  const badgeSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="28" role="img" aria-label="${escapeXml(leftText)}: ${escapeXml(rightText)}">
  <title>${escapeXml(leftText)}: ${escapeXml(rightText)}</title>
  <rect width="${totalW}" height="28" rx="4" fill="#111318"/>
  <rect x="${leftW}" width="${rightW}" height="28" rx="4" fill="#D62828"/>
  <rect x="${leftW}" width="6" height="28" fill="#D62828"/>
  <g fill="#ffffff" font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" font-size="12" font-weight="700" text-anchor="middle">
    <text x="${leftW / 2}" y="18">${escapeXml(leftText)}</text>
    <text x="${leftW + rightW / 2}" y="18">${escapeXml(rightText)}</text>
  </g>
</svg>
`;
  fs.writeFileSync(path.join(embedsDir, 'leader-badge.svg'), badgeSvg, 'utf8');
}

// 2. GitHub-ready SVG leaderboard card (top-offers.svg)
const topRows = ranked.slice(0, 5);
const cardW = 680;
const rowH = 52;
const headerH = 58;
const footerH = 34;
const cardH = headerH + topRows.length * rowH + footerH;
const maxRatio = leader?.ratio || 1;

const rowsSvg = topRows
  .map((entry, idx) => {
    const y = headerH + idx * rowH;
    const isFirst = idx === 0;
    const barMaxW = 86;
    const barW = Math.max(12, Math.round((entry.ratio / maxRatio) * barMaxW));
    const typeLabel = entry.offer.offerType === 'coupon' ? 'Kupon' : 'Stała oferta';
    const typeBg = entry.offer.offerType === 'coupon' ? '#EEFAF8' : '#EEF0F4';
    const typeColor = entry.offer.offerType === 'coupon' ? '#0F766E' : '#344054';

    return `
  <g transform="translate(0, ${y})">
    <line x1="0" y1="${rowH}" x2="${cardW}" y2="${rowH}" stroke="#E5E7EB" stroke-width="1"/>
    <text x="20" y="31" font-family="ui-monospace, monospace" font-size="13" font-weight="700" fill="${isFirst ? '#D62828' : '#5A6170'}">#${idx + 1}</text>
    <circle cx="56" cy="26" r="4.5" fill="${escapeXml(entry.brand?.accentColor ?? '#374151')}"/>
    <text x="69" y="24" font-family="system-ui, -apple-system, sans-serif" font-size="14" font-weight="700" fill="#111318">${escapeXml(entry.offer.name)}</text>
    <text x="69" y="40" font-family="system-ui, -apple-system, sans-serif" font-size="11" fill="#5A6170">${escapeXml(entry.brand?.shortName ?? entry.offer.brandId)} • ${entry.kcal} kcal • ${fmtNum(entry.pricePln, 2)} zł</text>
    <rect x="350" y="16" width="82" height="20" rx="4" fill="${typeBg}"/>
    <text x="391" y="30" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="11" font-weight="600" fill="${typeColor}">${typeLabel}</text>
    <rect x="448" y="24" width="${barMaxW}" height="5" rx="2.5" fill="#ECEEF2"/>
    <rect x="448" y="24" width="${barW}" height="5" rx="2.5" fill="${isFirst ? '#D62828' : '#111318'}"/>
    <text x="660" y="31" text-anchor="end" font-family="ui-monospace, monospace" font-size="14" font-weight="700" fill="${isFirst ? '#D62828' : '#111318'}">${fmtNum(entry.ratio, 1)} kcal/zł</text>
  </g>`;
  })
  .join('');

const cardSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cardW}" height="${cardH}" viewBox="0 0 ${cardW} ${cardH}" role="img" aria-label="Ranking ofert fast food kcal/zł">
  <rect x="1" y="1" width="${cardW - 2}" height="${cardH - 2}" rx="10" fill="#FFFFFF" stroke="#111318" stroke-width="2"/>
  <path d="M1 11C1 5.477 5.477 1 11 1H${cardW - 11}C${cardW - 5.477} 1 ${cardW - 1} 5.477 ${cardW - 1} 11V${headerH}H1V11Z" fill="#111318"/>
  <circle cx="24" cy="29" r="5" fill="#D62828"/>
  <text x="38" y="34" font-family="system-ui, -apple-system, sans-serif" font-size="15" font-weight="700" fill="#FFFFFF">kcal/zł — Top ${topRows.length} ofert fast food (maks. konfiguracja)</text>
  <text x="660" y="34" text-anchor="end" font-family="ui-monospace, monospace" font-size="12" fill="#CBD5E1">${ranked.length} ofert w bazie</text>
  ${rowsSvg}
  <text x="20" y="${headerH + topRows.length * rowH + 22}" font-family="system-ui, -apple-system, sans-serif" font-size="11" fill="#5A6170">Dane z oficjalnych tabel wartości odżywczych McDonald's PL, Popeyes PL i KFC PL</text>
  <text x="660" y="${headerH + topRows.length * rowH + 22}" text-anchor="end" font-family="ui-monospace, monospace" font-size="11" fill="#5A6170">kcal-zl</text>
</svg>
`;
fs.writeFileSync(path.join(embedsDir, 'top-offers.svg'), cardSvg, 'utf8');

// 3. Inject fresh JSON-LD into index.html
const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebApplication',
      name: 'kcal/zł — Indeks opłacalności ofert fast food w Polsce',
      description:
        'Porównanie zestawów, ofert stałych i kuponów fast food w Polsce sortowane według przelicznika kcal na złotówkę na bazie oficjalnych tabel wartości odżywczych.',
      applicationCategory: 'UtilityApplication',
      operatingSystem: 'Web',
      inLanguage: 'pl-PL',
    },
    {
      '@type': 'ItemList',
      name: 'Ranking ofert fast food według kcal/zł',
      numberOfItems: ranked.length,
      itemListElement: ranked.map((entry, idx) => ({
        '@type': 'ListItem',
        position: idx + 1,
        name: `${entry.brand?.shortName ?? entry.offer.brandId} ${entry.offer.name} — ${fmtNum(entry.ratio, 1)} kcal/zł (${entry.kcal} kcal / ${fmtNum(entry.pricePln, 2)} zł)`,
      })),
    },
  ],
};

const indexPath = path.join(root, 'index.html');
let indexHtml = fs.readFileSync(indexPath, 'utf8');

// Resolve absolute site URL for OpenGraph/Twitter crawlers (GitHub Actions sets GITHUB_REPOSITORY)
let siteUrl = process.env.SITE_URL || '';
if (!siteUrl && process.env.GITHUB_REPOSITORY) {
  const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/');
  if (owner && repo) {
    siteUrl = repo.toLowerCase() === `${owner.toLowerCase()}.github.io`
      ? `https://${owner}.github.io/`
      : `https://${owner}.github.io/${repo}/`;
  }
}
if (siteUrl && !siteUrl.endsWith('/')) siteUrl += '/';

const ogImageUrl = siteUrl ? `${siteUrl}images/og-cover.png` : './images/og-cover.png';
const leaderSummary = leader
  ? `Obecny lider: ${leader.brand?.shortName ?? leader.offer.brandId} ${leader.offer.name} (${fmtNum(leader.ratio, 1)} kcal/zł). `
  : '';
const ogDesc = `${leaderSummary}Porównanie ${ranked.length} zestawów i kuponów fast food w Polsce na podstawie oficjalnych tabel wartości odżywczych.`;

const metaStart = '<!-- META:START -->';
const metaEnd = '<!-- META:END -->';
const metaBlock = `${metaStart}
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="pl_PL" />
    <meta property="og:site_name" content="kcal/zł" />
    ${siteUrl ? `<meta property="og:url" content="${escapeHtmlAttr(siteUrl)}" />\n    <link rel="canonical" href="${escapeHtmlAttr(siteUrl)}" />` : ''}
    <meta property="og:title" content="kcal/zł — Najwięcej kalorii za każdą złotówkę" />
    <meta property="og:description" content="${escapeHtmlAttr(ogDesc)}" />
    <meta property="og:image" content="${escapeHtmlAttr(ogImageUrl)}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="kcal/zł — Indeks opłacalności ofert fast food w Polsce" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="kcal/zł — Najwięcej kalorii za każdą złotówkę" />
    <meta name="twitter:description" content="${escapeHtmlAttr(ogDesc)}" />
    <meta name="twitter:image" content="${escapeHtmlAttr(ogImageUrl)}" />
    ${metaEnd}`;

if (indexHtml.includes(metaStart) && indexHtml.includes(metaEnd)) {
  indexHtml = indexHtml.replace(new RegExp(`${metaStart}[\\s\\S]*?${metaEnd}`), metaBlock);
}

const startMarker = '<!-- JSONLD:START -->';
const endMarker = '<!-- JSONLD:END -->';
const jsonLdBlock = `${startMarker}\n    <script type="application/ld+json">\n${JSON.stringify(jsonLd, null, 2)
  .split('\n')
  .map((l) => `      ${l}`)
  .join('\n')}\n    </script>\n    ${endMarker}`;

if (indexHtml.includes(startMarker) && indexHtml.includes(endMarker)) {
  indexHtml = indexHtml.replace(
    new RegExp(`${startMarker}[\\s\\S]*?${endMarker}`),
    jsonLdBlock,
  );
}
fs.writeFileSync(indexPath, indexHtml, 'utf8');

if (siteUrl) {
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url>\n    <loc>${escapeXml(siteUrl)}</loc>\n    <changefreq>weekly</changefreq>\n    <priority>1.0</priority>\n  </url>\n</urlset>\n`;
  fs.writeFileSync(path.join(root, 'public', 'sitemap.xml'), sitemap, 'utf8');
}

console.log(`Generated SEO JSON-LD & GitHub embeds in public/embeds/ (leader: ${leader?.offer.name} @ ${fmtNum(leader?.ratio ?? 0, 1)} kcal/zł)`);
