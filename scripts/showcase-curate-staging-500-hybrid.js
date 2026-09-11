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
 * @version       2026-09-v2
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

const COMMONS_QUERIES = Object.freeze([
  ['wristwatch product photograph', 'Mode', 'Montres'],
  ['handbag fashion product photograph', 'Mode', 'Sacs'],
  ['sneaker shoe product photograph', 'Mode', 'Chaussures'],
  ['dress clothing product photograph', 'Mode', 'Vêtements'],
  ['backpack product photograph', 'Mode', 'Sacs'],
  ['sunglasses product photograph', 'Mode', 'Accessoires'],
  ['perfume bottle product photograph', 'Beauté', 'Parfums'],
  ['cosmetics makeup product photograph', 'Beauté', 'Maquillage'],
  ['skin care bottle product photograph', 'Beauté', 'Soin'],
  ['smartphone product photograph', 'Tech', 'Téléphones'],
  ['headphones product photograph', 'Tech', 'Accessoires'],
  ['laptop computer product photograph', 'Tech', 'Ordinateurs'],
  ['speaker electronics product photograph', 'Tech', 'Audio'],
  ['kitchen utensil product photograph', 'Maison', 'Cuisine'],
  ['cookware product photograph', 'Maison', 'Cuisine'],
  ['chair furniture product photograph', 'Maison', 'Mobilier'],
  ['table furniture product photograph', 'Maison', 'Mobilier'],
  ['lamp home product photograph', 'Maison', 'Décoration'],
  ['vase home decoration product photograph', 'Maison', 'Décoration'],
  ['children toy product photograph', 'Enfant', 'Jouets'],
  ['baby toy product photograph', 'Enfant', 'Jouets'],
  ['sports equipment product photograph', 'Sport', 'Fitness'],
  ['fitness equipment product photograph', 'Sport', 'Fitness'],
  ['football sports product photograph', 'Sport', 'Sports collectifs'],
]);

const TITLE_BLOCKLIST = /\b(logo|flag|map|diagram|schema|icon|symbol|coat of arms|screenshot|poster|advertisement|manual|patent|drawing)\b/i;

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

function acceptableCommonsPage(page) {
  const title = String(page && page.title || '');
  const info = page && page.imageinfo && page.imageinfo[0];
  if (!info || !String(info.mime || '').startsWith('image/')) return false;
  if (!/^https:\/\//.test(String(info.thumburl || info.url || ''))) return false;
  if (TITLE_BLOCKLIST.test(title)) return false;
  const width = Number(info.width) || 0;
  const height = Number(info.height) || 0;
  if (width && height) {
    if (Math.min(width, height) < 400) return false;
    const ratio = width / height;
    if (ratio < 0.45 || ratio > 2.2) return false;
  }
  return true;
}

function mapCommonsPage(page, query, category, subcategory) {
  if (!acceptableCommonsPage(page)) return null;
  const info = page.imageinfo[0];
  const url = info.thumburl || info.url;
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

async function fetchCommonsQuery(query, category, subcategory, limit = 20, fetchFn = fetch) {
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
      headers: { 'User-Agent': 'KomerceShowcaseBuilder/3.2 (staging catalogue test)' },
      redirect: 'follow',
    });
    if (response.ok) {
      const body = await response.json();
      return Object.values(body.query && body.query.pages || {})
        .map((page) => mapCommonsPage(page, query, category, subcategory))
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

async function collectCommonsPool({ perQuery = 20, minNeeded = 0 } = {}) {
  const rows = [];
  const seen = new Set();
  for (let index = 0; index < COMMONS_QUERIES.length; index += 1) {
    const [query, category, subcategory] = COMMONS_QUERIES[index];
    try {
      // eslint-disable-next-line no-await-in-loop
      const batch = await fetchCommonsQuery(query, category, subcategory, perQuery);
      for (const product of batch) {
        if (seen.has(product.source)) continue;
        seen.add(product.source);
        rows.push(product);
      }
      console.log(`[showcase:hybrid] Commons ${index + 1}/${COMMONS_QUERIES.length} · ${query}: +${batch.length} · total=${rows.length}`);
    } catch (error) {
      console.warn(`[showcase:hybrid] Commons ignoré "${query}": ${error.message}`);
    }
    if (rows.length >= minNeeded + 80) break;
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
  // Primary candidates have already passed an explicit source-image GET when --network is enabled.
  // Commons candidates are accepted from Wikimedia's imageinfo metadata here; the subsequent
  // ImageKit mirror is the authoritative network/media gate before any DB mutation. Re-fetching
  // hundreds of source URLs here caused CDN throttling false negatives without increasing safety.
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
    commons = await collectCommonsPool({ perQuery: 20, minNeeded: missingAfterPrimary });
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
    source_mode: 'primary-plus-resilient-commons',
    network_gate: options.network ? 'primary-verified-once; imagekit-mirror-is-final-media-gate' : 'imagekit-mirror-is-final-media-gate',
    primary_valid: validPrimary.length,
    commons_collected: commons.length,
    candidate_pool: candidatePool.length,
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
  REQUEST_GAP_MS,
  MAX_RETRIES,
  RETRY_DELAYS_MS,
  acceptableCommonsPage,
  mapCommonsPage,
  fetchCommonsQuery,
  collectCommonsPool,
  dedupeCandidates,
  buildCandidatePool,
  build,
};
