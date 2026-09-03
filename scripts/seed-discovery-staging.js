/**
 * @komerce-arch
 * @role          providers-services-discovery-staging-seed
 * @domain        providers-services
 * @layer         tooling
 * @criticality   low
 * @inputs        KOMERCE_ENV, DISCOVERY_STAGING_SEED_ENABLED, market KM
 * @outputs       deterministic staging providers, services, physical_offers, showcase local_stock
 * @depends       db, middleware/require-non-production.js,
 *                scripts/seed-golden-product.js, services/local-stock-service.js,
 *                tests/fixtures/catalog/golden-elite-pro.js
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
const goldenFixture = require('../tests/fixtures/catalog/golden-elite-pro');

const FLAG = 'DISCOVERY_STAGING_SEED_ENABLED';
const MARKET_CODE = 'KM';
const LOCAL_STOCK_LOCATION = 'KM_MAIN';

// Médias Boutique existants utilisés uniquement pour éprouver le pipeline
// image_ref en staging. Ils restent des placeholders explicites : les vraies
// photos provider remplaceront ces références sans changement de code.
const STAGING_MEDIA = Object.freeze({
  FOOD: '/boutique/categories/cat-maison-v3.webp',
  BUILDING: '/boutique/categories/cat-bricolage-v3.webp',
  AUTO: '/boutique/categories/cat-auto-v3.webp',
  GENERAL: '/boutique/categories/cat-all-v3.webp',
});

// ── Product Komerce local canonique ──────────────────────────────────────
// Le Golden Product reste le premier produit du rail : il est stable, riche
// et entièrement maîtrisé par le domaine catalog.
const GOLDEN_PRODUCT = Object.freeze({
  id: goldenFixture.productRow().id,
  location: LOCAL_STOCK_LOCATION,
  qtyPhysical: 25,
});

// Pour juger le rendu réel d'un rail ecommerce, un seul Product Komerce ne
// suffit pas. On réutilise donc sept produits Showcase V2 déjà présents dans
// le vrai catalogue staging, choisis par product_ref stable et répartis sur
// les grands univers de la Boutique. Aucun produit parallèle n'est créé ici.
//
// Les UUID restent ceux du catalogue live staging : le seed les résout au run
// et ignore proprement une ref absente, sans rendre le rail dépendant d'un ID
// généré par une autre campagne.
const SHOWCASE_LOCAL_PRODUCTS = Object.freeze([
  { productRef: 'SHOWCASE-V2-0020', qtyPhysical: 18 }, // Mode
  { productRef: 'SHOWCASE-V2-0100', qtyPhysical: 16 }, // Beauté
  { productRef: 'SHOWCASE-V2-0140', qtyPhysical: 14 }, // Maison
  { productRef: 'SHOWCASE-V2-0230', qtyPhysical: 12 }, // Tech
  { productRef: 'SHOWCASE-V2-0320', qtyPhysical: 10 }, // Bricolage
  { productRef: 'SHOWCASE-V2-0405', qtyPhysical: 9 },  // Créations personnelles
  { productRef: 'SHOWCASE-V2-0440', qtyPhysical: 11 }, // Auto
]);

// Les coordonnées publiques ci-dessous sont un choix EXPLICITE du dataset
// staging. Elles ne sont jamais déduites de `phone` par le runtime.
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
  const p = productIds.map(id => `product:${id}`);
  return [
    p[0],
    p[1],
    `physical_offer:${PHYSICAL_OFFERS[0].id}`,
    p[2],
    p[3],
    `service:${SERVICES[6].id}`,
    p[4],
    p[5],
    `physical_offer:${PHYSICAL_OFFERS[2].id}`,
    p[6],
    p[7],
    `service:${SERVICES[1].id}`,
  ].filter(Boolean).slice(0, 12);
}

async function resolveShowcaseLocalProducts() {
  const refs = SHOWCASE_LOCAL_PRODUCTS.map(product => product.productRef);
  const { rows } = await db.query(
    `SELECT id, product_ref
       FROM products
      WHERE is_active = true
        AND product_ref = ANY($1::text[])
        AND NULLIF(BTRIM(image_url), '') IS NOT NULL`,
    [refs]
  );

  const byRef = new Map(rows.map(row => [row.product_ref, row]));
  return SHOWCASE_LOCAL_PRODUCTS
    .map(config => {
      const row = byRef.get(config.productRef);
      return row ? { ...config, id: row.id } : null;
    })
    .filter(Boolean);
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

  // 1. Golden Product (owner: catalog domain)
  await seedGoldenProduct();

  // 2. Product Komerce locaux : Golden + vraie sélection Showcase V2.
  const showcaseProducts = await resolveShowcaseLocalProducts();
  const localProducts = [
    { id: GOLDEN_PRODUCT.id, qtyPhysical: GOLDEN_PRODUCT.qtyPhysical },
    ...showcaseProducts,
  ];
  for (const product of localProducts) {
    await exposeProductAsLocalStock(product, marketId);
  }

  // 3. Providers, physical offers, services
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
    showcaseProducts: showcaseProducts.length,
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
  console.log(`[seed:discovery] ✅ ${result.products} products, ${result.providers} providers, ${result.physicalOffers} physical offers, ${result.services} services`);
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
  SHOWCASE_LOCAL_PRODUCTS,
  PROVIDERS,
  PHYSICAL_OFFERS,
  SERVICES,
  isTruthy,
  shouldSeedDiscoveryStaging,
  buildDiscoveryCandidates,
  resolveShowcaseLocalProducts,
  exposeProductAsLocalStock,
  seedDiscoveryStaging,
};
