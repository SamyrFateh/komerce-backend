'use strict';

/**
 * @komerce-arch
 * @role          supplier-discovery-segment-plan
 * @domain        catalog
 * @layer         service
 * @criticality   medium
 * @inputs        none
 * @outputs       provider-independent discovery segments + target profiles
 * @depends       none
 * @used-by       scripts/aliexpress-500-catalog-sync.js, scripts/cj-500-e2e-catalog-sync.js, services/supplier-catalog-scanner.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      supplier_independent_discovery_segments, boutique_taxonomy_is_not_customs_classification
 * @impact-areas  sourcing, catalog, boutique-e2e
 * @version       2026-09-v1
 */

const SEGMENTS = Object.freeze([
  { id: 'mode-femme', category: 'Mode & Beauté', subcategory: 'Femme', queries: ['women dress', 'women clothing'] },
  { id: 'mode-homme', category: 'Mode & Beauté', subcategory: 'Homme', queries: ['men shirt', 'men clothing'] },
  { id: 'mode-enfant', category: 'Mode & Beauté', subcategory: 'Enfant', queries: ['kids clothing', 'kids shoes'] },
  { id: 'beaute', category: 'Mode & Beauté', subcategory: 'Beauté', queries: ['cosmetics makeup', 'skin care', 'beauty tools'] },

  { id: 'maison-confort', category: 'Maison', subcategory: 'Confort', queries: ['home appliance', 'household appliance'] },
  { id: 'maison-cuisine', category: 'Maison', subcategory: 'Cuisine', queries: ['kitchenware', 'kitchen utensil'] },
  { id: 'maison-deco', category: 'Maison', subcategory: 'Déco', queries: ['home decor', 'table lamp'] },
  { id: 'maison-enfants', category: 'Maison', subcategory: 'Enfants', queries: ['school supplies', 'school bag'] },

  { id: 'tech-phones', category: 'Tech', subcategory: 'Phones', queries: ['android smartphone', 'mobile phone'] },
  { id: 'tech-audio', category: 'Tech', subcategory: 'Audio', queries: ['wireless headphones', 'bluetooth speaker'] },
  { id: 'tech-montres', category: 'Tech', subcategory: 'Montres', queries: ['smartwatch', 'wrist watch'] },

  { id: 'bricolage-outillage', category: 'Bricolage', subcategory: 'Outillage', queries: ['power tools', 'hand tools'] },
  { id: 'bricolage-electricite', category: 'Bricolage', subcategory: 'Electricité', queries: ['electrical connectors', 'extension cable'] },
  { id: 'bricolage-securite', category: 'Bricolage', subcategory: 'Sécurité', queries: ['padlock', 'door lock'] },

  { id: 'creation-ceremonie', category: 'Créations personnelles', subcategory: 'Cérémonie', queries: ['evening dress', 'formal suit'] },
  { id: 'creation-cadeau', category: 'Créations personnelles', subcategory: 'Cadeau', queries: ['gift box', 'personalized gift'] },
  { id: 'creation-impression', category: 'Créations personnelles', subcategory: 'Impression', queries: ['printed mug', 'custom stationery'] },

  { id: 'auto-filtres', category: 'Auto', subcategory: 'Filtres', queries: ['car oil filter', 'car air filter'] },
  { id: 'auto-freinage', category: 'Auto', subcategory: 'Freinage', queries: ['brake pads', 'brake disc'] },
  { id: 'auto-eclairage', category: 'Auto', subcategory: 'Éclairage', queries: ['car led headlight', 'car tail light'] },
  { id: 'auto-moto', category: 'Auto', subcategory: 'Moto', queries: ['motorcycle accessories', 'motorcycle phone holder'] },
]);

const ALIEXPRESS_500_TARGETS = Object.freeze({
  'mode-femme': 35,
  'mode-homme': 25,
  'mode-enfant': 25,
  beaute: 45,
  'maison-confort': 25,
  'maison-cuisine': 25,
  'maison-deco': 20,
  'maison-enfants': 20,
  'tech-phones': 30,
  'tech-audio': 30,
  'tech-montres': 30,
  'bricolage-outillage': 25,
  'bricolage-electricite': 25,
  'bricolage-securite': 20,
  'creation-ceremonie': 20,
  'creation-cadeau': 20,
  'creation-impression': 15,
  'auto-filtres': 20,
  'auto-freinage': 15,
  'auto-eclairage': 15,
  'auto-moto': 15,
});

// E2E : univers presque égaux, puis répartition homogène entre sous-catégories.
// Totaux univers : 84 / 84 / 83 / 83 / 83 / 83 = 500.
const BALANCED_E2E_500_TARGETS = Object.freeze({
  'mode-femme': 21,
  'mode-homme': 21,
  'mode-enfant': 21,
  beaute: 21,
  'maison-confort': 21,
  'maison-cuisine': 21,
  'maison-deco': 21,
  'maison-enfants': 21,
  'tech-phones': 28,
  'tech-audio': 28,
  'tech-montres': 27,
  'bricolage-outillage': 28,
  'bricolage-electricite': 28,
  'bricolage-securite': 27,
  'creation-ceremonie': 28,
  'creation-cadeau': 28,
  'creation-impression': 27,
  'auto-filtres': 21,
  'auto-freinage': 21,
  'auto-eclairage': 21,
  'auto-moto': 20,
});

function buildPlan(targets) {
  const targetMap = targets || {};
  return SEGMENTS.map((segment) => {
    const target = Number(targetMap[segment.id] || 0);
    if (!Number.isInteger(target) || target <= 0) {
      throw new Error(`Cible de segment invalide: ${segment.id}=${targetMap[segment.id]}`);
    }
    return Object.freeze({ ...segment, target });
  });
}

function planTotal(plan) {
  return (plan || []).reduce((sum, segment) => sum + Number(segment.target || 0), 0);
}

function planByUniverse(plan) {
  const out = {};
  for (const segment of plan || []) {
    out[segment.category] = (out[segment.category] || 0) + Number(segment.target || 0);
  }
  return out;
}

const ALIEXPRESS_500_PLAN = Object.freeze(buildPlan(ALIEXPRESS_500_TARGETS));
const BALANCED_E2E_500_PLAN = Object.freeze(buildPlan(BALANCED_E2E_500_TARGETS));

if (planTotal(ALIEXPRESS_500_PLAN) !== 500) throw new Error('Plan AliExpress 500 invalide');
if (planTotal(BALANCED_E2E_500_PLAN) !== 500) throw new Error('Plan E2E équilibré 500 invalide');

module.exports = {
  SEGMENTS,
  ALIEXPRESS_500_TARGETS,
  BALANCED_E2E_500_TARGETS,
  ALIEXPRESS_500_PLAN,
  BALANCED_E2E_500_PLAN,
  buildPlan,
  planTotal,
  planByUniverse,
};
