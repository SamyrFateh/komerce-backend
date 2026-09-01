/**
 * @komerce-arch
 * @role          providers-services-discovery-staging-seed
 * @domain        providers-services
 * @layer         tooling
 * @criticality   low
 * @inputs        KOMERCE_ENV, DISCOVERY_STAGING_SEED_ENABLED, market KM
 * @outputs       deterministic staging providers, services, physical_offers, local_stock
 * @depends       db, middleware/require-non-production.js,
 *                scripts/seed-golden-product.js, services/local-stock-service.js,
 *                tests/fixtures/catalog/golden-elite-pro.js
 * @used-by       manual staging operations
 * @db-read       markets, products, local_stock
 * @db-write      providers, services, physical_offers, local_stock
 * @db-txn        write
 * @doctrine      docs/doctrine/DOCTRINE_DISCOVERY_LOCALE_UNIFIEE.md
 * @impact-areas  staging, discovery-rail, providers-services
 * @version       2026-08
 */
'use strict';

const db = require('../db');
const { resolveRuntimeEnvironment } = require('../middleware/require-non-production');
const { seedGoldenProduct } = require('./seed-golden-product');
const { setLocalStock, setLocalStockExposure } = require('../services/local-stock-service');
const goldenFixture = require('../tests/fixtures/catalog/golden-elite-pro');

const FLAG = 'DISCOVERY_STAGING_SEED_ENABLED';
const MARKET_CODE = 'KM';

// Médias Boutique existants utilisés uniquement pour éprouver le pipeline
// image_ref en staging. Ils restent des placeholders explicites : les vraies
// photos provider remplaceront ces références sans changement de code.
const STAGING_MEDIA = Object.freeze({
  FOOD: '/boutique/categories/cat-maison-v3.webp',
  BUILDING: '/boutique/categories/cat-bricolage-v3.webp',
  AUTO: '/boutique/categories/cat-auto-v3.webp',
  GENERAL: '/boutique/categories/cat-all-v3.webp',
});

// ── Product Komerce local (Golden Product canonique) ──────────────────────
// Pas de fake catalogue parallèle : on réutilise le Golden Product officiel
// (owner: catalog domain via seed-golden-product.js), puis on l'expose en
// local-stock via les primitives du domaine local-stock.
const GOLDEN_PRODUCT = Object.freeze({
  id: goldenFixture.productRow().id,
  location: 'KM_MAIN',
  qtyPhysical: 25,
});

const PROVIDERS = Object.freeze([
  { id: 'd15c0000-0000-4000-8000-000000000001', name: '[STAGING] Saveurs d\'Anjouan', phone: '+269000000001' },
  { id: 'd15c0000-0000-4000-8000-000000000002', name: '[STAGING] Bâtir Anjouan', phone: '+269000000002' },
  { id: 'd15c0000-0000-4000-8000-000000000003', name: '[STAGING] Dépannage Anjouan', phone: '+269000000003' },
  { id: 'd15c0000-0000-4000-8000-000000000004', name: '[STAGING] Atelier Mutsamudu', phone: '+269000000004' },
  { id: 'd15c0000-0000-4000-8000-000000000005', name: '[STAGING] Appro Local Anjouan', phone: '+269000000005' },
]);

const PHYSICAL_OFFERS = Object.freeze([
  {
    id: 'd15c1000-0000-4000-8000-000000000001', providerId: PROVIDERS[0].id,
    title: 'Samboussas au bœuf',
    description: 'Préparation locale pour commande familiale ou réception. Donnée de démonstration staging.',
    zone: 'Mutsamudu', imageRef: STAGING_MEDIA.FOOD,
  },
  {
    id: 'd15c1000-0000-4000-8000-000000000002', providerId: PROVIDERS[0].id,
    title: 'Plateau de samboussas pour réception',
    description: 'Préparation sur demande pour événement. Donnée de démonstration staging.',
    zone: 'Anjouan', imageRef: STAGING_MEDIA.FOOD,
  },
  {
    id: 'd15c1000-0000-4000-8000-000000000003', providerId: PROVIDERS[4].id,
    title: 'Ciment 32,5R disponible localement',
    description: 'Offre physique locale de test pour éprouver la découverte de matériaux sur place.',
    zone: 'Mutsamudu', imageRef: STAGING_MEDIA.BUILDING,
  },
  {
    id: 'd15c1000-0000-4000-8000-000000000004', providerId: PROVIDERS[4].id,
    title: 'Pack d’eau 6 × 1,5 L',
    description: 'Offre locale de disponibilité immédiate utilisée uniquement en staging.',
    zone: 'Anjouan', imageRef: STAGING_MEDIA.GENERAL,
  },
]);

const SERVICES = Object.freeze([
  {
    id: 'd15c2000-0000-4000-8000-000000000001', providerId: PROVIDERS[1].id,
    title: 'Maçonnerie et petits travaux',
    description: 'Demande de travaux de maçonnerie, réparation ou finition. Donnée staging.',
    zone: 'Mutsamudu', imageRef: STAGING_MEDIA.BUILDING,
  },
  {
    id: 'd15c2000-0000-4000-8000-000000000002', providerId: PROVIDERS[2].id,
    title: 'Plomberie maison',
    description: 'Diagnostic, fuite, robinetterie et petits travaux de plomberie. Donnée staging.',
    zone: 'Mutsamudu', imageRef: STAGING_MEDIA.BUILDING,
  },
  {
    id: 'd15c2000-0000-4000-8000-000000000003', providerId: PROVIDERS[2].id,
    title: 'Électricité bâtiment',
    description: 'Petite installation, diagnostic et dépannage électrique. Donnée staging.',
    zone: 'Ouani', imageRef: STAGING_MEDIA.BUILDING,
  },
  {
    id: 'd15c2000-0000-4000-8000-000000000004', providerId: PROVIDERS[3].id,
    title: 'Mécanique automobile',
    description: 'Diagnostic et petite réparation automobile. Donnée staging.',
    zone: 'Mutsamudu', imageRef: STAGING_MEDIA.AUTO,
  },
  {
    id: 'd15c2000-0000-4000-8000-000000000005', providerId: PROVIDERS[1].id,
    title: 'Menuiserie aluminium',
    description: 'Demande de fabrication ou réparation légère en aluminium. Donnée staging.',
    zone: 'Anjouan', imageRef: STAGING_MEDIA.BUILDING,
  },
  {
    id: 'd15c2000-0000-4000-8000-000000000006', providerId: PROVIDERS[3].id,
    title: 'Livraison et petite manutention',
    description: 'Besoin ponctuel de transport ou manutention locale. Donnée staging.',
    zone: 'Anjouan', imageRef: STAGING_MEDIA.GENERAL,
  },
  {
    id: 'd15c2000-0000-4000-8000-000000000007', providerId: PROVIDERS[1].id,
    title: 'Installation climatiseur',
    description: 'Installation et mise en service de climatiseur. Donnée staging.',
    zone: 'Mutsamudu', imageRef: STAGING_MEDIA.BUILDING,
  },
]);

const DISCOVERY_CANDIDATES = Object.freeze([
  `product:${GOLDEN_PRODUCT.id}`,
  `physical_offer:${PHYSICAL_OFFERS[0].id}`,
  `service:${SERVICES[1].id}`,
  `physical_offer:${PHYSICAL_OFFERS[2].id}`,
  `service:${SERVICES[0].id}`,
  `service:${SERVICES[2].id}`,
  `physical_offer:${PHYSICAL_OFFERS[1].id}`,
  `service:${SERVICES[3].id}`,
  `physical_offer:${PHYSICAL_OFFERS[3].id}`,
  `service:${SERVICES[4].id}`,
  `service:${SERVICES[5].id}`,
  `service:${SERVICES[6].id}`,
]);

function isTruthy(value) {
  return ['1', 'true', 'yes'].includes(String(value || '').trim().toLowerCase());
}

function shouldSeedDiscoveryStaging() {
  const { env } = resolveRuntimeEnvironment();
  return env === 'staging' && isTruthy(process.env[FLAG]);
}

async function upsertProvider(client, marketId, provider) {
  await client.query(
    `INSERT INTO providers (id, name, phone, market_id, status)
     VALUES ($1, $2, $3, $4, 'active')
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       phone = EXCLUDED.phone,
       market_id = EXCLUDED.market_id,
       status = 'active',
       updated_at = now()`,
    [provider.id, provider.name, provider.phone, marketId]
  );
}

async function upsertService(client, marketId, service) {
  await client.query(
    `INSERT INTO services
       (id, provider_id, title, description, market_id, zone, image_ref, status, commercial_exposure)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', 'ENABLED')
     ON CONFLICT (id) DO UPDATE SET
       provider_id = EXCLUDED.provider_id,
       title = EXCLUDED.title,
       description = EXCLUDED.description,
       market_id = EXCLUDED.market_id,
       zone = EXCLUDED.zone,
       image_ref = EXCLUDED.image_ref,
       status = 'active',
       commercial_exposure = 'ENABLED',
       updated_at = now()`,
    [service.id, service.providerId, service.title, service.description, marketId, service.zone, service.imageRef]
  );
}

async function upsertPhysicalOffer(client, marketId, offer) {
  await client.query(
    `INSERT INTO physical_offers
       (id, provider_id, title, description, market_id, zone, image_ref, status, commercial_exposure)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', 'ENABLED')
     ON CONFLICT (id) DO UPDATE SET
       provider_id = EXCLUDED.provider_id,
       title = EXCLUDED.title,
       description = EXCLUDED.description,
       market_id = EXCLUDED.market_id,
       zone = EXCLUDED.zone,
       image_ref = EXCLUDED.image_ref,
       status = 'active',
       commercial_exposure = 'ENABLED',
       updated_at = now()`,
    [offer.id, offer.providerId, offer.title, offer.description, marketId, offer.zone, offer.imageRef]
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

  // 1. Golden Product (owner: catalog domain)
  await seedGoldenProduct();

  // 2. Local stock for the Golden Product (owner: local-stock domain)
  await setLocalStock({
    productId: GOLDEN_PRODUCT.id,
    marketId,
    location: GOLDEN_PRODUCT.location,
    qtyPhysical: GOLDEN_PRODUCT.qtyPhysical,
  });
  await setLocalStockExposure(
    GOLDEN_PRODUCT.id, marketId, 'ENABLED', GOLDEN_PRODUCT.location
  );

  // 3. Providers, physical offers, services
  await db.withTransaction(async client => {
    for (const provider of PROVIDERS) await upsertProvider(client, marketId, provider);
    for (const offer of PHYSICAL_OFFERS) await upsertPhysicalOffer(client, marketId, offer);
    for (const service of SERVICES) await upsertService(client, marketId, service);
  });

  return {
    seeded: true,
    market: MARKET_CODE,
    product: GOLDEN_PRODUCT.id,
    providers: PROVIDERS.length,
    physicalOffers: PHYSICAL_OFFERS.length,
    services: SERVICES.length,
    candidates: DISCOVERY_CANDIDATES.join(','),
  };
}

async function runCli() {
  const result = await seedDiscoveryStaging();
  if (!result.seeded) {
    console.log(`[seed:discovery] skipped (${result.reason})`);
    return;
  }
  console.log(`[seed:discovery] ✅ product ${result.product}, ${result.providers} providers, ${result.physicalOffers} physical offers, ${result.services} services`);
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
  STAGING_MEDIA,
  PROVIDERS,
  PHYSICAL_OFFERS,
  SERVICES,
  DISCOVERY_CANDIDATES,
  isTruthy,
  shouldSeedDiscoveryStaging,
  seedDiscoveryStaging,
};
