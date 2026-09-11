#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          staging-showcase-catalog-tool
 * @domain        catalog
 * @layer         script
 * @criticality   low
 * @inputs        curated staging catalog, optional public candidate sources, Cloudinary, DATABASE_URL
 * @outputs       candidate manifest, Cloudinary manifest, staging products
 * @depends       db.js, Node fetch/FormData/crypto/fs/path
 * @used-by       staging showcase preparation, realistic boutique/E2E testing
 * @db-read       products
 * @db-write      products
 * @db-txn        yes (seed command)
 * @doctrine      DOCTRINE_CATALOGUE.md, curated staging fixtures only
 * @version       2026-09-v3
 *
 * SHOWCASE V1 — pipeline staging strict :
 *   1. `source`   = construit seulement un POOL CANDIDAT depuis des sources publiques ;
 *   2. curation   = étape humaine explicite dans data/staging-market-catalog-curated-v1.json ;
 *   3. `prepare`  = miroir Cloudinary du manifeste CURATÉ, jamais du pool candidat ;
 *   4. `audit`    = vérifie le manifeste Cloudinary canonique ;
 *   5. `seed`     = remplace le catalogue staging avec ce manifeste audité.
 *
 * Le legacy db/seed-products-v2.json est explicitement interdit comme entrée.
 * Il ne doit plus pouvoir réinjecter des couples nom/image incohérents.
 *
 * Commandes :
 *   node scripts/showcase-catalog.js source --target 500 --network --strict
 *   node scripts/showcase-catalog.js prepare
 *   node scripts/showcase-catalog.js audit --network --strict
 *   KOMERCE_ALLOW_SHOWCASE_SEED=1 DATABASE_URL=... \
 *     node scripts/showcase-catalog.js seed --replace-active
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_SOURCE_TARGET = 500;
const DEFAULT_CURATED_INPUT = path.join(ROOT, 'data', 'staging-market-catalog-curated-v1.json');
const DEFAULT_SOURCE_MANIFEST = path.join(ROOT, 'data', 'catalogue-test-raw', 'showcase-catalog-v1-candidates.json');
const DEFAULT_MANIFEST = path.join(ROOT, 'data', 'catalogue-test-raw', 'showcase-catalog-v1.json');
const BLOCKED_LEGACY_INPUT = path.join(ROOT, 'db', 'seed-products-v2.json');
const DUMMY_URL = 'https://dummyjson.com/products?limit=0';
const PLATZI_URL = 'https://api.escuelajs.co/api/v1/products?offset=0&limit=500';
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const CLOUDINARY_HOST = 'res.cloudinary.com';
const CLOUDINARY_CANONICAL_PATH = '/image/upload/';
const CLOUDINARY_FETCH_PATH = '/image/fetch/';
const BATCH_SIZE = 50;

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

const DUMMY_CATEGORY_MAP = new Map([
  ['beauty', ['Beauté', 'Soin']],
  ['fragrances', ['Beauté', 'Parfums']],
  ['skin-care', ['Beauté', 'Soin']],
  ['groceries', ['Maison', 'Épicerie']],
  ['home-decoration', ['Maison', 'Décoration']],
  ['furniture', ['Maison', 'Mobilier']],
  ['kitchen-accessories', ['Maison', 'Cuisine']],
  ['laptops', ['Tech', 'Ordinateurs']],
  ['smartphones', ['Tech', 'Téléphones']],
  ['tablets', ['Tech', 'Tablettes']],
  ['mobile-accessories', ['Tech', 'Accessoires']],
  ['mens-shirts', ['Mode', 'Homme']],
  ['mens-shoes', ['Mode', 'Chaussures']],
  ['mens-watches', ['Mode', 'Montres']],
  ['womens-dresses', ['Mode', 'Robes']],
  ['womens-shoes', ['Mode', 'Chaussures']],
  ['womens-watches', ['Mode', 'Montres']],
  ['womens-bags', ['Mode', 'Sacs']],
  ['womens-jewellery', ['Mode', 'Bijoux']],
  ['sunglasses', ['Mode', 'Accessoires']],
  ['tops', ['Mode', 'Vêtements']],
  ['sports-accessories', ['Sport', 'Fitness']],
]);

const PLATZI_CATEGORY_MAP = new Map([
  ['Clothes', ['Mode', 'Vêtements']],
  ['Electronics', ['Tech', 'Accessoires']],
  ['Furniture', ['Maison', 'Mobilier']],
  ['Shoes', ['Mode', 'Chaussures']],
  ['Miscellaneous', ['Maison', 'Divers']],
]);

const TITLE_REPLACEMENTS = [
  [/\bsmartphone\b/gi, 'smartphone'],
  [/\bphone\b/gi, 'téléphone'],
  [/\blaptop\b/gi, 'ordinateur portable'],
  [/\btablet\b/gi, 'tablette'],
  [/\bshoes?\b/gi, 'chaussures'],
  [/\bdress\b/gi, 'robe'],
  [/\bwatch\b/gi, 'montre'],
  [/\bperfume\b/gi, 'parfum'],
  [/\bfragrance\b/gi, 'parfum'],
  [/\bbag\b/gi, 'sac'],
  [/\bshirt\b/gi, 'chemise'],
  [/\bcream\b/gi, 'crème'],
  [/\blipstick\b/gi, 'rouge à lèvres'],
  [/\bchair\b/gi, 'chaise'],
];

const DESCRIPTION_BY_CATEGORY = Object.freeze({
  Mode: 'Sélection mode candidate à curater avant toute publication staging.',
  Beauté: 'Produit beauté candidat à curater avant toute publication staging.',
  Tech: 'Produit tech candidat à curater avant toute publication staging.',
  Maison: 'Article maison candidat à curater avant toute publication staging.',
  Enfant: 'Article enfant candidat à curater avant toute publication staging.',
  Sport: 'Article sport candidat à curater avant toute publication staging.',
});

function parseArgs(argv) {
  const out = {
    command: 'audit',
    target: null,
    input: DEFAULT_CURATED_INPUT,
    sourceManifest: DEFAULT_SOURCE_MANIFEST,
    manifest: DEFAULT_MANIFEST,
    network: false,
    strict: false,
    replaceActive: false,
    concurrency: 10,
  };
  const args = [...argv];
  if (args[0] && !args[0].startsWith('-')) out.command = args.shift();
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const [key, inline] = arg.split('=', 2);
    const next = () => inline ?? args[++i];
    if (key === '--target') out.target = Number.parseInt(next(), 10);
    else if (key === '--input') out.input = path.resolve(next());
    else if (key === '--source-manifest') out.sourceManifest = path.resolve(next());
    else if (key === '--manifest') out.manifest = path.resolve(next());
    else if (key === '--concurrency') out.concurrency = Number.parseInt(next(), 10);
    else if (arg === '--network') out.network = true;
    else if (arg === '--strict') out.strict = true;
    else if (arg === '--replace-active') out.replaceActive = true;
    else throw new Error(`Argument inconnu: ${arg}`);
  }

  if (out.target !== null && (!Number.isInteger(out.target) || out.target < 1 || out.target > 1000)) {
    throw new Error('--target doit être un entier entre 1 et 1000');
  }
  if (!Number.isInteger(out.concurrency) || out.concurrency < 1 || out.concurrency > 25) {
    throw new Error('--concurrency doit être un entier entre 1 et 25');
  }
  if (path.resolve(out.input) === path.resolve(BLOCKED_LEGACY_INPUT)) {
    throw new Error('Entrée legacy interdite: db/seed-products-v2.json ne peut plus alimenter le showcase staging');
  }
  if (out.command === 'source' && out.target === null) out.target = DEFAULT_SOURCE_TARGET;
  return out;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readProductList(file) {
  const body = readJson(file);
  const products = Array.isArray(body) ? body : body && Array.isArray(body.products) ? body.products : null;
  if (!products || products.length === 0) {
    throw new Error(`Manifeste produits vide ou invalide: ${file}`);
  }
  return products;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function resolveTarget(products, requestedTarget) {
  const target = requestedTarget == null ? products.length : requestedTarget;
  if (products.length < target) {
    throw new Error(`Manifeste sous cible: ${products.length}/${target}`);
  }
  return target;
}

function assertCuratedSource(products) {
  const refs = new Set();
  const heroes = new Set();
  const errors = [];
  products.forEach((product, index) => {
    const label = product.product_ref || `#${index}`;
    if (product.curated !== true) errors.push(`${label}: curated=true requis`);
    if (!/^KPR-\d{6,}$/.test(String(product.product_ref || ''))) errors.push(`${label}: product_ref KPR canonique requis`);
    if (refs.has(product.product_ref)) errors.push(`${label}: product_ref dupliqué`);
    refs.add(product.product_ref);
    if (!String(product.name || '').trim() || /^(produit|article|item)(\s|$)/i.test(String(product.name || '').trim())) {
      errors.push(`${label}: nom générique interdit`);
    }
    const description = String(product.description || '').trim();
    if (description.length < 24 || /^Raw test product:/i.test(description)) errors.push(`${label}: description curatée requise`);
    if (!String(product.category || '').trim() || !String(product.subcategory || '').trim()) errors.push(`${label}: catégorie/sous-catégorie requises`);
    if (!(Number(product.price_kmf) > 0)) errors.push(`${label}: price_kmf > 0 requis`);
    if (!Number.isInteger(Number(product.stock)) || Number(product.stock) < 0) errors.push(`${label}: stock entier >= 0 requis`);
    if (!/^https:\/\//.test(String(product.image_url || ''))) errors.push(`${label}: image hero HTTPS requise`);
    if (!String(product.source || '').trim()) errors.push(`${label}: source traçable requise`);
    if (heroes.has(product.image_url)) errors.push(`${label}: image hero dupliquée`);
    heroes.add(product.image_url);
  });
  if (errors.length) {
    throw new Error(`Catalogue curaté invalide (${errors.length})\n${errors.slice(0, 20).map((v) => `  - ${v}`).join('\n')}`);
  }
  return { products: products.length, refs: refs.size, heroes: heroes.size };
}

function roundKmf(value) {
  const n = Number(value) || 0;
  return Math.max(500, Math.round(n / 500) * 500);
}

function stableInt(value, min, max) {
  const hex = crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, 8);
  const ratio = Number.parseInt(hex, 16) / 0xffffffff;
  return Math.round(min + ratio * (max - min));
}

function localizeTitle(title) {
  let value = String(title || '').replace(/^File:/i, '').replace(/[_-]+/g, ' ').trim();
  value = value.replace(/\.(jpe?g|png|webp|gif|tiff?)$/i, '').replace(/\s+/g, ' ');
  for (const [pattern, replacement] of TITLE_REPLACEMENTS) value = value.replace(pattern, replacement);
  return value.slice(0, 120) || 'Candidat catalogue';
}

function cleanDescription(value, category, name) {
  const text = String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (text.length >= 24 && text.length <= 400) return text;
  return `${name}. ${DESCRIPTION_BY_CATEGORY[category] || DESCRIPTION_BY_CATEGORY.Maison}`;
}

function isCloudinaryUrl(url) {
  try { return new URL(url).hostname === CLOUDINARY_HOST; }
  catch { return false; }
}

function isCanonicalCloudinaryUpload(url) {
  try {
    const u = new URL(url);
    return u.hostname === CLOUDINARY_HOST && u.pathname.includes(CLOUDINARY_CANONICAL_PATH);
  } catch { return false; }
}

function isCloudinaryFetchProxy(url) {
  try {
    const u = new URL(url);
    return u.hostname === CLOUDINARY_HOST && u.pathname.includes(CLOUDINARY_FETCH_PATH);
  } catch { return false; }
}

function normalizeImages(product) {
  let images = product.images;
  if (typeof images === 'string') {
    try { images = JSON.parse(images); }
    catch { images = []; }
  }
  if (!Array.isArray(images)) images = [];
  return [...new Set([product.image_url, ...images].map((v) => String(v || '').trim()).filter(Boolean))];
}

function decorateCandidate(product, index) {
  const name = localizeTitle(product.name);
  const category = product.category || 'Maison';
  const promoSeed = stableInt(`${product.source}:promo`, 0, 99);
  return {
    ...product,
    product_ref: `CANDIDATE-V1-${String(index + 1).padStart(4, '0')}`,
    name,
    description: cleanDescription(product.description, category, name),
    price_kmf: roundKmf(product.price_kmf || stableInt(product.source, 1500, 85000)),
    promo_pct: product.promo_pct ?? (promoSeed < 28 ? stableInt(`${product.source}:pct`, 8, 45) : null),
    stock: stableInt(`${product.source}:stock`, 2, 70),
    sort_order: index,
    curated: false,
  };
}

function mapDummyProduct(product, index = 0) {
  const mapped = DUMMY_CATEGORY_MAP.get(product.category);
  if (!mapped) return null;
  const [category, subcategory] = mapped;
  const images = [...new Set([product.thumbnail, ...(product.images || [])].filter(Boolean))].slice(0, index < 150 ? 3 : 1);
  const discount = Number(product.discountPercentage);
  return {
    name: product.title,
    description: product.description,
    category,
    subcategory,
    price_kmf: roundKmf(Number(product.price) * 500),
    promo_pct: Number.isFinite(discount) && discount >= 5 ? Math.min(60, Math.round(discount)) : null,
    image_url: images[0] || null,
    images,
    source: `dummyjson:${product.id}`,
    source_url: `https://dummyjson.com/products/${product.id}`,
  };
}

function mapPlatziProduct(product) {
  const mapped = PLATZI_CATEGORY_MAP.get(product.category?.name);
  if (!mapped || !product.title) return null;
  const [category, subcategory] = mapped;
  const images = [...new Set((product.images || []).filter((url) => /^https?:\/\//.test(url)))].slice(0, 2);
  return {
    name: product.title,
    description: product.description,
    category,
    subcategory,
    price_kmf: roundKmf(Number(product.price) * 500),
    promo_pct: null,
    image_url: images[0] || null,
    images,
    source: `platzi:${product.id}`,
    source_url: `https://api.escuelajs.co/api/v1/products/${product.id}`,
  };
}

function stripHtml(value) {
  return String(value || '').replace(/<[^>]+>/g, ' ').replace(/&[^;]+;/g, ' ').replace(/\s+/g, ' ').trim();
}

function mapCommonsPage(page, query, category, subcategory) {
  const info = page.imageinfo?.[0];
  const url = info?.thumburl || info?.url;
  if (!url || !String(info.mime || '').startsWith('image/')) return null;
  const metadata = info.extmetadata || {};
  const license = stripHtml(metadata.LicenseShortName?.value || metadata.UsageTerms?.value || 'Wikimedia Commons');
  const artist = stripHtml(metadata.Artist?.value || 'Contributeur Wikimedia Commons');
  return {
    name: localizeTitle(page.title),
    description: stripHtml(metadata.ImageDescription?.value),
    category,
    subcategory,
    price_kmf: stableInt(page.pageid, 2500, 60000),
    promo_pct: null,
    image_url: url,
    images: [url],
    source: `commons:${page.pageid}`,
    source_url: info.descriptionurl || `https://commons.wikimedia.org/?curid=${page.pageid}`,
    source_attribution: { query, license, artist },
  };
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { 'User-Agent': 'KomerceShowcaseBuilder/3.0' }, redirect: 'follow' });
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  return response.json();
}

async function fetchCommons(query, category, subcategory, limit = 30) {
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
  const body = await fetchJson(`${COMMONS_API}?${params}`);
  return Object.values(body.query?.pages || {})
    .map((page) => mapCommonsPage(page, query, category, subcategory))
    .filter(Boolean);
}

async function collectSourceProducts(target) {
  const [dummyBody, platziBody] = await Promise.all([fetchJson(DUMMY_URL), fetchJson(PLATZI_URL)]);
  const pool = [];
  for (const product of dummyBody.products || []) {
    const mapped = mapDummyProduct(product, pool.length);
    if (mapped?.image_url) pool.push(mapped);
  }
  for (const product of Array.isArray(platziBody) ? platziBody : []) {
    const mapped = mapPlatziProduct(product);
    if (mapped?.image_url) pool.push(mapped);
  }
  if (pool.length < target) {
    for (const [query, category, subcategory] of COMMONS_QUERIES) {
      pool.push(...await fetchCommons(query, category, subcategory, 35));
      if (pool.length >= target + 80) break;
    }
  }

  const seenSources = new Set();
  const seenHeroes = new Set();
  const distinct = [];
  for (const product of pool) {
    if (!product.image_url || seenSources.has(product.source) || seenHeroes.has(product.image_url)) continue;
    seenSources.add(product.source);
    seenHeroes.add(product.image_url);
    distinct.push(decorateCandidate(product, distinct.length));
  }
  return distinct;
}

async function pooledMap(items, concurrency, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, worker));
  return results;
}

async function verifyImageUrl(url, timeoutMs = 12000) {
  if (!url) return { ok: false, reason: 'missing-url' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'image/avif,image/webp,image/*,*/*;q=0.8', 'User-Agent': 'KomerceShowcaseAudit/3.0' },
      redirect: 'follow',
      signal: controller.signal,
    });
    const type = response.headers.get('content-type') || '';
    const reader = response.body?.getReader?.();
    const firstChunk = reader ? await reader.read() : { value: null };
    if (reader) await reader.cancel().catch(() => {});
    return {
      ok: response.ok && type.startsWith('image/') && (firstChunk.value?.byteLength || 0) > 64,
      status: response.status,
      type,
      bytes: firstChunk.value?.byteLength || 0,
    };
  } catch (error) {
    return { ok: false, reason: error.name === 'AbortError' ? 'timeout' : error.message };
  } finally {
    clearTimeout(timer);
  }
}

async function verifySourcePool(products, concurrency) {
  const checks = await pooledMap(products, concurrency, async (product) => ({
    product,
    result: await verifyImageUrl(product.image_url),
  }));
  return checks.filter(({ result }) => result.ok).map(({ product }) => product);
}

async function buildSourceManifest(options) {
  const pool = await collectSourceProducts(options.target || DEFAULT_SOURCE_TARGET);
  console.log(`[showcase] pool candidat brut: ${pool.length}`);
  const valid = options.network ? await verifySourcePool(pool, options.concurrency) : pool;
  const target = options.target || DEFAULT_SOURCE_TARGET;
  const selected = valid.slice(0, target);
  writeJson(options.sourceManifest, selected);
  console.log(`[showcase] candidats: ${selected.length}/${target} -> ${options.sourceManifest}`);
  if (options.strict && selected.length < target) {
    throw new Error(`Pool candidat insuffisant: ${selected.length}/${target} médias valides`);
  }
  return selected;
}

function cloudinaryConfig() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error('CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY et CLOUDINARY_API_SECRET sont requis');
  }
  return { cloudName, apiKey, apiSecret };
}

function cloudinarySignature(params, apiSecret) {
  const canonical = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
  return crypto.createHash('sha1').update(canonical + apiSecret).digest('hex');
}

async function uploadRemoteImage(remoteUrl, { folder, publicId }) {
  const { cloudName, apiKey, apiSecret } = cloudinaryConfig();
  const timestamp = Math.floor(Date.now() / 1000);
  const params = { folder, overwrite: 'true', public_id: publicId, timestamp };
  const form = new FormData();
  form.set('file', remoteUrl);
  form.set('api_key', apiKey);
  form.set('timestamp', String(timestamp));
  form.set('folder', folder);
  form.set('public_id', publicId);
  form.set('overwrite', 'true');
  form.set('signature', cloudinarySignature(params, apiSecret));
  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, { method: 'POST', body: form });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.secure_url) {
    throw new Error(`Cloudinary upload failed (${response.status}): ${body.error?.message || 'unknown error'}`);
  }
  return body.secure_url;
}

async function uploadProductMedia(product) {
  const folder = `komerce/staging/showcase-v1/${product.product_ref.toLowerCase()}`;
  const sourceImages = normalizeImages(product).slice(0, 3);
  const uploaded = [];
  for (let i = 0; i < sourceImages.length; i += 1) {
    uploaded.push(await uploadRemoteImage(sourceImages[i], {
      folder,
      publicId: i === 0 ? 'hero' : `gallery-${String(i).padStart(2, '0')}`,
    }));
  }
  return { ...product, image_url: uploaded[0], images: uploaded };
}

async function prepareCatalogue(options) {
  if (!fs.existsSync(options.input)) throw new Error(`Catalogue curaté absent: ${options.input}`);
  const source = readProductList(options.input);
  assertCuratedSource(source);
  const target = resolveTarget(source, options.target);

  const uploaded = [];
  for (const product of source.slice(0, target)) {
    uploaded.push(await uploadProductMedia(product));
    if (uploaded.length % 25 === 0) console.log(`[showcase] Cloudinary ${uploaded.length}/${target}`);
  }
  writeJson(options.manifest, uploaded);
  console.log(`[showcase] manifeste Cloudinary curaté: ${uploaded.length} -> ${options.manifest}`);
  return uploaded;
}

function staticAudit(products, target = null) {
  const allImages = products.flatMap(normalizeImages);
  const rows = products.map((product, index) => {
    const images = normalizeImages(product);
    return {
      index,
      ref: product.product_ref || null,
      missingHero: !product.image_url,
      nonCloudinary: images.filter((url) => !isCloudinaryUrl(url)),
      fetchProxy: images.filter(isCloudinaryFetchProxy),
      malformed: images.filter((url) => { try { new URL(url); return false; } catch { return true; } }),
    };
  });
  return {
    totalProducts: products.length,
    totalImages: allImages.length,
    uniqueImages: new Set(allImages).size,
    duplicateImageRefs: allImages.length - new Set(allImages).size,
    missingHero: rows.filter((r) => r.missingHero),
    nonCloudinary: rows.flatMap((r) => r.nonCloudinary.map((url) => ({ index: r.index, ref: r.ref, url }))),
    fetchProxy: rows.flatMap((r) => r.fetchProxy.map((url) => ({ index: r.index, ref: r.ref, url }))),
    malformed: rows.flatMap((r) => r.malformed.map((url) => ({ index: r.index, ref: r.ref, url }))),
    targetShortfall: target ? Math.max(0, target - products.length) : 0,
  };
}

async function auditCatalogue(options) {
  if (!fs.existsSync(options.manifest)) {
    throw new Error(`Manifest Cloudinary absent: ${options.manifest}. Lancer d'abord prepare.`);
  }
  const products = readProductList(options.manifest);
  assertCuratedSource(products);
  const report = staticAudit(products, options.target);
  report.file = options.manifest;
  if (options.network) {
    const urls = [...new Set(products.flatMap(normalizeImages))];
    const checks = await pooledMap(urls, options.concurrency, async (url) => ({ url, ...(await verifyImageUrl(url)) }));
    report.networkFailures = checks.filter((entry) => !entry.ok);
  } else report.networkFailures = [];

  console.log(JSON.stringify({
    file: options.manifest,
    products: report.totalProducts,
    images: report.totalImages,
    unique_images: report.uniqueImages,
    duplicate_refs: report.duplicateImageRefs,
    missing_hero: report.missingHero.length,
    non_cloudinary: report.nonCloudinary.length,
    cloudinary_fetch_proxy: report.fetchProxy.length,
    malformed: report.malformed.length,
    network_failures: report.networkFailures.length,
    network_failure_samples: report.networkFailures.slice(0, 5),
    target_shortfall: report.targetShortfall,
  }, null, 2));

  const errors = [
    ...report.missingHero.map((v) => `missing hero #${v.index}`),
    ...report.nonCloudinary.map((v) => `non-cloudinary ${v.url}`),
    ...report.fetchProxy.map((v) => `cloudinary fetch proxy ${v.url}`),
    ...report.malformed.map((v) => `malformed ${v.url}`),
    ...report.networkFailures.map((v) => `network ${v.url}: ${v.reason || v.status}`),
  ];
  if (report.targetShortfall > 0) errors.push(`target shortfall: ${report.targetShortfall}`);
  if (options.strict && errors.length) {
    throw new Error(`Audit strict en échec (${errors.length})\n${errors.slice(0, 20).map((v) => `  - ${v}`).join('\n')}`);
  }
  return report;
}

async function seedCatalogue(options) {
  if (!options.replaceActive) throw new Error('seed exige --replace-active (action destructive explicite)');
  if (process.env.NODE_ENV === 'production' || process.env.KOMERCE_ENV === 'production') {
    throw new Error('REFUS: showcase seed interdit en production');
  }
  if (process.env.KOMERCE_ALLOW_SHOWCASE_SEED !== '1') {
    throw new Error('KOMERCE_ALLOW_SHOWCASE_SEED=1 requis pour modifier le catalogue staging');
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL requis');
  if (!fs.existsSync(options.manifest)) throw new Error(`Manifest absent: ${options.manifest}`);

  const allProducts = readProductList(options.manifest);
  assertCuratedSource(allProducts);
  const target = resolveTarget(allProducts, options.target);
  const products = allProducts.slice(0, target);
  const report = staticAudit(products, target);
  if (report.missingHero.length || report.nonCloudinary.length || report.fetchProxy.length || report.malformed.length || report.targetShortfall) {
    throw new Error('Manifest non canonique: lancer audit --network --strict avant seed');
  }

  const db = require('../db');
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const deactivated = await client.query(
      `UPDATE products SET is_active=FALSE, is_available=FALSE, updated_at=NOW()
        WHERE is_active=TRUE AND COALESCE(product_ref,'') NOT LIKE 'GOLDEN-%'`
    );
    console.log(`[showcase] ${deactivated.rowCount} produits actifs désactivés; GOLDEN-* préservés`);

    for (let offset = 0; offset < products.length; offset += BATCH_SIZE) {
      const batch = products.slice(offset, offset + BATCH_SIZE);
      const values = [];
      const placeholders = [];
      let p = 1;
      for (const product of batch) {
        placeholders.push(`($${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++}::jsonb,$${p++},TRUE,TRUE,$${p++})`);
        values.push(
          product.product_ref,
          product.name,
          product.description,
          product.category,
          product.subcategory,
          product.price_kmf,
          product.promo_pct || null,
          product.image_url,
          JSON.stringify(product.images || [product.image_url]),
          product.stock,
          product.sort_order || offset,
        );
      }
      await client.query(
        `INSERT INTO products
           (product_ref,name,description,category,subcategory,price_kmf,promo_pct,image_url,images,stock,is_active,is_available,sort_order)
         VALUES ${placeholders.join(',')}
         ON CONFLICT (product_ref) DO UPDATE SET
           name=EXCLUDED.name, description=EXCLUDED.description, category=EXCLUDED.category,
           subcategory=EXCLUDED.subcategory, price_kmf=EXCLUDED.price_kmf, promo_pct=EXCLUDED.promo_pct,
           image_url=EXCLUDED.image_url, images=EXCLUDED.images, stock=EXCLUDED.stock,
           is_active=TRUE, is_available=TRUE, sort_order=EXCLUDED.sort_order, updated_at=NOW()`,
        values,
      );
    }

    const refs = products.map((product) => product.product_ref);
    const { rows: [count] } = await client.query(
      `SELECT COUNT(*)::int AS count
         FROM products
        WHERE is_active=TRUE
          AND product_ref = ANY($1::text[])`,
      [refs]
    );
    if (count.count !== products.length) throw new Error(`Post-seed mismatch: attendu ${products.length}, obtenu ${count.count}`);
    await client.query('COMMIT');
    console.log(`[showcase] COMMIT — ${count.count} produits curatés actifs`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.command === 'source') await buildSourceManifest(options);
  else if (options.command === 'prepare') await prepareCatalogue(options);
  else if (options.command === 'audit') await auditCatalogue(options);
  else if (options.command === 'seed') await seedCatalogue(options);
  else throw new Error(`Commande inconnue: ${options.command}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[showcase-catalog] échec:', error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_CURATED_INPUT,
  BLOCKED_LEGACY_INPUT,
  parseArgs,
  readProductList,
  resolveTarget,
  assertCuratedSource,
  roundKmf,
  stableInt,
  isCloudinaryUrl,
  isCanonicalCloudinaryUpload,
  isCloudinaryFetchProxy,
  normalizeImages,
  localizeTitle,
  mapDummyProduct,
  mapPlatziProduct,
  cloudinarySignature,
  staticAudit,
  verifyImageUrl,
  collectSourceProducts,
  prepareCatalogue,
  auditCatalogue,
  seedCatalogue,
};