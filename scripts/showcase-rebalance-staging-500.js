#!/usr/bin/env node
/**
 * @komerce-arch
 * @role staging-showcase-category-rebalancer
 * @domain catalog
 * @layer script
 * @criticality low
 * @inputs curated 500-product fixture, targeted Wikimedia Commons candidates
 * @outputs same-size fixture with minimum category coverage
 * @db-read none
 * @db-write none
 * @doctrine staging fixture only; preserves curated nucleus and total product count
 */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  assertCuratedSource,
  stableInt,
  roundKmf,
  localizeTitle,
} = require('./showcase-catalog');
const { CATEGORY_ORDER, curateCandidate, summarize } = require('./showcase-curate-staging-500');
const { fetchCommonsQuery } = require('./showcase-curate-staging-500-hybrid');

const INPUT = path.resolve(__dirname, '../data/catalogue-test-raw/showcase-curated-staging-500.json');
const FLOOR = 24;
const NUCLEUS = 40;
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const COMMONS_USER_AGENT = 'KomerceShowcaseBuilder/3.6 (https://komerce.co)';
const SPORT_TITLE_BLOCKLIST = /\b(logo|flag|map|diagram|schema|icon|symbol|coat of arms|screenshot|poster|advert|manual|patent|drawing|team|club|player|players|coach|tournament|cup|match|stadium|portrait|festival|ceremony|museum|store|shop|building|street|ticket|event|people|person)\b/i;
const SPORT_CATEGORY_FALLBACKS = Object.freeze([
  ['Sports gear with transparent background', 'Fitness'],
  ['Sports equipment with white background', 'Fitness'],
  ['Association football equipment', 'Sports collectifs'],
  ['Tennis equipment', 'Fitness'],
  ['Exercise equipment', 'Fitness'],
]);

const QUERIES = Object.freeze({
  Enfant: [
    ['toy product photograph', 'Jouets', /\b(toy|doll|blocks|puzzle|plush|teddy|rattle|game)\b/i],
    ['toy car product photograph', 'Jouets', /\b(toy|car|vehicle|truck|train)\b/i],
    ['doll toy product photograph', 'Jouets', /\b(doll|toy|figure)\b/i],
    ['building blocks toy photograph', 'Jouets', /\b(blocks|building|lego|brick|toy)\b/i],
    ['plush toy product photograph', 'Jouets', /\b(plush|teddy|stuffed|toy)\b/i],
  ],
  Sport: [
    ['sports ball product photograph', 'Sports collectifs', /\b(ball|football|basketball|volleyball|handball)\b/i],
    ['dumbbell fitness product photograph', 'Fitness', /\b(dumbbell|weight|barbell|kettlebell|fitness)\b/i],
    ['yoga mat product photograph', 'Fitness', /\b(yoga|mat|fitness|exercise)\b/i],
    ['sports racket product photograph', 'Fitness', /\b(racket|racquet|tennis|badminton|padel)\b/i],
  ],
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&[^;]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function reusableLicense(value) {
  const license = String(value || '').toLowerCase().replace(/[_\s]+/g, '-');
  if (!license || license.includes('noncommercial') || license.includes('-nc') || license.includes('-nd')) return false;
  return license.includes('public-domain') || license.includes('publicdomain') || license.includes('cc0') || license.includes('cc-by');
}

function sportCategoryPage(page, categoryName, subcategory) {
  const info = page?.imageinfo?.[0];
  const meta = info?.extmetadata || {};
  const title = String(page?.title || '');
  const license = stripHtml(meta.LicenseShortName?.value || meta.UsageTerms?.value);
  const width = Number(info?.width || 0);
  const height = Number(info?.height || 0);
  const url = String(info?.url || info?.thumburl || '').trim();
  if (!url.startsWith('https://') || !['image/jpeg', 'image/png', 'image/webp'].includes(String(info?.mime || '').toLowerCase())) return null;
  if (!reusableLicense(license) || SPORT_TITLE_BLOCKLIST.test(title)) return null;
  if (width && height) {
    if (Math.min(width, height) < 500) return null;
    const ratio = width / height;
    if (ratio < 0.5 || ratio > 2.1) return null;
  }
  const name = localizeTitle(title);
  return {
    name,
    description: stripHtml(meta.ImageDescription?.value) || `${name}. Équipement sport sélectionné pour les parcours catalogue, panier et commande Komerce.`,
    category: 'Sport',
    subcategory,
    price_kmf: roundKmf(stableInt(`sport-category:${page.pageid}:price`, 2500, 65000)),
    promo_pct: null,
    image_url: url,
    images: [url],
    source: `commons:${page.pageid}`,
    source_url: info.descriptionurl || `https://commons.wikimedia.org/?curid=${page.pageid}`,
    source_attribution: {
      commons_category: categoryName,
      license,
      artist: stripHtml(meta.Artist?.value || 'Contributeur Wikimedia Commons'),
    },
  };
}

async function fetchSportCategory(categoryName, subcategory, limit = 50, fetchFn = fetch) {
  const params = new URLSearchParams({
    action: 'query',
    generator: 'categorymembers',
    gcmtitle: `Category:${categoryName}`,
    gcmtype: 'file',
    gcmlimit: String(limit),
    prop: 'imageinfo',
    iiprop: 'url|mime|size|extmetadata',
    iiextmetadatafilter: 'LicenseShortName|UsageTerms|Artist|ImageDescription',
    maxlag: '5',
    format: 'json',
    formatversion: '2',
  });
  const url = `${COMMONS_API}?${params}`;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    const response = await fetchFn(url, { headers: { 'User-Agent': COMMONS_USER_AGENT, Accept: 'application/json' }, redirect: 'follow' });
    if (response.ok) {
      // eslint-disable-next-line no-await-in-loop
      const body = await response.json();
      return (body?.query?.pages || []).map((page) => sportCategoryPage(page, categoryName, subcategory)).filter(Boolean);
    }
    if (![429, 503].includes(response.status) || attempt === 3) throw new Error(`${categoryName} -> HTTP ${response.status}`);
    const retryAfter = Number(response.headers?.get?.('retry-after'));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 30000) : 1200 * (2 ** attempt);
    // eslint-disable-next-line no-await-in-loop
    await sleep(delay);
  }
  return [];
}

function counts(products) {
  const out = Object.fromEntries(CATEGORY_ORDER.map((category) => [category, 0]));
  for (const product of products) if (product && out[product.category] !== undefined) out[product.category] += 1;
  return out;
}

function donorIndex(products, totals, floor = FLOOR) {
  let donor = null;
  for (const category of CATEGORY_ORDER) {
    if (totals[category] <= floor) continue;
    if (!donor || totals[category] > totals[donor]) donor = category;
  }
  if (!donor) return -1;
  for (let i = products.length - 1; i >= NUCLEUS; i -= 1) if (products[i]?.category === donor) return i;
  return -1;
}

function applyFloor(products, candidateMap, floor = FLOOR) {
  const out = products.map((product) => ({ ...product }));
  const before = counts(out);
  const totals = { ...before };
  const sources = new Set(out.map((product) => product.source));
  const heroes = new Set(out.map((product) => product.image_url));
  let replacements = 0;

  for (const category of Object.keys(candidateMap)) {
    for (const candidate of candidateMap[category]) {
      if (totals[category] >= floor) break;
      if (!candidate?.source || !candidate?.image_url || sources.has(candidate.source) || heroes.has(candidate.image_url)) continue;
      const index = donorIndex(out, totals, floor);
      if (index < 0) break;
      const removed = out[index];
      sources.delete(removed.source);
      heroes.delete(removed.image_url);
      totals[removed.category] -= 1;
      out[index] = curateCandidate(candidate, index);
      sources.add(out[index].source);
      heroes.add(out[index].image_url);
      totals[category] += 1;
      replacements += 1;
    }
  }
  return { products: out, before, after: counts(out), replacements };
}

function appendCandidates(rows, batch, existingSources, existingHeroes, seen) {
  for (const row of batch) {
    const key = `${row.source}|${row.image_url}`;
    if (existingSources.has(row.source) || existingHeroes.has(row.image_url) || seen.has(key)) continue;
    seen.add(key);
    rows.push(row);
  }
}

async function collect(products, floor = FLOOR) {
  const current = counts(products);
  const existingSources = new Set(products.map((product) => product.source));
  const existingHeroes = new Set(products.map((product) => product.image_url));
  const result = {};
  for (const [category, queries] of Object.entries(QUERIES)) {
    const missing = Math.max(0, floor - current[category]);
    if (!missing) continue;
    const rows = [];
    const seen = new Set();
    for (const [query, subcategory, signal] of queries) {
      const batch = await fetchCommonsQuery(query, category, subcategory, 50, fetch, signal); // eslint-disable-line no-await-in-loop
      appendCandidates(rows, batch, existingSources, existingHeroes, seen);
      if (rows.length >= missing + 8) break;
    }
    if (category === 'Sport' && rows.length < missing + 8) {
      for (const [categoryName, subcategory] of SPORT_CATEGORY_FALLBACKS) {
        try {
          const batch = await fetchSportCategory(categoryName, subcategory); // eslint-disable-line no-await-in-loop
          appendCandidates(rows, batch, existingSources, existingHeroes, seen);
          console.log(`[showcase:rebalance] Sport fallback ${categoryName}: +${batch.length}, total=${rows.length}`);
        } catch (error) {
          console.warn(`[showcase:rebalance] Sport fallback ignoré ${categoryName}: ${error.message}`);
        }
        if (rows.length >= missing + 8) break;
      }
    }
    result[category] = rows;
    console.log(`[showcase:rebalance] ${category}: missing=${missing}, candidates=${rows.length}`);
  }
  return result;
}

async function main() {
  const input = process.argv[2] ? path.resolve(process.argv[2]) : INPUT;
  const products = JSON.parse(fs.readFileSync(input, 'utf8'));
  if (!Array.isArray(products) || products.length !== 500) throw new Error('Le rééquilibrage exige exactement 500 produits');
  assertCuratedSource(products);
  const candidateMap = await collect(products);
  const result = applyFloor(products, candidateMap);
  const deficient = Object.entries(result.after).filter(([, value]) => value < FLOOR);
  if (deficient.length) throw new Error(`Couverture insuffisante: ${deficient.map(([k, v]) => `${k}=${v}/${FLOOR}`).join(', ')}`);
  assertCuratedSource(result.products);
  const summary = summarize(result.products);
  if (summary.products !== 500 || summary.out_of_stock !== 0 || summary.unique_heroes !== 500 || summary.unique_sources !== 500) throw new Error('Invariant catalogue cassé après rééquilibrage');
  fs.writeFileSync(input, `${JSON.stringify(result.products, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ replacements: result.replacements, before: result.before, after: result.after, ...summary }, null, 2));
}

if (require.main === module) main().catch((error) => { console.error('[showcase:rebalance:500] échec:', error.message); process.exitCode = 1; });

module.exports = {
  FLOOR,
  NUCLEUS,
  COMMONS_API,
  SPORT_CATEGORY_FALLBACKS,
  QUERIES,
  stripHtml,
  reusableLicense,
  sportCategoryPage,
  fetchSportCategory,
  counts,
  donorIndex,
  applyFloor,
  appendCandidates,
  collect,
};
