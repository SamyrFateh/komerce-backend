#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          staging-showcase-source-builder
 * @domain        catalog
 * @layer         script
 * @criticality   low
 * @inputs        DummyJSON, Platzi Fake Store, Wikimedia Commons
 * @outputs       data/catalogue-test-raw/showcase-catalog-v1-source.json
 * @depends       scripts/showcase-catalog.js, Node fetch/fs/path
 * @used-by       showcase catalogue media proof, staging showcase deploy
 * @db-read       none
 * @db-write      none
 * @db-txn        no
 * @version       2026-08-v1
 *
 * Construit un pool de produits de test réellement chargeables AVANT tout
 * upload Cloudinary. Les sources sont distinctes et traçables ; aucun produit
 * n'est dupliqué artificiellement pour atteindre le volume cible.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  roundKmf,
  stableInt,
  localizeTitle,
  mapDummyProduct,
  mapPlatziProduct,
  verifyImageUrl,
} = require('./showcase-catalog');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_OUTPUT = path.join(ROOT, 'data', 'catalogue-test-raw', 'showcase-catalog-v1-source.json');
const DEFAULT_TARGET = 500;
const DUMMY_URL = 'https://dummyjson.com/products?limit=0';
const PLATZI_URL = 'https://api.escuelajs.co/api/v1/products?offset=0&limit=500';
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const USER_AGENT = 'KomerceShowcaseBuilder/1.0 (https://komerce.co)';

const COMMONS_QUERIES = Object.freeze([
  ['wristwatch product', 'Mode', 'Montres'],
  ['handbag product', 'Mode', 'Sacs'],
  ['shoe product', 'Mode', 'Chaussures'],
  ['dress clothing', 'Mode', 'Vêtements'],
  ['perfume bottle product', 'Beauté', 'Parfums'],
  ['cosmetics product', 'Beauté', 'Maquillage'],
  ['smartphone product', 'Tech', 'Téléphones'],
  ['headphones product', 'Tech', 'Accessoires'],
  ['computer laptop product', 'Tech', 'Ordinateurs'],
  ['kitchen utensil product', 'Maison', 'Cuisine'],
  ['chair furniture product', 'Maison', 'Mobilier'],
  ['home decoration product', 'Maison', 'Décoration'],
  ['children toy product', 'Enfant', 'Jouets'],
  ['sports equipment product', 'Sport', 'Fitness'],
]);

const DESCRIPTION_BY_CATEGORY = Object.freeze({
  Mode: 'Sélection mode de démonstration pour tester une vitrine catalogue réaliste.',
  Beauté: 'Produit beauté de démonstration pour tester médias, prix et navigation.',
  Tech: 'Produit tech de démonstration pour éprouver recherche, filtres et parcours achat.',
  Maison: 'Article maison de démonstration pour tester une grille catalogue dense.',
  Enfant: 'Article enfant de démonstration pour tester le rendu et les catégories.',
  Sport: 'Article sport de démonstration pour tester cartes produit et navigation.',
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv) {
  const out = { target: DEFAULT_TARGET, output: DEFAULT_OUTPUT, concurrency: 3 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const [key, inline] = arg.split('=', 2);
    const next = () => inline ?? argv[++i];
    if (key === '--target') out.target = Number.parseInt(next(), 10);
    else if (key === '--output') out.output = path.resolve(next());
    else if (key === '--concurrency') out.concurrency = Number.parseInt(next(), 10);
    else throw new Error(`Argument inconnu: ${arg}`);
  }
  if (!Number.isInteger(out.target) || out.target < 1 || out.target > 1000) {
    throw new Error('--target doit être un entier entre 1 et 1000');
  }
  if (!Number.isInteger(out.concurrency) || out.concurrency < 1 || out.concurrency > 3) {
    throw new Error('--concurrency doit être un entier entre 1 et 3');
  }
  return out;
}

function retryDelayMs(response, attempt) {
  const retryAfter = Number.parseInt(response?.headers?.get?.('retry-after') || '', 10);
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter * 1000, 30000);
  return Math.min(1200 * (2 ** attempt), 15000);
}

async function fetchJson(url, { retries = 0, minDelayMs = 0 } = {}) {
  if (minDelayMs > 0) await sleep(minDelayMs);
  let lastStatus = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      redirect: 'follow',
    });
    lastStatus = response.status;
    if (response.ok) return response.json();
    if ((response.status === 429 || response.status === 503) && attempt < retries) {
      const waitMs = retryDelayMs(response, attempt);
      console.log(`[showcase-source] ${response.status} ${new URL(url).hostname}; retry ${attempt + 1}/${retries} dans ${waitMs}ms`);
      await sleep(waitMs);
      continue;
    }
    throw new Error(`${url} -> HTTP ${response.status}`);
  }
  throw new Error(`${url} -> HTTP ${lastStatus || 'unknown'}`);
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:nbsp|amp|quot|lt|gt);/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isReusableCommonsLicense(value) {
  const license = String(value || '').toLowerCase();
  return license.includes('public domain') ||
    license.includes('cc0') ||
    license.includes('cc by') ||
    license.includes('cc-by');
}

function mapCommonsPage(page, query, category, subcategory) {
  const info = page.imageinfo?.[0];
  const metadata = info?.extmetadata || {};
  const license = stripHtml(metadata.LicenseShortName?.value || metadata.UsageTerms?.value);
  const url = info?.thumburl || info?.url;
  if (!url || !String(info?.mime || '').startsWith('image/') || !isReusableCommonsLicense(license)) return null;

  const artist = stripHtml(metadata.Artist?.value || 'Contributeur Wikimedia Commons');
  const name = localizeTitle(page.title);
  return {
    name,
    description: stripHtml(metadata.ImageDescription?.value) || `${name}. ${DESCRIPTION_BY_CATEGORY[category]}`,
    category,
    subcategory,
    price_kmf: roundKmf(stableInt(page.pageid, 2500, 60000)),
    promo_pct: null,
    image_url: url,
    images: [url],
    source: `commons:${page.pageid}`,
    source_url: info.descriptionurl || `https://commons.wikimedia.org/?curid=${page.pageid}`,
    source_attribution: { query, license, artist },
  };
}

async function fetchCommonsQuery(query, category, subcategory, limit = 50) {
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
    maxlag: '5',
    format: 'json',
    formatversion: '2',
  });
  const body = await fetchJson(`${COMMONS_API}?${params}`, { retries: 5, minDelayMs: 500 });
  return (body.query?.pages || [])
    .map((page) => mapCommonsPage(page, query, category, subcategory))
    .filter(Boolean);
}

function decorate(product, index) {
  const category = product.category || 'Maison';
  const name = localizeTitle(product.name);
  const text = stripHtml(product.description);
  const promoSeed = stableInt(`${product.source}:promo`, 0, 99);
  return {
    ...product,
    product_ref: `SHOWCASE-V1-${String(index + 1).padStart(4, '0')}`,
    name,
    description: text.length >= 24 && text.length <= 400
      ? text
      : `${name}. ${DESCRIPTION_BY_CATEGORY[category] || DESCRIPTION_BY_CATEGORY.Maison}`,
    price_kmf: roundKmf(product.price_kmf || stableInt(product.source, 1500, 85000)),
    promo_pct: product.promo_pct ?? (promoSeed < 28 ? stableInt(`${product.source}:pct`, 8, 45) : null),
    stock: stableInt(`${product.source}:stock`, 2, 70),
    sort_order: index,
  };
}

function dedupe(products) {
  const seenSources = new Set();
  const seenHeroes = new Set();
  return products.filter((product) => {
    if (!product?.image_url || !product?.source) return false;
    if (seenSources.has(product.source) || seenHeroes.has(product.image_url)) return false;
    seenSources.add(product.source);
    seenHeroes.add(product.image_url);
    return true;
  });
}

async function collectCandidates(target) {
  const [dummyBody, platziBody] = await Promise.all([
    fetchJson(DUMMY_URL),
    fetchJson(PLATZI_URL),
  ]);

  const pool = [];
  for (const product of dummyBody.products || []) {
    const mapped = mapDummyProduct(product, pool.length);
    if (mapped?.image_url) pool.push(mapped);
  }
  for (const product of Array.isArray(platziBody) ? platziBody : []) {
    const mapped = mapPlatziProduct(product);
    if (mapped?.image_url) pool.push(mapped);
  }

  // 14 requêtes maximum, séquentielles et identifiées. On collecte tout le
  // pool Commons pour garder une marge après validation réseau des médias.
  for (const [query, category, subcategory] of COMMONS_QUERIES) {
    const rows = await fetchCommonsQuery(query, category, subcategory, 50);
    console.log(`[showcase-source] Commons ${query}: ${rows.length} candidats réutilisables`);
    pool.push(...rows);
  }

  const distinct = dedupe(pool);
  console.log(`[showcase-source] candidats distincts: ${distinct.length} pour cible ${target}`);
  return distinct;
}

async function verifyCandidates(products, target, concurrency = 3) {
  const valid = [];
  const stats = new Map();
  let cursor = 0;

  function bump(product, key) {
    const source = String(product.source || 'unknown').split(':')[0];
    const row = stats.get(source) || { checked: 0, valid: 0, invalid: 0 };
    row[key] += 1;
    stats.set(source, row);
  }

  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= products.length) return;
      if (valid.length >= target) return;
      const product = products[index];
      bump(product, 'checked');
      const result = await verifyImageUrl(product.image_url, 15000);
      if (result.ok) {
        valid.push({ index, product });
        bump(product, 'valid');
      } else {
        bump(product, 'invalid');
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, 3) }, worker));
  valid.sort((a, b) => a.index - b.index);
  console.log('[showcase-source] validation par source:', JSON.stringify(Object.fromEntries(stats), null, 2));
  return valid.slice(0, target).map(({ product }) => product);
}

async function buildSourceManifest(options) {
  const candidates = await collectCandidates(options.target);
  const valid = await verifyCandidates(candidates, options.target, options.concurrency);
  const selected = valid.map(decorate);
  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, JSON.stringify(selected, null, 2) + '\n', 'utf8');

  const summary = {
    products: selected.length,
    target: options.target,
    unique_refs: new Set(selected.map((p) => p.product_ref)).size,
    unique_heroes: new Set(selected.map((p) => p.image_url)).size,
    gallery_rich: selected.filter((p) => (p.images || []).length >= 2).length,
  };
  console.log('[showcase-source] manifest:', JSON.stringify(summary, null, 2));
  if (selected.length < options.target) {
    throw new Error(`Source pool insuffisant: ${selected.length}/${options.target} médias valides`);
  }
  return selected;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await buildSourceManifest(options);
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[showcase-source] échec:', error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  USER_AGENT,
  COMMONS_QUERIES,
  parseArgs,
  retryDelayMs,
  isReusableCommonsLicense,
  mapCommonsPage,
  dedupe,
  decorate,
};
