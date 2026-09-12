#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          discovery-cj-local-repair
 * @domain        recommendations
 * @layer         tooling
 * @criticality   high
 * @inputs        DATABASE_URL, DISCOVERY_CJ_LOCAL_REPAIR_ENABLED, market KM
 * @outputs       12 real CJ products exposed in local_stock + canonical Discovery candidates
 * @depends       db.js, services/local-stock-service.js, services/catalog-public-view.js, scripts/cj-real-showcase-seed.js
 * @used-by       bounded GitHub/Railway operator run
 * @db-read       markets, products, local_stock
 * @db-write-via:local-stock-service local_stock
 * @db-txn        local-stock owner mutations
 * @doctrine      docs/doctrine/DOCTRINE_DISCOVERY_LOCALE_UNIFIEE.md, docs/doctrine/DOCTRINE_CATALOGUE.md
 * @impact-areas  discovery-rail, local-stock, product-discovery, category-navigation
 * @version       2026-09-v2
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
const TARGET_CJ_LOCAL = 24;
const TARGET_CANDIDATES = 30;

// Quatre représentants CJ réels par grand univers public (Local Quality V2 :
// 2 produits/univers laissait le rail desktop visuellement pauvre). Le rail
// local reste une sélection éditoriale bornée, pas un miroir intégral des 63
// produits — chaque univers pioche dans les familles déjà seedées par
// cj-real-showcase-seed.js qui correspondent à ses sous-catégories réelles
// (voir SUBCATEGORY_VISUALS dans public/boutique/js/render/category-shelf-visuals.js).
// Là où l'univers n'a que 3 familles distinctes, un second slot d'une famille
// existante complète le 4e représentant plutôt que d'inventer une famille.
const CJ_LOCAL_PRODUCTS = Object.freeze([
  // Mode & Beauté — women, beauty, men, kids
  Object.freeze({ family: 'women',     sortOrder: slotSortOrder(0, 0),  qtyPhysical: 18 }),
  Object.freeze({ family: 'beauty',    sortOrder: slotSortOrder(3, 0),  qtyPhysical: 16 }),
  Object.freeze({ family: 'men',       sortOrder: slotSortOrder(1, 0),  qtyPhysical: 15 }),
  Object.freeze({ family: 'kids',      sortOrder: slotSortOrder(2, 0),  qtyPhysical: 14 }),
  // Maison — comfort, kitchen, decor, kids-home
  Object.freeze({ family: 'comfort',   sortOrder: slotSortOrder(4, 0),  qtyPhysical: 14 }),
  Object.freeze({ family: 'kitchen',   sortOrder: slotSortOrder(5, 0),  qtyPhysical: 13 }),
  Object.freeze({ family: 'decor',     sortOrder: slotSortOrder(6, 0),  qtyPhysical: 12 }),
  Object.freeze({ family: 'kids-home', sortOrder: slotSortOrder(7, 0),  qtyPhysical: 11 }),
  // Tech — phones, audio, watches + 2e slot audio (pas de 4e famille tech dédiée)
  Object.freeze({ family: 'phones',    sortOrder: slotSortOrder(8, 0),  qtyPhysical: 12 }),
  Object.freeze({ family: 'audio',     sortOrder: slotSortOrder(9, 0),  qtyPhysical: 11 }),
  Object.freeze({ family: 'watches',   sortOrder: slotSortOrder(10, 0), qtyPhysical: 10 }),
  Object.freeze({ family: 'audio',     sortOrder: slotSortOrder(9, 1),  qtyPhysical: 10 }),
  // Bricolage — tools, electric, security + 2e slot tools
  Object.freeze({ family: 'tools',     sortOrder: slotSortOrder(11, 0), qtyPhysical: 10 }),
  Object.freeze({ family: 'electric',  sortOrder: slotSortOrder(12, 0), qtyPhysical: 9 }),
  Object.freeze({ family: 'security',  sortOrder: slotSortOrder(13, 0), qtyPhysical: 9 }),
  Object.freeze({ family: 'tools',     sortOrder: slotSortOrder(11, 1), qtyPhysical: 9 }),
  // Créations personnelles — ceremony, gift, printing + 2e slot gift
  Object.freeze({ family: 'ceremony',  sortOrder: slotSortOrder(14, 0), qtyPhysical: 9 }),
  Object.freeze({ family: 'gift',      sortOrder: slotSortOrder(15, 0), qtyPhysical: 8 }),
  Object.freeze({ family: 'printing',  sortOrder: slotSortOrder(16, 0), qtyPhysical: 8 }),
  Object.freeze({ family: 'gift',      sortOrder: slotSortOrder(15, 1), qtyPhysical: 8 }),
  // Auto — filters, car-light, brakes, moto
  Object.freeze({ family: 'filters',   sortOrder: slotSortOrder(17, 0), qtyPhysical: 8 }),
  Object.freeze({ family: 'car-light', sortOrder: slotSortOrder(19, 0), qtyPhysical: 7 }),
  Object.freeze({ family: 'brakes',    sortOrder: slotSortOrder(18, 0), qtyPhysical: 7 }),
  Object.freeze({ family: 'moto',      sortOrder: slotSortOrder(20, 0), qtyPhysical: 7 }),
]);

const PHYSICAL_OFFERS = Object.freeze({
  PLATEAU_RECEPTION: 'd15c1000-0000-4000-8000-000000000002',
  CIMENT: 'd15c1000-0000-4000-8000-000000000003',
});

const SERVICES = Object.freeze({
  ELECTRICITE: 'd15c2000-0000-4000-8000-000000000003',
  MECANIQUE: 'd15c2000-0000-4000-8000-000000000004',
  CLIMATISEUR: 'd15c2000-0000-4000-8000-000000000007',
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

  if (resolved.length !== TARGET_CJ_LOCAL) {
    throw new Error(`Plan CJ local incomplet: ${resolved.length}/${TARGET_CJ_LOCAL}`);
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
    // Mode & Beauté — 4 produits (women, beauty, men, kids)
    p[0], p[1], p[2], p[3],
    // Maison — 4 produits (comfort, kitchen, decor, kids-home) + 2 capacités locales partagées
    p[4], p[5], p[6], p[7],
    // Tech — 4 produits (phones, audio, watches, audio#2) ; le climatiseur et
    // l'électricité complètent la catégorie
    p[8], p[9], p[10], p[11],
    `service:${SERVICES.CLIMATISEUR}@Maison|Tech`,
    // Bricolage — 4 produits (tools, electric, security, tools#2) + offre matière + service électrique
    p[12], p[13], p[14], p[15],
    `physical_offer:${PHYSICAL_OFFERS.CIMENT}@Bricolage`,
    `service:${SERVICES.ELECTRICITE}@Bricolage|Tech`,
    // Créations personnelles — 4 produits (ceremony, gift, printing, gift#2) + offre réception
    p[16], p[17], p[18], p[19],
    `physical_offer:${PHYSICAL_OFFERS.PLATEAU_RECEPTION}@Maison|Créations personnelles`,
    // Auto — 4 produits (filters, car-light, brakes, moto) + mécanique locale
    p[20], p[21], p[22], p[23],
    `service:${SERVICES.MECANIQUE}@Auto`,
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
  if (valid.length !== TARGET_CJ_LOCAL) {
    throw new Error(`Audit Discovery CJ local refusé: valid=${valid.length}/${TARGET_CJ_LOCAL}`);
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

  if (candidates.length !== TARGET_CANDIDATES) {
    throw new Error(`Plan Discovery invalide: ${candidates.length}/${TARGET_CANDIDATES}`);
  }

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
  TARGET_CJ_LOCAL,
  TARGET_CANDIDATES,
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
