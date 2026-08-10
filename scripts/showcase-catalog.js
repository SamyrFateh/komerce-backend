#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          staging-showcase-catalog-tool
 * @domain        catalog
 * @layer         script
 * @criticality   low
 * @inputs        DummyJSON, Platzi Fake Store, Wikimedia Commons, Cloudinary, DATABASE_URL
 * @outputs       source manifest, Cloudinary manifest, staging products
 * @depends       db.js, Node fetch/FormData/crypto/fs/path
 * @used-by       staging showcase preparation, realistic boutique/E2E testing
 * @db-read       products
 * @db-write      products
 * @db-txn        yes (seed command)
 * @doctrine      DOCTRINE_CATALOGUE.md, staging-only realistic fixtures
 * @version       2026-08-v2
 *
 * SHOWCASE V1 — catalogue staging reproductible, vitrine + tests réalistes.
 *
 * Le vieux seed de 467 produits n'est PLUS une source média : son cloud
 * Cloudinary historique dloffvvdz répond 401. On reconstruit donc le pool
 * depuis des sources publiques distinctes, puis on réhéberge les assets dans
 * le Cloudinary staging courant avant tout seed DB.
 *
 * Commandes :
 *   node scripts/showcase-catalog.js source --target 500 --network --strict
 *   node scripts/showcase-catalog.js prepare --target 500
 *   node scripts/showcase-catalog.js audit --target 500 --network --strict
 *   KOMERCE_ALLOW_SHOWCASE_SEED=1 DATABASE_URL=... \
 *     node scripts/showcase-catalog.js seed --target 500 --replace-active
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_TARGET = 500;
const DEFAULT_SOURCE_MANIFEST = path.join(ROOT, 'data', 'catalogue-test-raw', 'showcase-catalog-v1-source.json');
const DEFAULT_MANIFEST = path.join(ROOT, 'data', 'catalogue-test-raw', 'showcase-catalog-v1.json');
const LEGACY_INPUT = path.join(ROOT, 'db', 'seed-products-v2.json');
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
  Mode: 'Sélection mode pour le quotidien, choisie pour sa présentation et sa polyvalence.',
  Beauté: 'Produit beauté de démonstration pour tester une fiche catalogue riche et lisible.',
  Tech: 'Produit tech de démonstration pour éprouver prix, médias, recherche et navigation.',
  Maison: 'Article maison de démonstration, utile pour tester une vitrine catalogue dense.',
  Enfant: 'Article enfant de démonstration pour tester le rendu et la navigation par rayon.',
  Sport: 'Article sport de démonstration pour tester filtres, cartes produit et parcours d’achat.',
});

function parseArgs(argv) {
  const out = {
    command: 'audit',
    target: DEFAULT_TARGET,
    input: LEGACY_INPUT,
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
  if (!Number.isInteger(out.target) || out.target < 1 || out.target > 1000) {
    throw new Error('--target doit être un entier entre 1 et 1000');
  }
  if (!Number.isInteger(out.concurrency) || out.concurrency < 1 || out.concurrency > 25) {
    throw new Error('--concurrency doit être un entier entre 1 et 25');
  }
  return out;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
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
  return value.slice(0, 120) || 'Produit Komerce';
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

function normalizeSeedProduct(product, index) {
  const images = normalizeImages(product);
  return {
    product_ref: `SHOWCASE-V1-${String(index + 1).padStart(4, '0')}`,
    name: String(product.name || `Produit ${index + 1}`).trim(),
    description: String(product.description_fr || product.description || product.name || '').trim(),
    category: String(product.category || 'Maison').trim(),
    subcategory: product.subcategory ? String(product.subcategory).trim() : null,
    price_kmf: roundKmf(product.price_kmf),
    promo_pct: Number.isFinite(Number(product.promo_pct)) ? Number(product.promo_pct) : null,
    image_url: images[0] || null,
    images,
    sort_order: index,
    source: 'seed-products-v2',
  };
}

function decorateProduct(product, index) {
  const ref = `SHOWCASE-V1-${String(index + 1).padStart(4, '0')}`;
  const name = localizeTitle(product.name);
  const category = product.category || 'Maison';
  const promoSeed = stableInt(`${product.source}:promo`, 0, 99);
  return {
    ...product,
    product_ref: ref,
    name,
    description: cleanDescription(product.description, category, name),
    price_kmf: roundKmf(product.price_kmf || stableInt(product.source, 1500, 85000)),
    promo_pct: product.promo_pct ?? (promoSeed < 28 ? stableInt(`${product.source}:pct`, 8, 45) : null),
    stock: stableInt(`${product.source}:stock`, 2, 70),
    sort_order: index,
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
  const response = await fetch(url, { headers: { 'User-Agent': 'KomerceShowcaseBuilder/2.0' }, redirect: 'follow' });
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
      const rows = await fetchCommons(query, category, subcategory, 35);
      pool.push(...rows);
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
    distinct.push(decorateProduct(product, distinct.length));
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
      headers: { Accept: 'image/avif,image/webp,image/*,*/*;q=0.8', 'User-Agent': 'KomerceShowcaseAudit/2.0' },
      redirect: 'follow',
      signal: controller.signal,
    });
    const type = response.headers.get('content-type') || '';
    const reader = response.body?.getReader?.();
    const firstChunk = reader ? await reader.read() : { value: null };
    if (reader) await reader.cancel().catch(() => {});
    const sampledBytes = firstChunk.value?.byteLength || 0;
    return {
      ok: response.ok && type.startsWith('image/') && sampledBytes > 64,
      status: response.status,
      type,
      bytes: sampledBytes,
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
  const pool = await collectSourceProducts(options.target);
  console.log(`[showcase] pool source brut: ${pool.length}`);
  const valid = options.network ? await verifySourcePool(pool, options.concurrency) : pool;
  const selected = valid.slice(0, options.target).map((product, index) => decorateProduct(product, index));
  writeJson(options.sourceManifest, selected);
  console.log(`[showcase] source manifest: ${selected.length}/${options.target} -> ${options.sourceManifest}`);
  if (options.strict && selected.length < options.target) {
    throw new Error(`Source pool insuffisant: ${selected.length}/${options.target} médias valides`);
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
  const source = fs.existsSync(options.sourceManifest)
    ? readJson(options.sourceManifest)
    : await buildSourceManifest({ ...options, network: true, strict: true });
  if (source.length < options.target) throw new Error(`Source manifest sous cible: ${source.length}/${options.target}`);

  const uploaded = [];
  for (const product of source.slice(0, options.target)) {
    const row = await uploadProductMedia(product);
    uploaded.push(row);
    if (uploaded.length % 25 === 0) console.log(`[showcase] Cloudinary ${uploaded.length}/${options.target}`);
  }
  writeJson(options.manifest, uploaded);
  console.log(`[showcase] Cloudinary manifest: ${uploaded.length} -> ${options.manifest}`);
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
  const file = fs.existsSync(options.manifest) ? options.manifest : options.input;
  const products = readJson(file);
  const report = staticAudit(products, options.target);
  report.file = file;
  if (options.network) {
    const urls = [...new Set(products.flatMap(normalizeImages))];
    const checks = await pooledMap(urls, options.concurrency, async (url) => ({ url, ...(await verifyImageUrl(url)) }));
    report.networkFailures = checks.filter((entry) => !entry.ok);
  } else report.networkFailures = [];

  console.log(JSON.stringify({
    file,
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

  const products = readJson(options.manifest).slice(0, options.target);
  const report = staticAudit(products, options.target);
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
          product.description || product.name,
          product.category,
          product.subcategory || null,
          product.price_kmf,
          product.promo_pct || null,
          product.image_url,
          JSON.stringify(product.images || [product.image_url]),
          product.stock || 10,
          product.sort_order || 0,
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

    const { rows: [count] } = await client.query(
      `SELECT COUNT(*)::int AS count FROM products WHERE is_active=TRUE AND product_ref LIKE 'SHOWCASE-V1-%'`
    );
    if (count.count !== products.length) throw new Error(`Post-seed mismatch: attendu ${products.length}, obtenu ${count.count}`);
    await client.query('COMMIT');
    console.log(`[showcase] COMMIT — ${count.count} produits showcase actifs`);
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
  parseArgs,
  roundKmf,
  stableInt,
  isCloudinaryUrl,
  isCanonicalCloudinaryUpload,
  isCloudinaryFetchProxy,
  normalizeImages,
  normalizeSeedProduct,
  localizeTitle,
  mapDummyProduct,
  mapPlatziProduct,
  cloudinarySignature,
  staticAudit,
  verifyImageUrl,
  collectSourceProducts,
};
