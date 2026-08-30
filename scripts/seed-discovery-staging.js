/**
 * @komerce-arch
 * @role          providers-services-discovery-staging-seed
 * @domain        providers-services
 * @layer         tooling
 * @criticality   low
 * @inputs        KOMERCE_ENV, DISCOVERY_STAGING_SEED_ENABLED, market KM
 * @outputs       deterministic staging providers, services, physical_offers
 * @depends       db, middleware/require-non-production.js
 * @used-by       manual staging operations
 * @db-read       markets
 * @db-write      providers, services, physical_offers
 * @db-txn        write
 * @doctrine      docs/doctrine/DOCTRINE_DISCOVERY_LOCALE_UNIFIEE.md
 * @impact-areas  staging, discovery-rail, providers-services
 * @version       2026-08
 */
'use strict';

const db = require('../db');
const { resolveRuntimeEnvironment } = require('../middleware/require-non-production');

const FLAG = 'DISCOVERY_STAGING_SEED_ENABLED';
const MARKET_CODE = 'KM';

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
    zone: 'Mutsamudu',
  },
  {
    id: 'd15c1000-0000-4000-8000-000000000002', providerId: PROVIDERS[0].id,
    title: 'Plateau de samboussas pour réception',
    description: 'Préparation sur demande pour événement. Donnée de démonstration staging.',
    zone: 'Anjouan',
  },
  {
    id: 'd15c1000-0000-4000-8000-000000000003', providerId: PROVIDERS[4].id,
    title: 'Ciment 32,5R disponible localement',
    description: 'Offre physique locale de test pour éprouver la découverte de matériaux sur place.',
    zone: 'Mutsamudu',
  },
  {
    id: 'd15c1000-0000-4000-8000-000000000004', providerId: PROVIDERS[4].id,
    title: 'Pack d’eau 6 × 1,5 L',
    description: 'Offre locale de disponibilité immédiate utilisée uniquement en staging.',
    zone: 'Anjouan',
  },
]);

const SERVICES = Object.freeze([
  {
    id: 'd15c2000-0000-4000-8000-000000000001', providerId: PROVIDERS[1].id,
    title: 'Maçonnerie et petits travaux',
    description: 'Demande de travaux de maçonnerie, réparation ou finition. Donnée staging.',
    zone: 'Mutsamudu',
  },
  {
    id: 'd15c2000-0000-4000-8000-000000000002', providerId: PROVIDERS[2].id,
    title: 'Plomberie maison',
    description: 'Diagnostic, fuite, robinetterie et petits travaux de plomberie. Donnée staging.',
    zone: 'Mutsamudu',
  },
  {
    id: 'd15c2000-0000-4000-8000-000000000003', providerId: PROVIDERS[2].id,
    title: 'Électricité bâtiment',
    description: 'Petite installation, diagnostic et dépannage électrique. Donnée staging.',
    zone: 'Ouani',
  },
  {
    id: 'd15c2000-0000-4000-8000-000000000004', providerId: PROVIDERS[3].id,
    title: 'Mécanique automobile',
    description: 'Diagnostic et petite réparation automobile. Donnée staging.',
    zone: 'Mutsamudu',
  },
  {
    id: 'd15c2000-0000-4000-8000-000000000005', providerId: PROVIDERS[1].id,
    title: 'Menuiserie aluminium',
    description: 'Demande de fabrication ou réparation légère en aluminium. Donnée staging.',
    zone: 'Anjouan',
  },
  {
    id: 'd15c2000-0000-4000-8000-000000000006', providerId: PROVIDERS[3].id,
    title: 'Livraison et petite manutention',
    description: 'Besoin ponctuel de transport ou manutention locale. Donnée staging.',
    zone: 'Anjouan',
  },
]);

const DISCOVERY_CANDIDATES = Object.freeze([
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
       (id, provider_id, title, description, market_id, zone, status, commercial_exposure)
     VALUES ($1, $2, $3, $4, $5, $6, 'active', 'ENABLED')
     ON CONFLICT (id) DO UPDATE SET
       provider_id = EXCLUDED.provider_id,
       title = EXCLUDED.title,
       description = EXCLUDED.description,
       market_id = EXCLUDED.market_id,
       zone = EXCLUDED.zone,
       status = 'active',
       commercial_exposure = 'ENABLED',
       updated_at = now()`,
    [service.id, service.providerId, service.title, service.description, marketId, service.zone]
  );
}

async function upsertPhysicalOffer(client, marketId, offer) {
  await client.query(
    `INSERT INTO physical_offers
       (id, provider_id, title, description, market_id, zone, status, commercial_exposure)
     VALUES ($1, $2, $3, $4, $5, $6, 'active', 'ENABLED')
     ON CONFLICT (id) DO UPDATE SET
       provider_id = EXCLUDED.provider_id,
       title = EXCLUDED.title,
       description = EXCLUDED.description,
       market_id = EXCLUDED.market_id,
       zone = EXCLUDED.zone,
       status = 'active',
       commercial_exposure = 'ENABLED',
       updated_at = now()`,
    [offer.id, offer.providerId, offer.title, offer.description, marketId, offer.zone]
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

  await db.withTransaction(async client => {
    for (const provider of PROVIDERS) await upsertProvider(client, marketId, provider);
    for (const offer of PHYSICAL_OFFERS) await upsertPhysicalOffer(client, marketId, offer);
    for (const service of SERVICES) await upsertService(client, marketId, service);
  });

  return {
    seeded: true,
    market: MARKET_CODE,
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
  console.log(`[seed:discovery] ✅ ${result.providers} providers, ${result.physicalOffers} physical offers, ${result.services} services`);
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
  PROVIDERS,
  PHYSICAL_OFFERS,
  SERVICES,
  DISCOVERY_CANDIDATES,
  isTruthy,
  shouldSeedDiscoveryStaging,
  seedDiscoveryStaging,
};
