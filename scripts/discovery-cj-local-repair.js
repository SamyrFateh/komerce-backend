#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          discovery-cj-local-repair
 * @domain        recommendations
 * @layer         tooling
 * @criticality   high
 * @inputs        DATABASE_URL, DISCOVERY_CJ_LOCAL_REPAIR_ENABLED, market KM
 * @outputs       7 real CJ products exposed in local_stock + canonical Discovery candidates
 * @depends       db.js, services/local-stock-service.js, services/catalog-public-view.js, scripts/cj-real-showcase-seed.js
 * @used-by       bounded GitHub/Railway operator run
 * @db-read       markets, products, local_stock
 * @db-write-via:local-stock-service local_stock
 * @db-txn        local-stock owner mutations
 * @doctrine      docs/doctrine/DOCTRINE_DISCOVERY_LOCALE_UNIFIEE.md, docs/doctrine/DOCTRINE_CATALOGUE.md
 * @impact-areas  discovery-rail, local-stock, product-discovery, category-navigation
 * @version       2026-09-v1
 */
'use strict';

const db = require('../db');
const { setLocalStock, setLocalStockExposure } = require('../services/local-stock-service');
const { publicCatalogVisibilitySql } = require('../services/catalog-public-view');
const { slotSortOrder } = require('./cj-real-showcase-seed');

const MARKET_CODE = 'KM';
const LOCATION = 'KM_MAIN';
const FLAG = 'DISCOVERY_CJ_LOCAL_REPAIR_ENABLED';
const SUPPLIER = 'CJdropshipping';
const GOLDEN_PRODUCT_ID = 'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaa0001';

// Sept représentants CJ réels couvrent les six univers publics. Mode & Beauté
// en a volontairement deux afin de conserver les huit Products de la grille
// Discovery historique avec le Golden Product.
const CJ_LOCAL_PRODUCTS = Object.freeze([
  Object.freeze({ family: 'women',     sortOrder: slotSortOrder(0, 0),  qtyPhysical: 18 }),
  Object.freeze({ family: 'beauty',    sortOrder: slotSortOrder(3, 0),  qtyPhysical: 16 }),
  Object.freeze({ family: 'comfort',   sortOrder: slotSortOrder(4, 0),  qtyPhysical: 14 }),
  Object.freeze({ family: 'phones',    sortOrder: slotSortOrder(8, 0),  qtyPhysical: 12 }),
  Object.freeze({ family: 'tools',     sortOrder: slotSortOrder(11, 0), qtyPhysical: 10 }),
  Object.freeze({ family: 'ceremony',  sortOrder: slotSortOrder(14, 0), qtyPhysical: 9 }),
  Object.freeze({ family: 'filters',   sortOrder: slotSortOrder(17, 0), qtyPhysical: 11 }),
]);

const PHYSICAL_OFFERS = Object.freeze({
  SAMBOUSSAS: 'd15c1000-0000-4000-8000-000000000001',
  CIMENT: 'd15c1000-0000-4000-8000-000000000003',
});

const SERVICES = Object.freeze({
  CLIMATISEUR: 'd15c2000-0000-4000-8000-000000000007',
  PLOMBERIE: 'd15c2000-0000-4000-8000-000000000002',
});

function isEnabled() {
  return ['1', 'true', 'yes'].includes(String(process.env[FLAG] || '').trim().toLowerCase());
}

function assertRuntime() {
  if (!isEnabled()) throw new Error(`${FLAG}=1 requis`);
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL requis');
}

async function resolveMarket() {
  const { rows: [market] } = await db.query(
    'SELECT id FROM markets WHERE code = $1 AND is_active = true LIMIT 1',
    [MARKET_CODE]
  );
  if (!market) throw new Error(`Marché ${MARKET_CODE} actif introuvable`);
  return market.id;
}

async function resolveCjProducts() {
  const sortOrders = CJ_LOCAL_PRODUCTS.map(item => item.sortOrder);
  const { rows } = await db.query(
    `SELECT p.id, p.product_ref, p.sort_order, p.category, p.subcategory, p.image_url
       FROM products p
      WHERE p.sourcing_source = $1
        AND p.sort_order = ANY($2::int[])
        AND p.is_available = TRUE
        AND ${publicCatalogVisibilitySql('p')}`,
    [SUPPLIER, sortOrders]
  );

  const bySortOrder = new Map(rows.map(row => [Number(row.sort_order), row]));
  const resolved = CJ_LOCAL_PRODUCTS.map(config => {
    const row = bySortOrder.get(config.sortOrder);
    if (!row) {
      throw new Error(`Représentant CJ local introuvable: ${config.family} sort_order=${config.sortOrder}`);
    }
    if (!/^https:\/\//i.test(String(row.image_url || ''))) {
      throw new Error(`Média fournisseur CJ invalide: ${row.product_ref}`);
    }
    return { ...config, ...row };
  });

  if (resolved.length !== CJ_LOCAL_PRODUCTS.length) {
    throw new Error(`Plan CJ local incomplet: ${resolved.length}/${CJ_LOCAL_PRODUCTS.length}`);
  }
  return resolved;
}

async function exposeCjProducts(marketId, products) {
  for (const product of products) {
    await setLocalStock({
      productId: product.id,
      marketId,
      location: LOCATION,
      qtyPhysical: product.qtyPhysical,
    });
    await setLocalStockExposure(product.id, marketId, 'ENABLED', LOCATION);
  }
}

function buildCandidates(products) {
  const p = products.map(product => `product:${product.id}`);
  const golden = `product:${GOLDEN_PRODUCT_ID}`;
  return [
    golden,
    p[0],
    `physical_offer:${PHYSICAL_OFFERS.SAMBOUSSAS}@Maison`,
    p[2],
    p[3],
    `service:${SERVICES.CLIMATISEUR}@Maison|Tech`,
    p[4],
    p[5],
    `physical_offer:${PHYSICAL_OFFERS.CIMENT}@Bricolage`,
    p[6],
    p[1],
    `service:${SERVICES.PLOMBERIE}@Maison|Bricolage`,
  ].filter(Boolean);
}

async function audit(marketId, products) {
  const ids = products.map(product => product.id);
  const { rows } = await db.query(
    `SELECT p.id, p.product_ref, p.category, p.image_url,
            ls.qty_physical, ls.commercial_exposure
       FROM local_stock ls
       JOIN products p ON p.id = ls.product_id
      WHERE ls.market_id = $1
        AND ls.location = $2
        AND p.id = ANY($3::uuid[])
      ORDER BY p.sort_order`,
    [marketId, LOCATION, ids]
  );

  const valid = rows.filter(row =>
    row.commercial_exposure === 'ENABLED'
    && Number(row.qty_physical) > 0
    && /^https:\/\//i.test(String(row.image_url || ''))
    && !String(row.product_ref || '').toUpperCase().startsWith('SHOWCASE-V2-')
  );
  if (valid.length !== CJ_LOCAL_PRODUCTS.length) {
    throw new Error(`Audit Discovery CJ local refusé: valid=${valid.length}/${CJ_LOCAL_PRODUCTS.length}`);
  }

  return {
    market: MARKET_CODE,
    cj_local: valid.length,
    product_refs: valid.map(row => row.product_ref),
    categories: [...new Set(valid.map(row => row.category).filter(Boolean))],
    real_https_media: valid.filter(row => /^https:\/\//i.test(String(row.image_url || ''))).length,
  };
}

async function main() {
  assertRuntime();
  const marketId = await resolveMarket();
  const products = await resolveCjProducts();
  await exposeCjProducts(marketId, products);
  const proof = await audit(marketId, products);
  const candidates = buildCandidates(products);

  if (candidates.length !== 12) throw new Error(`Plan Discovery invalide: ${candidates.length}/12`);

  console.log(`[discovery-cj-local] SUCCESS ${JSON.stringify(proof)}`);
  console.log(`DISCOVERY_RAIL_CANDIDATES=${candidates.join(',')}`);
  return { proof, candidates };
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch(err => {
      console.error(`[discovery-cj-local] FAILED: ${err.stack || err.message || err}`);
      process.exit(1);
    })
    .finally(() => db.pool.end());
}

module.exports = {
  FLAG,
  MARKET_CODE,
  LOCATION,
  CJ_LOCAL_PRODUCTS,
  PHYSICAL_OFFERS,
  SERVICES,
  isEnabled,
  resolveMarket,
  resolveCjProducts,
  exposeCjProducts,
  buildCandidates,
  audit,
  main,
};
