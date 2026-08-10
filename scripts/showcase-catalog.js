#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          staging-showcase-catalog-tool
 * @domain        catalog
 * @layer         script
 * @criticality   low
 * @inputs        db/seed-products-v2.json, DummyJSON, Cloudinary, DATABASE_URL
 * @outputs       showcase manifest, staging products
 * @depends       db.js, Node fetch/FormData/crypto/fs/path
 * @used-by       staging showcase preparation, realistic boutique/E2E testing
 * @db-read       products
 * @db-write      products
 * @db-txn        yes (seed command)
 * @doctrine      DOCTRINE_CATALOGUE.md, staging-only realistic fixtures
 * @version       2026-08-v1
 *
 * Build a deterministic, display-quality staging catalogue from the existing
 * 467-product Cloudinary seed plus a small external supplement mirrored into
 * Cloudinary. The default target is 500 products.
 *
 * Commands:
 *   node scripts/showcase-catalog.js prepare --target 500
 *   node scripts/showcase-catalog.js audit --network --strict
 *   KOMERCE_ALLOW_SHOWCASE_SEED=1 DATABASE_URL=... \
 *     node scripts/showcase-catalog.js seed --replace-active
 *
 * Production is explicitly refused by the seed command.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_INPUT = path.join(ROOT, 'db', 'seed-products-v2.json');
const DEFAULT_MANIFEST = path.join(ROOT, 'data', 'catalogue-test-raw', 'showcase-catalog-v1.json');
const DEFAULT_TARGET = 500;
const SOURCE_URL = 'https://dummyjson.com/products?limit=100&skip=0';
const CLOUDINARY_HOST = 'res.cloudinary.com';
const CLOUDINARY_CANONICAL_PATH = '/image/upload/';
const CLOUDINARY_FETCH_PATH = '/image/fetch/';
const BATCH_SIZE = 50;

function parseArgs(argv) {
  const out = {
    command: 'audit',
    target: DEFAULT_TARGET,
    input: DEFAULT_INPUT,
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

function isCloudinaryUrl(url) {
  try { return new URL(url).hostname === CLOUDINARY_HOST; }
  catch { return false; }
}

function isCanonicalCloudinaryUpload(url) {
  try {
    const u = new URL(url);
    return u.hostname === CLOUDINARY_HOST && u.pathname.includes(CLOUDINARY_CANONICAL_PATH);
  } catch {
    return false;
  }
}

function isCloudinaryFetchProxy(url) {
  try {
    const u = new URL(url);
    return u.hostname === CLOUDINARY_HOST && u.pathname.includes(CLOUDINARY_FETCH_PATH);
  } catch {
    return false;
  }
}

function normalizeImages(product) {
  let images = product.images;
  if (typeof images === 'string') {
    try { images = JSON.parse(images); }
    catch { images = []; }
  }
  if (!Array.isArray(images)) images = [];
  const candidates = [product.image_url, ...images]
    .map((v) => String(v || '').trim())
    .filter(Boolean);
  return [...new Set(candidates)];
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

const TITLE_REPLACEMENTS = [
  [/\bsmartphone\b/gi, 'smartphone'],
  [/\bphone\b/gi, 'téléphone'],
  [/\blaptop\b/gi, 'ordinateur portable'],
  [/\btablet\b/gi, 'tablette'],
  [/\bshoes\b/gi, 'chaussures'],
  [/\bdress\b/gi, 'robe'],
  [/\bwatch\b/gi, 'montre'],
  [/\bperfume\b/gi, 'parfum'],
  [/\bfragrance\b/gi, 'parfum'],
  [/\bbag\b/gi, 'sac'],
  [/\bshirt\b/gi, 'chemise'],
  [/\bcream\b/gi, 'crème'],
  [/\blipstick\b/gi, 'rouge à lèvres'],
  [/\bchair\b/gi, 'chaise'],
  [/\btable\b/gi, 'table'],
];

function localizeTitle(title) {
  let value = String(title || '').trim();
  for (const [pattern, replacement] of TITLE_REPLACEMENTS) {
    value = value.replace(pattern, replacement);
  }
  return value || 'Produit Komerce';
}

function mapDummyProduct(product, index) {
  const mapped = DUMMY_CATEGORY_MAP.get(product.category);
  if (!mapped) return null;
  const [category, subcategory] = mapped;
  const discount = Number(product.discountPercentage);
  const images = [...new Set([product.thumbnail, ...(product.images || [])].filter(Boolean))].slice(0, 3);
  return {
    product_ref: `SHOWCASE-V1-${String(index + 1).padStart(4, '0')}`,
    name: localizeTitle(product.title),
    description: String(product.description || product.title || '').trim(),
    category,
    subcategory,
    price_kmf: roundKmf(Number(product.price) * 500),
    promo_pct: Number.isFinite(discount) && discount >= 5 ? Math.min(80, Math.round(discount)) : null,
    image_url: images[0] || null,
    images,
    sort_order: index,
    source: `dummyjson:${product.id}`,
  };
}

async function pooledMap(items, concurrency, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length || 1) }, worker));
  return results;
}

async function verifyImageUrl(url, timeoutMs = 10000) {
  if (!url) return { ok: false, reason: 'missing-url' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Range: 'bytes=0-4095', 'User-Agent': 'KomerceShowcaseAudit/1.0' },
      redirect: 'follow',
      signal: controller.signal,
    });
    const type = response.headers.get('content-type') || '';
    const contentRange = response.headers.get('content-range') || '';
    const contentLength = Number(response.headers.get('content-length')) || 0;
    const totalFromRange = Number((/\/(\d+)$/.exec(contentRange) || [])[1]) || 0;
    const estimatedBytes = totalFromRange || contentLength;
    const reader = response.body?.getReader?.();
    const firstChunk = reader ? await reader.read() : { value: null };
    if (reader) await reader.cancel().catch(() => {});
    const sampledBytes = firstChunk.value?.byteLength || 0;
    const statusOk = response.ok || response.status === 206;
    const contentOk = type.startsWith('image/') && Math.max(estimatedBytes, sampledBytes) > 512;
    return {
      ok: statusOk && contentOk,
      status: response.status,
      type,
      bytes: estimatedBytes || sampledBytes,
    };
  } catch (error) {
    return { ok: false, reason: error.name === 'AbortError' ? 'timeout' : error.message };
  } finally {
    clearTimeout(timer);
  }
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
  const signature = cloudinarySignature(params, apiSecret);
  const form = new FormData();
  form.set('file', remoteUrl);
  form.set('api_key', apiKey);
  form.set('timestamp', String(timestamp));
  form.set('folder', folder);
  form.set('public_id', publicId);
  form.set('overwrite', 'true');
  form.set('signature', signature);

  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
    method: 'POST',
    body: form,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.secure_url) {
    throw new Error(`Cloudinary upload failed (${response.status}): ${body.error?.message || 'unknown error'}`);
  }
  return body.secure_url;
}

async function canonicalizeExternalProduct(product, index) {
  const ref = product.product_ref || `SHOWCASE-V1-${String(index + 1).padStart(4, '0')}`;
  const folder = `komerce/staging/showcase-v1/${ref.toLowerCase()}`;
  const sourceImages = normalizeImages(product).slice(0, 3);
  if (!sourceImages.length) throw new Error(`${ref}: aucune image source`);

  const uploaded = [];
  for (let i = 0; i < sourceImages.length; i += 1) {
    uploaded.push(await uploadRemoteImage(sourceImages[i], {
      folder,
      publicId: i === 0 ? 'hero' : `gallery-${String(i).padStart(2, '0')}`,
    }));
  }
  return { ...product, image_url: uploaded[0], images: uploaded };
}

async function fetchDummyProducts() {
  const response = await fetch(SOURCE_URL, { headers: { 'User-Agent': 'KomerceShowcaseBuilder/1.0' } });
  if (!response.ok) throw new Error(`DummyJSON indisponible (${response.status})`);
  const body = await response.json();
  return Array.isArray(body.products) ? body.products : [];
}

async function prepareCatalogue(options) {
  const base = readJson(options.input).map(normalizeSeedProduct);
  console.log(`[showcase] base: ${base.length} produits`);

  const verification = await pooledMap(base, options.concurrency, async (product) => {
    const result = await verifyImageUrl(product.image_url);
    return { product, result };
  });

  const valid = [];
  const toCanonicalize = [];
  let broken = 0;
  for (const entry of verification) {
    if (!entry.result.ok) {
      broken += 1;
      continue;
    }
    if (!isCanonicalCloudinaryUpload(entry.product.image_url) || isCloudinaryFetchProxy(entry.product.image_url)) {
      toCanonicalize.push(entry.product);
      continue;
    }
    valid.push(entry.product);
  }
  console.log(`[showcase] base valide canonique: ${valid.length}; à réhéberger: ${toCanonicalize.length}; cassés: ${broken}`);

  for (const product of toCanonicalize) {
    const canonical = await canonicalizeExternalProduct(product, valid.length);
    canonical.sort_order = valid.length;
    canonical.product_ref = `SHOWCASE-V1-${String(valid.length + 1).padStart(4, '0')}`;
    valid.push(canonical);
  }

  if (valid.length < options.target) {
    const source = await fetchDummyProducts();
    const seenNames = new Set(valid.map((p) => p.name.toLowerCase()));
    for (const raw of source) {
      if (valid.length >= options.target) break;
      const mapped = mapDummyProduct(raw, valid.length);
      if (!mapped || !mapped.image_url) continue;
      if (seenNames.has(mapped.name.toLowerCase())) continue;
      const canonical = await canonicalizeExternalProduct(mapped, valid.length);
      canonical.sort_order = valid.length;
      canonical.product_ref = `SHOWCASE-V1-${String(valid.length + 1).padStart(4, '0')}`;
      valid.push(canonical);
      seenNames.add(canonical.name.toLowerCase());
      console.log(`[showcase] + ${valid.length}/${options.target} ${canonical.name}`);
    }
  }

  if (valid.length < options.target) {
    throw new Error(`Impossible d'atteindre ${options.target}: seulement ${valid.length} produits exploitables`);
  }

  const catalogue = valid.slice(0, options.target).map((product, index) => ({
    ...product,
    product_ref: `SHOWCASE-V1-${String(index + 1).padStart(4, '0')}`,
    sort_order: index,
  }));
  writeJson(options.manifest, catalogue);
  console.log(`[showcase] manifest écrit: ${options.manifest} (${catalogue.length} produits)`);
  return catalogue;
}

function staticAudit(products, target = null) {
  const rows = products.map((product, index) => {
    const images = normalizeImages(product);
    return {
      index,
      ref: product.product_ref || null,
      imageCount: images.length,
      missingHero: !product.image_url,
      nonCloudinary: images.filter((url) => !isCloudinaryUrl(url)),
      fetchProxy: images.filter(isCloudinaryFetchProxy),
      malformed: images.filter((url) => {
        try { new URL(url); return false; } catch { return true; }
      }),
    };
  });
  const allImages = products.flatMap(normalizeImages);
  const uniqueImages = new Set(allImages);
  return {
    totalProducts: products.length,
    totalImages: allImages.length,
    uniqueImages: uniqueImages.size,
    duplicateImageRefs: allImages.length - uniqueImages.size,
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
  } else {
    report.networkFailures = [];
  }

  console.log(JSON.stringify({
    file: report.file,
    products: report.totalProducts,
    images: report.totalImages,
    unique_images: report.uniqueImages,
    duplicate_refs: report.duplicateImageRefs,
    missing_hero: report.missingHero.length,
    non_cloudinary: report.nonCloudinary.length,
    cloudinary_fetch_proxy: report.fetchProxy.length,
    malformed: report.malformed.length,
    network_failures: report.networkFailures.length,
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
    const preview = errors.slice(0, 20).map((line) => `  - ${line}`).join('\n');
    throw new Error(`Audit strict en échec (${errors.length})\n${preview}`);
  }
  return report;
}

async function seedCatalogue(options) {
  if (!options.replaceActive) {
    throw new Error('seed exige --replace-active (action destructive explicite)');
  }
  if (process.env.NODE_ENV === 'production' || process.env.KOMERCE_ENV === 'production') {
    throw new Error('REFUS: showcase seed interdit en production');
  }
  if (process.env.KOMERCE_ALLOW_SHOWCASE_SEED !== '1') {
    throw new Error('KOMERCE_ALLOW_SHOWCASE_SEED=1 requis pour modifier le catalogue staging');
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL requis');
  if (!fs.existsSync(options.manifest)) throw new Error(`Manifest absent: ${options.manifest}`);

  const products = readJson(options.manifest);
  const report = staticAudit(products, options.target);
  if (report.missingHero.length || report.nonCloudinary.length || report.fetchProxy.length || report.malformed.length) {
    throw new Error('Manifest non canonique: lancer audit --strict avant seed');
  }

  const db = require('../db');
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const deactivated = await client.query(
      `UPDATE products
          SET is_active = FALSE, is_available = FALSE, updated_at = NOW()
        WHERE is_active = TRUE
          AND COALESCE(product_ref, '') NOT LIKE 'GOLDEN-%'`
    );
    console.log(`[showcase] ${deactivated.rowCount} produits actifs désactivés (fixtures GOLDEN préservées)`);

    for (let offset = 0; offset < products.length; offset += BATCH_SIZE) {
      const batch = products.slice(offset, offset + BATCH_SIZE);
      const values = [];
      const placeholders = [];
      let p = 1;
      for (const product of batch) {
        placeholders.push(`($${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++}::jsonb,TRUE,TRUE,$${p++})`);
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
          product.sort_order || 0,
        );
      }
      await client.query(
        `INSERT INTO products
           (product_ref, name, description, category, subcategory, price_kmf,
            promo_pct, image_url, images, is_active, is_available, sort_order)
         VALUES ${placeholders.join(',')}
         ON CONFLICT (product_ref) DO UPDATE SET
           name = EXCLUDED.name,
           description = EXCLUDED.description,
           category = EXCLUDED.category,
           subcategory = EXCLUDED.subcategory,
           price_kmf = EXCLUDED.price_kmf,
           promo_pct = EXCLUDED.promo_pct,
           image_url = EXCLUDED.image_url,
           images = EXCLUDED.images,
           is_active = TRUE,
           is_available = TRUE,
           sort_order = EXCLUDED.sort_order,
           updated_at = NOW()`,
        values,
      );
    }

    const { rows: [count] } = await client.query(
      `SELECT COUNT(*)::int AS count
         FROM products
        WHERE is_active = TRUE AND product_ref LIKE 'SHOWCASE-V1-%'`
    );
    if (count.count !== products.length) {
      throw new Error(`Post-seed mismatch: attendu ${products.length}, obtenu ${count.count}`);
    }
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
  if (options.command === 'prepare') await prepareCatalogue(options);
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
  isCloudinaryUrl,
  isCanonicalCloudinaryUpload,
  isCloudinaryFetchProxy,
  normalizeImages,
  normalizeSeedProduct,
  localizeTitle,
  mapDummyProduct,
  cloudinarySignature,
  staticAudit,
};
