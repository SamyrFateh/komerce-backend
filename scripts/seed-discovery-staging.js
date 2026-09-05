/**
 * @komerce-arch
 * @role          providers-services-discovery-staging-seed
 * @domain        providers-services
 * @layer         tooling
 * @criticality   low
 * @inputs        KOMERCE_ENV, DISCOVERY_STAGING_SEED_ENABLED, market KM
 * @outputs       deterministic staging providers, services, physical_offers, real CJ local_stock
 * @depends       db, middleware/require-non-production.js,
 *                scripts/seed-golden-product.js, scripts/discovery-cj-local-repair.js,
 *                services/local-stock-service.js, tests/fixtures/catalog/golden-elite-pro.js
 * @used-by       manual staging operations
 * @db-read       markets, products, local_stock
 * @db-write      providers, services, physical_offers, local_stock
 * @db-txn        write
 * @doctrine      docs/doctrine/DOCTRINE_DISCOVERY_LOCALE_UNIFIEE.md
 * @impact-areas  staging, discovery-rail, providers-services
 * @version       2026-09
 */
'use strict';

const db = require('../db');
const { resolveRuntimeEnvironment } = require('../middleware/require-non-production');
const { seedGoldenProduct } = require('./seed-golden-product');
const { setLocalStock, setLocalStockExposure } = require('../services/local-stock-service');
const {
  CJ_LOCAL_PRODUCTS,
  resolveCjProducts,
  buildCandidates: buildCjDiscoveryCandidates,
} = require('./discovery-cj-local-repair');
const goldenFixture = require('../tests/fixtures/catalog/golden-elite-pro');

const FLAG = 'DISCOVERY_STAGING_SEED_ENABLED';
const MARKET_CODE = 'KM';
const LOCAL_STOCK_LOCATION = 'KM_MAIN';

// Médias Boutique existants utilisés uniquement pour éprouver le pipeline
// image_ref des objets provider. Les Products « Disponible maintenant » utilisent
// désormais les vraies photos CJ du catalogue public, jamais ces placeholders.
const STAGING_MEDIA = Object.freeze({
  FOOD: '/boutique/categories/cat-maison-v3.webp',
  BUILDING: '/boutique/categories/cat-bricolage-v3.webp',
  AUTO: '/boutique/categories/cat-auto-v3.webp',
  GENERAL: '/boutique/categories/cat-all-v3.webp',
});

// ── Product Komerce local canonique ──────────────────────────────────────
const GOLDEN_PRODUCT = Object.freeze({
  id: goldenFixture.productRow().id,
  location: LOCAL_STOCK_LOCATION,
  qtyPhysical: 25,
});

// Les autres Products du rail proviennent du showcase CJ réel 63/63.
// Le plan est détenu dans discovery-cj-local-repair.js afin que le seed manuel
// et l'opération de réparation ne puissent plus diverger.

const PROVIDERS = Object.freeze([
  {
    id: 'd15c0000-0000-4000-8000-000000000001', name: '[STAGING] Saveurs d\'Anjouan', phone: '+269000000001',
    publicPhone: '+269000000001', publicWhatsapp: '+269000000001',
  },
  {
    id: 'd15c0000-0000-4000-8000-000000000002', name: '[STAGING] Bâtir Anjouan', phone: '+269000000002',
    publicPhone: '+269000000002', publicWhatsapp: null,
  },
  {
    id: 'd15c0000-0000-4000-8000-000000000003', name: '[STAGING] Dépannage Anjouan', phone: '+269000000003',
    publicPhone: '+269000000003', publicWhatsapp: '+269000000003',
  },
  {
    id: 'd15c0000-0000-4000-8000-000000000004', name: '[STAGING] Atelier Mutsamudu', phone: '+269000000004',
    publicPhone: '+269000000004', publicWhatsapp: '+269000000004',
  },
  {
    id: 'd15c0000-0000-4000-8000-000000000005', name: '[STAGING] Appro Local Anjouan', phone: '+269000000005',
    publicPhone: null, publicWhatsapp: null,
  },
]);

const PHYSICAL_OFFERS = Object.freeze([
  {
    id: 'd15c1000-0000-4000-8000-000000000001', providerId: PROVIDERS[0].id,
    title: 'Samboussas au bœuf',
    description: 'Préparation locale pour commande familiale ou réception. Donnée de démonstration staging.',
    zone: 'Mutsamudu', imageRef: STAGING_MEDIA.FOOD,
    actions: ['request', 'call', 'whatsapp'],
  },
  {
    id: 'd15c1000-0000-4000-8000-000000000002', providerId: PROVIDERS[0].id,
    title: 'Plateau de samboussas pour réception',
    description: 'Préparation sur demande pour événement. Donnée de démonstration staging.',
    zone: 'Anjouan', imageRef: STAGING_MEDIA.FOOD,
    actions: ['quote', 'callback', 'whatsapp'],
  },
  {
    id: 'd15c1000-0000-4000-8000-000000000003', providerId: PROVIDERS[4].id,
    title: 'Ciment 32,5R disponible localement',
    description: 'Offre physique locale de test pour éprouver la découverte de matériaux sur place.',
    zone: 'Mutsamudu', imageRef: STAGING_MEDIA.BUILDING,
    actions: ['request'],
  },
  {
    id: 'd15c1000-0000-4000-8000-000000000004', providerId: PROVIDERS[4].id,
    title: 'Pack d’eau 6 × 1,5 L',
    description: 'Offre locale de disponibilité immédiate utilisée uniquement en staging.',
    zone: 'Anjouan', imageRef: STAGING_MEDIA.GENERAL,
    actions: ['request'],
  },
]);

const SERVICES = Object.freeze([
  {
    id: 'd15c2000-0000-4000-8000-000000000001', providerId: PROVIDERS[1].id,
    title: 'Maçonnerie et petits travaux',
    description: 'Demande de travaux de maçonnerie, réparation ou finition. Donnée staging.',
    zone: 'Mutsamudu', imageRef: STAGING_MEDIA.BUILDING,
    actions: ['quote', 'callback', 'call'],
  },
  {
    id: 'd15c2000-0000-4000-8000-000000000002', providerId: PROVIDERS[2].id,
    title: 'Plomberie maison',
    description: 'Diagnostic, fuite, robinetterie et petits travaux de plomberie. Donnée staging.',
    zone: 'Mutsamudu', imageRef: STAGING_MEDIA.BUILDING,
    actions: ['callback', 'call', 'whatsapp'],
  },
  {
    id: 'd15c2000-0000-4000-8000-000000000003', providerId: PROVIDERS[2].id,
    title: 'Électricité bâtiment',
    description: 'Petite installation, diagnostic et dépannage électrique. Donnée staging.',
    zone: 'Ouani', imageRef: STAGING_MEDIA.BUILDING,
    actions: ['callback', 'call'],
  },
  {
    id: 'd15c2000-0000-4000-8000-000000000004', providerId: PROVIDERS[3].id,
    title: 'Mécanique automobile',
    description: 'Diagnostic et petite réparation automobile. Donnée staging.',
    zone: 'Mutsamudu', imageRef: STAGING_MEDIA.AUTO,
    actions: ['quote', 'callback', 'call', 'whatsapp'],
  },
  {
    id: 'd15c2000-0000-4000-8000-000000000005', providerId: PROVIDERS[1].id,
    title: 'Menuiserie aluminium',
    description: 'Demande de fabrication ou réparation légère en aluminium. Donnée staging.',
    zone: 'Anjouan', imageRef: STAGING_MEDIA.BUILDING,
    actions: ['quote', 'callback', 'call'],
  },
  {
    id: 'd15c2000-0000-4000-8000-000000000006', providerId: PROVIDERS[3].id,
    title: 'Livraison et petite manutention',
    description: 'Besoin ponctuel de transport ou manutention locale. Donnée staging.',
    zone: 'Anjouan', imageRef: STAGING_MEDIA.GENERAL,
    actions: ['request', 'call', 'whatsapp'],
  },
  {
    id: 'd15c2000-0000-4000-8000-000000000007', providerId: PROVIDERS[1].id,
    title: 'Installation climatiseur',
    description: 'Installation et mise en service de climatiseur. Donnée staging.',
    zone: 'Mutsamudu', imageRef: STAGING_MEDIA.BUILDING,
    actions: ['quote', 'callback', 'call'],
  },
]);

function isTruthy(value) {
  return ['1', 'true', 'yes'].includes(String(value || '').trim().toLowerCase());
}

function shouldSeedDiscoveryStaging() {
  const { env } = resolveRuntimeEnvironment();
  return env === 'staging' && isTruthy(process.env[FLAG]);
}

function buildDiscoveryCandidates(productIds = []) {
  const [, ...cjIds] = productIds;
  return buildCjDiscoveryCandidates(cjIds.map(id => ({ id })));
}

async function resolveCjLocalProducts() {
  return resolveCjProducts();
}

async function exposeProductAsLocalStock({ id, qtyPhysical }, marketId) {
  await setLocalStock({
    productId: id,
    marketId,
    location: LOCAL_STOCK_LOCATION,
    qtyPhysical,
  });
  await setLocalStockExposure(id, marketId, 'ENABLED', LOCAL_STOCK_LOCATION);
}

async function upsertProvider(client, marketId, provider) {
  await client.query(
    `INSERT INTO providers (id, name, phone, public_phone, public_whatsapp, market_id, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'active')
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       phone = EXCLUDED.phone,
       public_phone = EXCLUDED.public_phone,
       public_whatsapp = EXCLUDED.public_whatsapp,
       market_id = EXCLUDED.market_id,
       status = 'active',
       updated_at = now()`,
    [provider.id, provider.name, provider.phone, provider.publicPhone, provider.publicWhatsapp, marketId]
  );
}

async function upsertService(client, marketId, service) {
  await client.query(
    `INSERT INTO services
       (id, provider_id, title, description, market_id, zone, image_ref, actions_enabled, status, commercial_exposure)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::text[], 'active', 'ENABLED')
     ON CONFLICT (id) DO UPDATE SET
       provider_id = EXCLUDED.provider_id,
       title = EXCLUDED.title,
       description = EXCLUDED.description,
       market_id = EXCLUDED.market_id,
       zone = EXCLUDED.zone,
       image_ref = EXCLUDED.image_ref,
       actions_enabled = EXCLUDED.actions_enabled,
       status = 'active',
       commercial_exposure = 'ENABLED',
       updated_at = now()`,
    [service.id, service.providerId, service.title, service.description, marketId, service.zone, service.imageRef, service.actions]
  );
}

async function upsertPhysicalOffer(client, marketId, offer) {
  await client.query(
    `INSERT INTO physical_offers
       (id, provider_id, title, description, market_id, zone, image_ref, actions_enabled, status, commercial_exposure)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::text[], 'active', 'ENABLED')
     ON CONFLICT (id) DO UPDATE SET
       provider_id = EXCLUDED.provider_id,
       title = EXCLUDED.title,
       description = EXCLUDED.description,
       market_id = EXCLUDED.market_id,
       zone = EXCLUDED.zone,
       image_ref = EXCLUDED.image_ref,
       actions_enabled = EXCLUDED.actions_enabled,
       status = 'active',
       commercial_exposure = 'ENABLED',
       updated_at = now()`,
    [offer.id, offer.providerId, offer.title, offer.description, marketId, offer.zone, offer.imageRef, offer.actions]
  );
}

async function seedDiscoveryStaging() {
  if (!shouldSeedDiscoveryStaging()) {
    return { seeded: false, reason: 'staging-only-opt-in' };
  }

  const market = await db.query(
    'SELECT id FROM markets WHERE code = $1 AND is_active = true',
    [MARKET_CODE]
  );
  const marketId = market.rows[0]?.id;
  if (!marketId) throw new Error('[seed:discovery] active market KM not found');

  await seedGoldenProduct();

  // Golden + douze vrais produits CJ : deux représentants par univers.
  const cjProducts = await resolveCjLocalProducts();
  const localProducts = [
    { id: GOLDEN_PRODUCT.id, qtyPhysical: GOLDEN_PRODUCT.qtyPhysical },
    ...cjProducts,
  ];
  for (const product of localProducts) {
    await exposeProductAsLocalStock(product, marketId);
  }

  await db.withTransaction(async client => {
    for (const provider of PROVIDERS) await upsertProvider(client, marketId, provider);
    for (const offer of PHYSICAL_OFFERS) await upsertPhysicalOffer(client, marketId, offer);
    for (const service of SERVICES) await upsertService(client, marketId, service);
  });

  const productIds = localProducts.map(product => product.id);
  return {
    seeded: true,
    market: MARKET_CODE,
    product: GOLDEN_PRODUCT.id,
    products: productIds.length,
    cjProducts: cjProducts.length,
    providers: PROVIDERS.length,
    physicalOffers: PHYSICAL_OFFERS.length,
    services: SERVICES.length,
    candidates: buildDiscoveryCandidates(productIds).join(','),
  };
}

async function runCli() {
  const result = await seedDiscoveryStaging();
  if (!result.seeded) {
    console.log(`[seed:discovery] skipped (${result.reason})`);
    return;
  }
  console.log(`[seed:discovery] ✅ ${result.products} products (${result.cjProducts} CJ), ${result.providers} providers, ${result.physicalOffers} physical offers, ${result.services} services`);
  console.log('[seed:discovery] Set staging env:');
  console.log('DISCOVERY_RAIL_ENABLED=true');
  console.log(`DISCOVERY_RAIL_CANDIDATES=${result.candidates}`);
}

if (require.main === module) {
  runCli()
    .catch(err => {
      console.error('[seed:discovery] ❌', err.message);
      process.exitCode = 1;
    })
    .finally(() => db.pool.end());
}

module.exports = {
  FLAG,
  MARKET_CODE,
  LOCAL_STOCK_LOCATION,
  STAGING_MEDIA,
  GOLDEN_PRODUCT,
  CJ_LOCAL_PRODUCTS,
  PROVIDERS,
  PHYSICAL_OFFERS,
  SERVICES,
  isTruthy,
  shouldSeedDiscoveryStaging,
  buildDiscoveryCandidates,
  resolveCjLocalProducts,
  exposeProductAsLocalStock,
  seedDiscoveryStaging,
};
