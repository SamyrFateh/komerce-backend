/**
 * @komerce-arch-lite
 * @role          providers-services-discovery-modal-v2-seed
 * @domain        providers-services
 * @layer         tooling
 * @owner         scripts/seed-discovery-staging.js
 * @purpose       Enrichir le dataset staging Discovery avec des cas sérieux request/callback visibles dans la modale V2.
 * @impact-areas  staging, discovery-modal, providers-services
 * @version       2026-09
 */
'use strict';

const db = require('../db');
const {
  SERVICES,
  PHYSICAL_OFFERS,
  seedDiscoveryStaging,
} = require('./seed-discovery-staging');

const MODAL_V2_EXAMPLES = Object.freeze({
  autoParts: {
    id: SERVICES[6].id,
    title: 'Recherche et sourcing de pièces auto',
    description: 'Indiquez marque, modèle, année et la pièce recherchée. Recherche locale ou import selon disponibilité fournisseur.',
    zone: 'Mutsamudu / Anjouan',
    actions: ['request', 'callback'],
  },
  plumbing: {
    id: SERVICES[1].id,
    title: 'Plomberie maison — diagnostic et dépannage',
    description: 'Fuite, robinetterie, évacuation ou petite réparation. Décrivez le problème ou demandez à être rappelé.',
    zone: 'Mutsamudu',
    actions: ['request', 'callback'],
  },
  callbackOnly: {
    id: SERVICES[2].id,
    title: 'Diagnostic électrique bâtiment',
    description: 'Décrivez brièvement le problème ; le technicien vous rappelle pour qualifier l’intervention.',
    zone: 'Ouani',
    actions: ['callback'],
  },
  cement: {
    id: PHYSICAL_OFFERS[2].id,
    title: 'Ciment 42,5R — sac 50 kg',
    description: 'Stock local indicatif. Précisez la quantité et la zone de livraison ou demandez à être rappelé à propos de cette offre.',
    zone: 'Mutsamudu',
    actions: ['request', 'callback'],
  },
  reception: {
    id: PHYSICAL_OFFERS[1].id,
    title: 'Plateau de samboussas pour réception',
    description: 'Préparation locale pour mariage, réunion ou réception. Précisez la quantité, la date et le lieu.',
    zone: 'Anjouan',
    actions: ['request', 'callback'],
  },
});

async function updateService(example) {
  await db.query(
    `UPDATE services
        SET title = $2,
            description = $3,
            zone = $4,
            actions_enabled = $5::text[],
            status = 'active',
            commercial_exposure = 'ENABLED',
            updated_at = now()
      WHERE id = $1`,
    [example.id, example.title, example.description, example.zone, example.actions]
  );
}

async function updatePhysicalOffer(example) {
  await db.query(
    `UPDATE physical_offers
        SET title = $2,
            description = $3,
            zone = $4,
            actions_enabled = $5::text[],
            status = 'active',
            commercial_exposure = 'ENABLED',
            updated_at = now()
      WHERE id = $1`,
    [example.id, example.title, example.description, example.zone, example.actions]
  );
}

async function seedDiscoveryModalV2Staging() {
  const base = await seedDiscoveryStaging();
  if (!base.seeded) return base;

  await updateService(MODAL_V2_EXAMPLES.autoParts);
  await updateService(MODAL_V2_EXAMPLES.plumbing);
  await updateService(MODAL_V2_EXAMPLES.callbackOnly);
  await updatePhysicalOffer(MODAL_V2_EXAMPLES.cement);
  await updatePhysicalOffer(MODAL_V2_EXAMPLES.reception);

  return {
    ...base,
    modalV2Examples: Object.values(MODAL_V2_EXAMPLES).map(example => example.id),
  };
}

async function runCli() {
  const result = await seedDiscoveryModalV2Staging();
  if (!result.seeded) {
    console.log(`[seed:discovery-modal-v2] skipped (${result.reason})`);
    return;
  }
  console.log(`[seed:discovery-modal-v2] ✅ ${result.modalV2Examples.length} exemples contextualisés`);
  console.log(`DISCOVERY_RAIL_CANDIDATES=${result.candidates}`);
}

if (require.main === module) {
  runCli()
    .catch(err => {
      console.error('[seed:discovery-modal-v2] ❌', err.message);
      process.exitCode = 1;
    })
    .finally(() => db.pool.end());
}

module.exports = {
  MODAL_V2_EXAMPLES,
  seedDiscoveryModalV2Staging,
};
