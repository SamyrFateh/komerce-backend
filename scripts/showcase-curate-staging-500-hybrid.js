#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          staging-showcase-resilient-curator-500
 * @domain        catalog
 * @layer         script
 * @criticality   low
 * @inputs        curated nucleus, DummyJSON, Platzi, Wikimedia Commons
 * @outputs       exactly N curated staging products with positive stock
 * @depends       scripts/showcase-catalog.js, scripts/showcase-curate-staging-500.js, scripts/showcase-curate-staging-500-primary.js
 * @used-by       explicit one-shot staging catalogue build before boutique E2E
 * @db-read       none
 * @db-write      none
 * @db-txn        no
 * @doctrine      staging fixture only; external enrichment failures never mutate DB
 * @version       2026-09-v6
 */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  DEFAULT_CURATED_INPUTS,
  readProductInputs,
  assertCuratedSource,
  verifyImageUrl,
  stableInt,
} = require('./showcase-catalog');
const {
  DEFAULT_TARGET,
  DEFAULT_OUTPUT,
  CATEGORY_ORDER,
  parseArgs,
  curateCandidate,
  balancedSelection,
  summarize,
} = require('./showcase-curate-staging-500');
const { collectPrimaryPool } = require('./showcase-curate-staging-500-primary');

const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const REQUEST_GAP_MS = 1100;
const MAX_RETRIES = 4;
const RETRY_DELAYS_MS = Object.freeze([2500, 5000, 10000, 20000]);
const COMMONS_QUERY_LIMIT = 50;
const SUPPORTED_COMMONS_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

const COMMONS_QUERIES = Object.freeze([
  ['wristwatch product photograph', 'Mode', 'Montres', /\b(watch|wristwatch|timepiece|rolex|seiko|casio|cartier)\b/i],
  ['handbag fashion product photograph', 'Mode', 'Sacs', /\b(handbag|bag|purse|tote|satchel)\b/i],
  ['sneaker shoe product photograph', 'Mode', 'Chaussures', /\b(sneaker|shoe|trainer|adidas|nike|puma)\b/i],
  ['dress clothing product photograph', 'Mode', 'Vêtements', /\b(dress|shirt|jacket|coat|jeans|trouser|skirt|clothing|garment)\b/i],
  ['backpack product photograph', 'Mode', 'Sacs', /\b(backpack|rucksack|bag)\b/i],
  ['sunglasses product photograph', 'Mode', 'Accessoires', /\b(sunglasses|glasses|eyewear|ray-ban)\b/i],
  ['perfume bottle product photograph', 'Beauté', 'Parfums', /\b(perfume|parfum|fragrance|bottle)\b/i],
  ['cosmetics makeup product photograph', 'Beauté', 'Maquillage', /\b(makeup|cosmetic|lipstick|mascara|powder|foundation)\b/i],
  ['skin care bottle product photograph', 'Beauté', 'Soin', /\b(skincare|skin care|cream|lotion|serum|shampoo|wash|soap|moisturizer)\b/i],
  ['smartphone product photograph', 'Tech', 'Téléphones', /\b(smartphone|iphone|phone|mobile|samsung|huawei|pixel)\b/i],
  ['headphones product photograph', 'Tech', 'Accessoires', /\b(headphone|headphones|earphone|earphones|earbud|earbuds|headset|airpods|livepods)\b/i],
  ['laptop computer product photograph', 'Tech', 'Ordinateurs', /\b(laptop|notebook|macbook|computer)\b/i],
  ['speaker electronics product photograph', 'Tech', 'Audio', /\b(speaker|soundbar|audio|jbl)\b/i],
  ['kitchen utensil product photograph', 'Maison', 'Cuisine', /\b(utensil|whisk|spatula|knife|fork|spoon|ladle|peeler|tongs)\b/i],
  ['cookware product photograph', 'Maison', 'Cuisine', /\b(cookware|pan|pot|kettle|skillet|saucepan)\b/i],
  ['chair furniture product photograph', 'Maison', 'Mobilier', /\b(chair|stool|armchair|seat)\b/i],
  ['table furniture product photograph', 'Maison', 'Mobilier', /\b(table|desk)\b/i],
  ['lamp home product photograph', 'Maison', 'Décoration', /\b(lamp|lantern|light)\b/i],
  ['vase home decoration product photograph', 'Maison', 'Décoration', /\b(vase|planter|pottery)\b/i],
  ['children toy product photograph', 'Enfant', 'Jouets', /\b(toy|lego|doll|blocks|puzzle|chess|game)\b/i],
  ['baby toy product photograph', 'Enfant', 'Jouets', /\b(toy|rattle|teether|plush|doll)\b/i],
  ['sports equipment product photograph', 'Sport', 'Fitness', /\b(racket|racquet|dumbbell|weight|ball|helmet|glove|equipment|fitness|mat)\b/i],
  ['fitness equipment product photograph', 'Sport', 'Fitness', /\b(dumbbell|weight|barbell|kettlebell|treadmill|bike|bench|fitness|gym)\b/i],
  ['football sports product photograph', 'Sport', 'Sports collectifs', /\b(football|soccer ball|ball)\b/i],
]);

const TITLE_BLOCKLIST = /\b(logo|flag|map|diagram|schema|icon|symbol|coat of arms|screenshot|poster|advertisement|advert|manual|patent|drawing|team|club|player|players|coach|tournament|cup|match|stadium|army|chief|president|astronaut|portrait|festival|ceremony|museum|exhibit|display|store|shop|mall|showroom|station|hotel|building|street|road|room|factory|ticket|event|people|person|child playing|counterfeit|seiz(?:e|es|ed)|hazardous)\b/i;

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

function canonicalCommonsMediaUrl(info) {
  const raw = String(info && (info.url || info.thumburl) || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (parsed.hostname === 'upload.wikimedia.org') {
      parsed.search = '';
      parsed.hash = '';
    }
    return parsed.toString();
  } catch {
    return raw;
  }
}

function acceptableCommonsPage(page, productSignal = null) {
  const title = String(page && page.title || '');
  const info = page && page.imageinfo && page.imageinfo[0];
  if (!info || !SUPPORTED_COMMONS_MIME.has(String(info.mime || '').toLowerCase())) return false;
  if (!/^https:\/\//.test(canonicalCommonsMediaUrl(info))) return false;
  if (TITLE_BLOCKLIST.test(title)) return false;
  if (productSignal && !productSignal.test(title.replace(/^File:/i, ' '))) return false;
  const width = Number(info.width) || 0;
  const height = Number(info.height) || 0;
  if (width && height) {
    if (Math.min(width, height) < 500) return false;
    const ratio = width / height;
    if (ratio < 0.55 || ratio > 1.9) return false;
  }
  return true;
}

function mapCommonsPage(page, query, category, subcategory, productSignal = null) {
  if (!acceptableCommonsPage(page, productSignal)) return null;
  const info = page.imageinfo[0];
  const url = canonicalCommonsMediaUrl(info);
  const meta = info.extmetadata || {};
  return {
    name: String(page.title || '').replace(/^File:/i, '').trim(),
    description: stripHtml(meta.ImageDescription && meta.ImageDescription.value),
    category,
    subcategory,
    price_kmf: stableInt(`commons:${page.pageid}:price`, 2500, 65000),
    promo_pct: null,
    image_url: url,
    images: [url],
    source: `commons:${page.pageid}`,
    source_url: info.descriptionurl || `https://commons.wikimedia.org/?curid=${page.pageid}`,
    source_attribution: {
      query,
      license: stripHtml((meta.LicenseShortName && meta.LicenseShortName.value) || (meta.UsageTerms && meta.UsageTerms.value) || 'Wikimedia Commons'),
      artist: stripHtml((meta.Artist && meta.Artist.value) || 'Contributeur Wikimedia Commons'),
    },
  };
}

async function fetchCommonsQuery(query, category, subcategory, limit = COMMONS_QUERY_LIMIT, fetchFn = fetch, productSignal = null) {
  const params = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: query,
    gsrnamespace: '6',
    gsrlimit: String(limit),
    prop: 'imageinfo',
    iiprop: 'url|mime|size|extmetadata',
    iiurlwidth: '900',
    iiextmetadatafilter: 'LicenseShortName|UsageTerms|Artist|ImageDescription',
    format: 'json',
    origin: '*',
  });
  const url = `${COMMONS_API}?${params}`;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const response = await fetchFn(url, {
      headers: { 'User-Agent': 'KomerceShowcaseBuilder/3.3 (staging catalogue test)' },
      redirect: 'follow',
    });
    if (response.ok) {
      const body = await response.json();
      return Object.values(body.query && body.query.pages || {})
        .map((page) => mapCommonsPage(page, query, category, subcategory, productSignal))
        .filter(Boolean);
    }
    if (response.status !== 429 || attempt === MAX_RETRIES) {
      throw new Error(`${query} -> HTTP ${response.status}`);
    }
    const retryAfter = Number(response.headers && response.headers.get && response.headers.get('retry-after'));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
    console.warn(`[showcase:hybrid] Commons 429 "${query}" — retry ${attempt + 1}/${MAX_RETRIES} dans ${delay}ms`);
    await sleep(delay);
  }
  return [];
}

async function collectCommonsPool({ perQuery = COMMONS_QUERY_LIMIT, minNeeded = 0 } = {}) {
  const rows = [];
  const seen = new Set();
  for (let index = 0; index < COMMONS_QUERIES.length; index += 1) {
    const [query, category, subcategory, productSignal] = COMMONS_QUERIES[index];
    try {
      // eslint-disable-next-line no-await-in-loop
      const batch = await fetchCommonsQuery(query, category, subcategory, perQuery, fetch, productSignal);
      for (const product of batch) {
        if (seen.has(product.source)) continue;
        seen.add(product.source);
        rows.push(product);
      }
      console.log(`[showcase:hybrid] Commons ${index + 1}/${COMMONS_QUERIES.length} · ${query}: +${batch.length} · total=${rows.length}`);
    } catch (error) {
      console.warn(`[showcase:hybrid] Commons ignoré "${query}": ${error.message}`);
    }
    if (rows.length >= minNeeded + 100) break;
    if (index < COMMONS_QUERIES.length - 1) {
      // eslint-disable-next-line no-await-in-loop
      await sleep(REQUEST_GAP_MS);
    }
  }
  return rows;
}

async function verifyCandidates(products, concurrency) {
  const results = new Array(products.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= products.length) return;
      const product = products[index];
      // eslint-disable-next-line no-await-in-loop
      results[index] = { product, check: await verifyImageUrl(product.image_url) };
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, products.length || 1) }, worker));
  return results.filter((row) => row.check.ok).map((row) => row.product);
}

function dedupeCandidates(products, nucleus) {
  const sources = new Set(nucleus.map((product) => product.source));
  const heroes = new Set(nucleus.map((product) => product.image_url));
  const out = [];
  for (const product of products) {
    if (!product || !product.source || !product.image_url) continue;
    if (!CATEGORY_ORDER.includes(product.category)) continue;
    if (sources.has(product.source) || heroes.has(product.image_url)) continue;
    sources.add(product.source);
    heroes.add(product.image_url);
    out.push(product);
  }
  return out;
}

function buildCandidatePool(validPrimary, commons, nucleus) {
  return dedupeCandidates([...validPrimary, ...commons], nucleus);
}

async function build(options) {
  const nucleus = readProductInputs(DEFAULT_CURATED_INPUTS);
  assertCuratedSource(nucleus);
  if (nucleus.length > options.target) throw new Error(`Noyau curaté trop grand: ${nucleus.length}/${options.target}`);
  if (nucleus.some((product) => Number(product.stock) <= 0)) throw new Error('Le noyau curaté contient au moins un produit sans stock');

  const needed = options.target - nucleus.length;
  const primary = dedupeCandidates(await collectPrimaryPool(), nucleus);
  const validPrimary = options.network ? await verifyCandidates(primary, options.concurrency) : primary;
  const missingAfterPrimary = Math.max(0, needed - validPrimary.length);

  console.log(JSON.stringify({
    nucleus: nucleus.length,
    needed,
    primary_eligible: primary.length,
    primary_valid: validPrimary.length,
    commons_needed: missingAfterPrimary,
  }, null, 2));

  let commons = [];
  if (missingAfterPrimary > 0) {
    commons = await collectCommonsPool({ perQuery: COMMONS_QUERY_LIMIT, minNeeded: missingAfterPrimary });
  }
  const candidatePool = buildCandidatePool(validPrimary, commons, nucleus);
  const selected = balancedSelection(candidatePool, needed);
  if (selected.length !== needed) {
    throw new Error(`Pool hybride curatable insuffisant: ${selected.length}/${needed} avant miroir média`);
  }

  const curated = [
    ...nucleus.map((product, index) => ({ ...product, sort_order: index, curated: true })),
    ...selected.map((product, index) => curateCandidate(product, nucleus.length + index)),
  ];
  assertCuratedSource(curated);
  const summary = summarize(curated);
  if (summary.products !== options.target) throw new Error(`Cible non atteinte: ${summary.products}/${options.target}`);
  if (summary.out_of_stock !== 0) throw new Error(`${summary.out_of_stock} produits sans stock`);
  if (summary.unique_heroes !== curated.length) throw new Error('Images hero non uniques dans le fixture curaté');

  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, `${JSON.stringify(curated, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    output: options.output,
    source_mode: 'primary-plus-commercially-filtered-commons',
    network_gate: options.network ? 'primary-verified-once; imagekit-mirror-is-final-media-gate' : 'imagekit-mirror-is-final-media-gate',
    primary_valid: validPrimary.length,
    commons_collected: commons.length,
    candidate_pool: candidatePool.length,
    commons_query_limit: COMMONS_QUERY_LIMIT,
    ...summary,
  }, null, 2));
  return { products: curated, summary };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await build(options);
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[showcase:curate:500:hybrid] échec:', error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  COMMONS_API,
  COMMONS_QUERIES,
  COMMONS_QUERY_LIMIT,
  SUPPORTED_COMMONS_MIME,
  REQUEST_GAP_MS,
  MAX_RETRIES,
  RETRY_DELAYS_MS,
  TITLE_BLOCKLIST,
  canonicalCommonsMediaUrl,
  acceptableCommonsPage,
  mapCommonsPage,
  fetchCommonsQuery,
  collectCommonsPool,
  dedupeCandidates,
  buildCandidatePool,
  build,
};
