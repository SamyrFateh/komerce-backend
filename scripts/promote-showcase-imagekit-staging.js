#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          staging-showcase-imagekit-promoter
 * @domain        catalog
 * @layer         script
 * @criticality   medium
 * @inputs        curated V1+V2 catalogue, ImageKit, DATABASE_URL, canonical markets
 * @outputs       hosted global products, market exposures, local price drafts
 * @depends       db.js, scripts/showcase-imagekit-v2.js, scripts/showcase-media-provider.js, scripts/seed-market-test-data.js, middleware/require-non-production.js
 * @used-by       staging catalogue acceptance before E2E scenarios
 * @db-read       markets, products
 * @db-write      products, product_market_exposure, product_market_price_drafts
 * @db-txn        yes (product upsert + final retirement are isolated transactions)
 * @doctrine      media proof precedes DB mutation; market exposure precedes legacy retirement
 * @version       2026-09-v1
 */
'use strict';

const fs = require('fs');
const db = require('../db');
const { resolveRuntimeEnvironment } = require('../middleware/require-non-production');
const {
  DEFAULT_TARGET,
  DEFAULT_MANIFEST,
  NAMESPACE,
  MEDIA_PROVIDER,
  prepare,
  audit,
} = require('./showcase-imagekit-v2');
const { normalizeImages } = require('./showcase-catalog');
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

function parseArgs(argv) {
  const out = {
    command: null,
    target: DEFAULT_TARGET,
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
    else if (key === '--manifest') out.manifest = require('path').resolve(next());
    else if (key === '--markets') out.markets = parseMarketCodes(next());
    else if (key === '--concurrency') out.concurrency = Number.parseInt(next(), 10);
    else if (arg === '--replace-active') out.replaceActive = true;
    else throw new Error(`Argument inconnu: ${arg}`);
  }

  if (out.command !== 'promote') throw new Error('Commande requise: promote');
  if (!out.replaceActive) throw new Error('promote exige --replace-active (retrait explicite de l’ancien catalogue actif)');
  if (!Number.isInteger(out.target) || out.target < 1 || out.target > DEFAULT_TARGET) {
    throw new Error(`--target doit être un entier entre 1 et ${DEFAULT_TARGET}`);
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
  for (const product of products) {
    if (!/^KPR-\d{6,}$/.test(String(product.product_ref || ''))) {
      throw new Error(`product_ref canonique invalide: ${product.product_ref || '(vide)'}`);
    }
    if (refs.has(product.product_ref)) throw new Error(`product_ref dupliqué: ${product.product_ref}`);
    refs.add(product.product_ref);

    const images = normalizeImages(product);
    if (!images.length || !product.image_url) throw new Error(`${product.product_ref}: hero ImageKit requis`);
    for (const url of images) {
      if (!isCanonicalMediaUrl(url, MEDIA_PROVIDER, NAMESPACE)) {
        throw new Error(`${product.product_ref}: média non ImageKit canonique: ${url}`);
      }
      if (media.has(url)) throw new Error(`${product.product_ref}: média dupliqué: ${url}`);
      media.add(url);
    }
  }
  return { products: products.length, refs: refs.size, images: media.size };
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
        const { rows: upserted } = await client.query(
          `INSERT INTO products
             (product_ref,name,description,category,subcategory,price_kmf,promo_pct,image_url,images,stock,is_active,is_available,sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,TRUE,TRUE,$11)
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
       COUNT(*) FILTER (
         WHERE is_active=TRUE
           AND COALESCE(product_ref,'') NOT LIKE 'GOLDEN-%'
           AND NOT (product_ref = ANY($1::text[]))
       )::int AS unexpected_active
       FROM products`,
    [productRefs],
  );
  if (row.curated_active !== productRefs.length || row.unexpected_active !== 0) {
    throw new Error(`Réconciliation catalogue invalide: curated=${row.curated_active}/${productRefs.length}, unexpected=${row.unexpected_active}`);
  }
  return row;
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
    markets,
    retired_legacy_products: retired,
    curated_active: finalState.curated_active,
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
  parseArgs,
  validateHostedProducts,
  upsertHostedProducts,
  prepareMarkets,
  retireLegacyProducts,
  verifyFinalCatalog,
  promote,
};
