#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          staging-showcase-imagekit-promoter
 * @domain        catalog
 * @layer         script
 * @criticality   medium
 * @inputs        curated showcase catalogue, ImageKit, DATABASE_URL, canonical markets
 * @outputs       hosted global products, market exposures, local price drafts
 * @depends       db.js, scripts/showcase-imagekit-v2.js, scripts/showcase-media-provider.js, scripts/seed-market-test-data.js, middleware/require-non-production.js
 * @used-by       staging catalogue acceptance before E2E scenarios
 * @db-read       markets, products
 * @db-write      products, product_market_exposure, product_market_price_drafts
 * @db-txn        yes (product upsert + final retirement are isolated transactions)
 * @doctrine      media proof precedes DB mutation; market exposure precedes legacy retirement; staging fixtures remain explicit
 * @version       2026-09-v2
 */
'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../db');
const { resolveRuntimeEnvironment } = require('../middleware/require-non-production');
const {
  DEFAULT_TARGET,
  MAX_TARGET,
  DEFAULT_MANIFEST,
  NAMESPACE,
  MEDIA_PROVIDER,
  prepare,
  audit,
} = require('./showcase-imagekit-v2');
const { DEFAULT_CURATED_INPUTS, normalizeImages } = require('./showcase-catalog');
const { isCanonicalMediaUrl } = require('./showcase-media-provider');
const { ensureMarket, prepareProductsForMarket } = require('./seed-market-test-data');

const FLAG = 'KOMERCE_ALLOW_SHOWCASE_SEED';
const DEFAULT_MARKETS = Object.freeze(['KM', 'CM', 'CG']);
const BATCH_SIZE = 50;

function isTruthy(value) {
  return ['1', 'true', 'yes'].includes(String(value || '').trim().toLowerCase());
}

function runtimePromotionGuard() {
  const { env, source } = resolveRuntimeEnvironment();
  const optIn = isTruthy(process.env[FLAG]);
  return { env, source, optIn, allowed: env === 'staging' && optIn };
}

function parseMarketCodes(value) {
  const source = value == null ? DEFAULT_MARKETS : String(value).split(',');
  const codes = source.map((code) => String(code).trim().toUpperCase()).filter(Boolean);
  if (!codes.length) throw new Error('--markets doit contenir au moins un code marché');
  if (codes.some((code) => !/^[A-Z]{2}$/.test(code))) throw new Error('--markets exige des codes ISO alpha-2');
  return [...new Set(codes)];
}

function parseInput(value) {
  if (Array.isArray(value)) return value;
  return String(value || '').split(',').map((entry) => entry.trim()).filter(Boolean).map((entry) => path.resolve(entry));
}

function parseArgs(argv) {
  const out = {
    command: null,
    target: DEFAULT_TARGET,
    input: DEFAULT_CURATED_INPUTS,
    manifest: DEFAULT_MANIFEST,
    markets: [...DEFAULT_MARKETS],
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
    else if (key === '--input') out.input = parseInput(next());
    else if (key === '--manifest') out.manifest = path.resolve(next());
    else if (key === '--markets') out.markets = parseMarketCodes(next());
    else if (key === '--concurrency') out.concurrency = Number.parseInt(next(), 10);
    else if (arg === '--replace-active') out.replaceActive = true;
    else throw new Error(`Argument inconnu: ${arg}`);
  }

  if (out.command !== 'promote') throw new Error('Commande requise: promote');
  if (!out.replaceActive) throw new Error('promote exige --replace-active (retrait explicite de l’ancien catalogue actif)');
  if (!Number.isInteger(out.target) || out.target < 1 || out.target > MAX_TARGET) {
    throw new Error(`--target doit être un entier entre 1 et ${MAX_TARGET}`);
  }
  if (!Number.isInteger(out.concurrency) || out.concurrency < 1 || out.concurrency > 25) {
    throw new Error('--concurrency doit être un entier entre 1 et 25');
  }
  return out;
}

function validateHostedProducts(products, target) {
  if (!Array.isArray(products) || products.length !== target) {
    throw new Error(`Manifest ImageKit incomplet: attendu ${target}, obtenu ${Array.isArray(products) ? products.length : 0}`);
  }
  const refs = new Set();
  const media = new Set();
  let stockUnits = 0;
  for (const product of products) {
    const ref = String(product.product_ref || '');
    if (!/^KPR-\d{6,}$/.test(ref)) throw new Error(`product_ref canonique invalide: ${ref || '(vide)'}`);
    if (refs.has(ref)) throw new Error(`product_ref dupliqué: ${ref}`);
    refs.add(ref);
    if (!String(product.name || '').trim()) throw new Error(`${ref}: nom requis`);
    if (String(product.description || '').trim().length < 24) throw new Error(`${ref}: description curatée requise`);
    if (!String(product.category || '').trim() || !String(product.subcategory || '').trim()) {
      throw new Error(`${ref}: catégorie et sous-catégorie requises`);
    }
    if (!(Number(product.price_kmf) > 0)) throw new Error(`${ref}: prix KMF > 0 requis`);
    if (!Number.isInteger(Number(product.stock)) || Number(product.stock) <= 0) throw new Error(`${ref}: stock entier > 0 requis`);
    stockUnits += Number(product.stock);

    const images = normalizeImages(product);
    if (!images.length || !product.image_url) throw new Error(`${ref}: hero ImageKit requis`);
    for (const url of images) {
      if (!isCanonicalMediaUrl(url, MEDIA_PROVIDER, NAMESPACE)) {
        throw new Error(`${ref}: média non ImageKit canonique: ${url}`);
      }
      if (media.has(url)) throw new Error(`${ref}: média dupliqué: ${url}`);
      media.add(url);
    }
  }
  return { products: products.length, refs: refs.size, images: media.size, stock_units: stockUnits };
}

async function withTransaction(work) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function upsertHostedProducts(products) {
  return withTransaction(async (client) => {
    const rows = [];
    for (let offset = 0; offset < products.length; offset += BATCH_SIZE) {
      const batch = products.slice(offset, offset + BATCH_SIZE);
      for (let index = 0; index < batch.length; index += 1) {
        const product = batch[index];
        const sortOrder = Number.isInteger(Number(product.sort_order)) ? Number(product.sort_order) : offset + index;
        const sourceTitle = String(product.source_title || product.name || '').trim();
        const { rows: upserted } = await client.query(
          `INSERT INTO products
             (product_ref,name,description,category,subcategory,price_kmf,promo_pct,image_url,images,stock,is_active,is_available,sort_order,
              name_source,description_source,source_locale,content_source,quality_validated,needs_review,lifecycle_status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,TRUE,TRUE,$11,$12,$13,'fr','manual',TRUE,FALSE,'active')
           ON CONFLICT (product_ref) DO UPDATE SET
             name=EXCLUDED.name,
             description=EXCLUDED.description,
             category=EXCLUDED.category,
             subcategory=EXCLUDED.subcategory,
             price_kmf=EXCLUDED.price_kmf,
             promo_pct=EXCLUDED.promo_pct,
             image_url=EXCLUDED.image_url,
             images=EXCLUDED.images,
             stock=EXCLUDED.stock,
             is_active=TRUE,
             is_available=TRUE,
             sort_order=EXCLUDED.sort_order,
             name_source=EXCLUDED.name_source,
             description_source=EXCLUDED.description_source,
             source_locale=EXCLUDED.source_locale,
             content_source=EXCLUDED.content_source,
             quality_validated=TRUE,
             needs_review=FALSE,
             lifecycle_status='active',
             updated_at=NOW()
           RETURNING *`,
          [
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
            sortOrder,
            sourceTitle || product.name,
            product.description,
          ],
        );
        rows.push(upserted[0]);
      }
    }
    return rows;
  });
}

async function prepareMarkets(products, marketCodes) {
  const summaries = [];
  for (const code of marketCodes) {
    // Les owners canoniques restent catalog-market-exposure-service et
    // market-commercial-price-service via prepareProductsForMarket().
    // eslint-disable-next-line no-await-in-loop
    const market = await ensureMarket(code);
    // eslint-disable-next-line no-await-in-loop
    const prepared = await prepareProductsForMarket(products, market);
    summaries.push({ code: market.code, currency: market.currency, ...prepared });
  }
  return summaries;
}

async function retireLegacyProducts(productRefs) {
  return withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE products
          SET is_active=FALSE, is_available=FALSE, updated_at=NOW()
        WHERE is_active=TRUE
          AND COALESCE(product_ref,'') NOT LIKE 'GOLDEN-%'
          AND NOT (product_ref = ANY($1::text[]))`,
      [productRefs],
    );
    return result.rowCount;
  });
}

async function verifyFinalCatalog(productRefs) {
  const { rows: [row] } = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE product_ref = ANY($1::text[]) AND is_active=TRUE)::int AS curated_active,
       COUNT(*) FILTER (WHERE product_ref = ANY($1::text[]) AND is_active=TRUE AND stock > 0)::int AS curated_in_stock,
       COALESCE(SUM(stock) FILTER (WHERE product_ref = ANY($1::text[]) AND is_active=TRUE),0)::bigint AS stock_units,
       COUNT(*) FILTER (
         WHERE is_active=TRUE
           AND COALESCE(product_ref,'') NOT LIKE 'GOLDEN-%'
           AND NOT (product_ref = ANY($1::text[]))
       )::int AS unexpected_active
       FROM products`,
    [productRefs],
  );
  if (row.curated_active !== productRefs.length || row.curated_in_stock !== productRefs.length || row.unexpected_active !== 0) {
    throw new Error(`Réconciliation catalogue invalide: curated=${row.curated_active}/${productRefs.length}, in_stock=${row.curated_in_stock}/${productRefs.length}, unexpected=${row.unexpected_active}`);
  }
  return {
    curated_active: Number(row.curated_active),
    curated_in_stock: Number(row.curated_in_stock),
    stock_units: Number(row.stock_units),
    unexpected_active: Number(row.unexpected_active),
  };
}

async function promote(options) {
  const guard = runtimePromotionGuard();
  if (!guard.allowed) {
    throw new Error(`REFUS: promotion showcase autorisée uniquement en staging avec ${FLAG}=1 (env=${guard.env}, source=${guard.source}, optIn=${guard.optIn})`);
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL requis');

  await prepare({
    command: 'prepare',
    target: options.target,
    input: options.input || DEFAULT_CURATED_INPUTS,
    manifest: options.manifest,
    network: false,
    strict: false,
    concurrency: options.concurrency,
  });
  await audit({
    command: 'audit',
    target: options.target,
    manifest: options.manifest,
    network: true,
    strict: true,
    concurrency: options.concurrency,
  });

  const hosted = JSON.parse(fs.readFileSync(options.manifest, 'utf8'));
  const mediaReport = validateHostedProducts(hosted, options.target);
  const products = await upsertHostedProducts(hosted);
  const markets = await prepareMarkets(products, options.markets);
  const refs = products.map((product) => product.product_ref);
  const retired = await retireLegacyProducts(refs);
  const finalState = await verifyFinalCatalog(refs);

  const summary = {
    provider: MEDIA_PROVIDER,
    namespace: NAMESPACE,
    products: mediaReport.products,
    images: mediaReport.images,
    stock_units: finalState.stock_units,
    markets,
    retired_legacy_products: retired,
    curated_active: finalState.curated_active,
    curated_in_stock: finalState.curated_in_stock,
    unexpected_active: finalState.unexpected_active,
  };
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await promote(options);
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[showcase:imagekit:promote] échec:', error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  FLAG,
  DEFAULT_MARKETS,
  isTruthy,
  runtimePromotionGuard,
  parseMarketCodes,
  parseInput,
  parseArgs,
  validateHostedProducts,
  upsertHostedProducts,
  prepareMarkets,
  retireLegacyProducts,
  verifyFinalCatalog,
  promote,
};
