#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          staging-showcase-primary-curator-500
 * @domain        catalog
 * @layer         script
 * @criticality   low
 * @inputs        current curated nucleus, DummyJSON, Platzi, Fake Store, Open Food Facts, Makeup API
 * @outputs       deterministic candidate pool for the 500-product staging fixture
 * @depends       scripts/showcase-catalog.js, scripts/showcase-curate-staging-500.js
 * @used-by       one-shot staging boutique / E2E catalogue preparation
 * @db-read       none
 * @db-write      none
 * @db-txn        no
 * @doctrine      staging fixture only; every external source remains candidate-only until network/media gates pass
 * @version       2026-09-v3
 */
'use strict';

const fs = require('fs');
const {
  DEFAULT_CURATED_INPUTS,
  readProductInputs,
  assertCuratedSource,
  mapDummyProduct,
  mapPlatziProduct,
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

const DUMMY_URL = 'https://dummyjson.com/products?limit=0';
const PLATZI_URL = 'https://api.escuelajs.co/api/v1/products?offset=0&limit=500';
const FAKESTORE_URL = 'https://fakestoreapi.com/products';
const MAKEUP_BASE_URL = 'https://makeup-api.herokuapp.com/api/v1/products.json';
const OPEN_FOOD_BASE_URL = 'https://world.openfoodfacts.org/api/v2/search';
const SOURCE_TIMEOUT_MS = 20000;
const OPEN_FOOD_LIMIT = 220;
const MAKEUP_LIMIT = 240;
const SOURCE_RETRY_DELAYS_MS = Object.freeze([1200, 3000, 6000]);
const TRANSIENT_SOURCE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

const MAKEUP_TYPES = Object.freeze([
  'foundation',
  'lipstick',
  'mascara',
  'eyeliner',
  'eyeshadow',
  'blush',
  'bronzer',
  'nail_polish',
]);

const OPEN_FOOD_CATEGORIES = Object.freeze(['Snacks', 'Beverages', 'Breakfasts']);

const FAKESTORE_CATEGORY_MAP = new Map([
  ["men's clothing", ['Mode', 'Homme']],
  ["women's clothing", ['Mode', 'Femme']],
  ['jewelery', ['Mode', 'Bijoux']],
  ['electronics', ['Tech', 'Accessoires']],
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function httpsUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (raw.startsWith('//')) return `https:${raw}`;
  if (raw.startsWith('http://')) return `https://${raw.slice('http://'.length)}`;
  return /^https:\/\//i.test(raw) ? raw : null;
}

function openFoodUrl(category, pageSize = 100) {
  const params = new URLSearchParams({
    categories_tags_en: category,
    page_size: String(pageSize),
    fields: 'code,product_name,brands,image_front_url,image_url',
  });
  return `${OPEN_FOOD_BASE_URL}?${params}`;
}

function makeupUrl(type) {
  return `${MAKEUP_BASE_URL}?product_type=${encodeURIComponent(type)}`;
}

async function fetchJson(url, options = {}) {
  const timeoutMs = options.timeoutMs || SOURCE_TIMEOUT_MS;
  const retries = Number.isInteger(options.retries) ? options.retries : SOURCE_RETRY_DELAYS_MS.length;
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': options.userAgent || 'KomerceShowcaseBuilder/3.5 (https://komerce.co)' },
        redirect: 'follow',
        signal: controller.signal,
      });
      if (response.ok) return response.json();

      const error = new Error(`${url} -> HTTP ${response.status}`);
      error.status = response.status;
      lastError = error;
      if (!TRANSIENT_SOURCE_STATUS.has(response.status) || attempt === retries) throw error;

      const retryAfter = Number(response.headers && response.headers.get && response.headers.get('retry-after'));
      const delay = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : SOURCE_RETRY_DELAYS_MS[Math.min(attempt, SOURCE_RETRY_DELAYS_MS.length - 1)];
      console.warn(`[showcase:primary] source transitoire ${response.status} — retry ${attempt + 1}/${retries} dans ${delay}ms: ${url}`);
      // eslint-disable-next-line no-await-in-loop
      await sleep(delay);
    } catch (error) {
      lastError = error;
      const retryableNetworkError = error.name === 'AbortError' || error.status == null;
      if (!retryableNetworkError || attempt === retries) throw error;
      const delay = SOURCE_RETRY_DELAYS_MS[Math.min(attempt, SOURCE_RETRY_DELAYS_MS.length - 1)];
      console.warn(`[showcase:primary] source réseau transitoire — retry ${attempt + 1}/${retries} dans ${delay}ms: ${url}`);
      // eslint-disable-next-line no-await-in-loop
      await sleep(delay);
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError || new Error(`${url} -> source indisponible`);
}

async function safeFetchJson(label, url, options = {}) {
  try {
    return await fetchJson(url, options);
  } catch (error) {
    console.warn(`[showcase:primary] source ${label} ignorée: ${error.name === 'AbortError' ? 'timeout' : error.message}`);
    return null;
  }
}

function mapFakeStoreProduct(product) {
  const mapped = FAKESTORE_CATEGORY_MAP.get(String(product && product.category || '').toLowerCase());
  const image = httpsUrl(product && product.image);
  if (!mapped || !image || !String(product && product.title || '').trim()) return null;
  const [category, subcategory] = mapped;
  const price = Number(product.price);
  return {
    name: product.title,
    description: product.description,
    category,
    subcategory,
    price_kmf: Number.isFinite(price) && price > 0 ? price * 500 : stableInt(`fakestore:${product.id}:price`, 2500, 65000),
    promo_pct: null,
    image_url: image,
    images: [image],
    source: `fakestore:${product.id}`,
    source_url: `https://fakestoreapi.com/products/${product.id}`,
  };
}

function mapOpenFoodProduct(product) {
  const code = String(product && product.code || '').trim();
  const name = String(product && product.product_name || '').trim();
  const image = httpsUrl(product && (product.image_front_url || product.image_url));
  if (!code || !name || !image) return null;
  const brands = String(product.brands || '').trim();
  return {
    name,
    description: `${brands ? `${brands}. ` : ''}Produit d'épicerie sélectionné comme donnée réaliste pour les parcours boutique et commande Komerce.`,
    category: 'Maison',
    subcategory: 'Épicerie',
    price_kmf: stableInt(`openfoodfacts:${code}:price`, 1000, 18000),
    promo_pct: null,
    image_url: image,
    images: [image],
    source: `openfoodfacts:${code}`,
    source_url: `https://world.openfoodfacts.org/product/${encodeURIComponent(code)}`,
  };
}

function makeupSubcategory(type) {
  if (type === 'nail_polish') return 'Ongles';
  if (type === 'foundation') return 'Teint';
  if (['lipstick', 'lip_liner'].includes(type)) return 'Lèvres';
  if (['mascara', 'eyeliner', 'eyeshadow', 'eyebrow'].includes(type)) return 'Yeux';
  return 'Maquillage';
}

function mapMakeupProduct(product) {
  const id = product && product.id;
  const type = String(product && product.product_type || '').trim().toLowerCase();
  const name = String(product && product.name || '').trim();
  const image = httpsUrl(product && (product.api_featured_image || product.image_link));
  if (id == null || !name || !image) return null;
  const price = Number(product.price);
  const brand = String(product.brand || '').trim();
  return {
    name: brand && !name.toLowerCase().includes(brand.toLowerCase()) ? `${brand} ${name}` : name,
    description: product.description,
    category: 'Beauté',
    subcategory: makeupSubcategory(type),
    price_kmf: Number.isFinite(price) && price > 0 ? price * 500 : stableInt(`makeup:${id}:price`, 2000, 45000),
    promo_pct: null,
    image_url: image,
    images: [image],
    source: `makeup:${id}`,
    source_url: `https://makeup-api.herokuapp.com/api/v1/products/${id}.json`,
  };
}

async function collectOpenFoodPool() {
  const rows = [];
  for (const category of OPEN_FOOD_CATEGORIES) {
    // Search reads are intentionally few and sequential to stay polite to Open Food Facts.
    // eslint-disable-next-line no-await-in-loop
    const body = await safeFetchJson(`openfoodfacts:${category}`, openFoodUrl(category, 100));
    for (const product of body && Array.isArray(body.products) ? body.products : []) {
      const mapped = mapOpenFoodProduct(product);
      if (mapped) rows.push(mapped);
      if (rows.length >= OPEN_FOOD_LIMIT) return rows;
    }
  }
  return rows;
}

async function collectMakeupPool() {
  const bodies = await Promise.all(MAKEUP_TYPES.map(async (type) => ({
    type,
    body: await safeFetchJson(`makeup:${type}`, makeupUrl(type), { timeoutMs: 15000 }),
  })));
  const rows = [];
  for (const { body } of bodies) {
    for (const product of Array.isArray(body) ? body : []) {
      const mapped = mapMakeupProduct(product);
      if (mapped) rows.push(mapped);
      if (rows.length >= MAKEUP_LIMIT) return rows;
    }
  }
  return rows;
}

function dedupePool(pool) {
  const seenSources = new Set();
  const seenHeroes = new Set();
  return pool.filter((product) => {
    if (!product || !product.image_url || !product.source || seenSources.has(product.source) || seenHeroes.has(product.image_url)) return false;
    seenSources.add(product.source);
    seenHeroes.add(product.image_url);
    return true;
  });
}

async function collectPrimaryPool() {
  const [dummyBody, platziBody, fakeStoreBody, openFoodPool, makeupPool] = await Promise.all([
    safeFetchJson('dummyjson', DUMMY_URL),
    safeFetchJson('platzi', PLATZI_URL),
    safeFetchJson('fakestore', FAKESTORE_URL),
    collectOpenFoodPool(),
    collectMakeupPool(),
  ]);

  const dummy = [];
  for (const product of dummyBody && Array.isArray(dummyBody.products) ? dummyBody.products : []) {
    const mapped = mapDummyProduct(product, dummy.length);
    if (mapped?.image_url) dummy.push(mapped);
  }

  const platzi = [];
  for (const product of Array.isArray(platziBody) ? platziBody : []) {
    const mapped = mapPlatziProduct(product);
    if (mapped?.image_url) platzi.push(mapped);
  }

  const fakeStore = [];
  for (const product of Array.isArray(fakeStoreBody) ? fakeStoreBody : []) {
    const mapped = mapFakeStoreProduct(product);
    if (mapped?.image_url) fakeStore.push(mapped);
  }

  const distinct = dedupePool([...dummy, ...platzi, ...fakeStore, ...openFoodPool, ...makeupPool]);
  console.log(JSON.stringify({
    source_candidates: {
      dummyjson: dummy.length,
      platzi: platzi.length,
      fakestore: fakeStore.length,
      openfoodfacts: openFoodPool.length,
      makeup: makeupPool.length,
    },
    primary_distinct: distinct.length,
  }, null, 2));
  return distinct;
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

async function build(options) {
  const nucleus = readProductInputs(DEFAULT_CURATED_INPUTS);
  assertCuratedSource(nucleus);
  if (nucleus.length > options.target) throw new Error(`Noyau curaté trop grand: ${nucleus.length}/${options.target}`);
  if (nucleus.some((product) => Number(product.stock) <= 0)) throw new Error('Le noyau curaté contient au moins un produit sans stock');

  const needed = options.target - nucleus.length;
  const existingSources = new Set(nucleus.map((product) => product.source));
  const existingHeroes = new Set(nucleus.map((product) => product.image_url));
  const primary = await collectPrimaryPool();
  const candidates = primary.filter((product) => (
    product.image_url
    && product.source
    && !existingSources.has(product.source)
    && !existingHeroes.has(product.image_url)
    && CATEGORY_ORDER.includes(product.category)
  ));
  const valid = options.network ? await verifyCandidates(candidates, options.concurrency) : candidates;
  const selected = balancedSelection(valid, needed);

  console.log(JSON.stringify({
    primary_pool: primary.length,
    eligible_before_network: candidates.length,
    eligible_after_network: valid.length,
    needed,
  }, null, 2));

  if (selected.length !== needed) {
    throw new Error(`Pool primaire curatable insuffisant: ${selected.length}/${needed} après contrôle${options.network ? ' réseau' : ''}`);
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

  fs.mkdirSync(require('path').dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, `${JSON.stringify(curated, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ output: options.output, source_mode: 'multi-product-sources', ...summary }, null, 2));
  return { products: curated, summary };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await build(options);
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[showcase:curate:500:primary] échec:', error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_TARGET,
  DEFAULT_OUTPUT,
  DUMMY_URL,
  PLATZI_URL,
  FAKESTORE_URL,
  MAKEUP_BASE_URL,
  OPEN_FOOD_BASE_URL,
  SOURCE_TIMEOUT_MS,
  OPEN_FOOD_LIMIT,
  MAKEUP_LIMIT,
  SOURCE_RETRY_DELAYS_MS,
  TRANSIENT_SOURCE_STATUS,
  MAKEUP_TYPES,
  OPEN_FOOD_CATEGORIES,
  httpsUrl,
  openFoodUrl,
  makeupUrl,
  mapFakeStoreProduct,
  mapOpenFoodProduct,
  mapMakeupProduct,
  dedupePool,
  collectOpenFoodPool,
  collectMakeupPool,
  collectPrimaryPool,
  verifyCandidates,
  build,
};