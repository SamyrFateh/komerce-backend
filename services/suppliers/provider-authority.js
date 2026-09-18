/**
 * @komerce-arch
 * @role          provider-authority
 * @domain        purchasing
 * @layer         service
 * @criticality   high
 * @inputs        provider code (string)
 * @outputs       canonical provider list, support verdict, normalized code
 * @depends       none
 * @used-by       validators/index.js (GAP-1), future adapter resolution (GAP-2)
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/gaps/GAP_SUPPLIER_CONNECTIVITY_ALIGNMENT.md
 * @impact-areas  purchasing, supplier-integration
 * @version       2026-09
 *
 * Autorité canonique unique pour l'identité provider supportée par Komerce.
 *
 * Avant ce module, la liste des providers supportés était déclarée
 * indépendamment à 3+ endroits (DB CHECK, validators.PLATFORMS,
 * purchasing-trigger-service switch), qui pouvaient diverger sans
 * propriétaire unique. Ce module est la source de vérité ; les autres
 * sites doivent la CONSOMMER plutôt que redéclarer une liste.
 *
 * DOCTRINE — provider identity ≠ execution mode (tranché) :
 *   provider / platform  = allegro | aliexpress | cj | noon | amazon_uae | local | whatsapp
 *   execution mode        = manual | automatic
 * `manual` N'EST PAS un provider — c'est un mode d'exécution dérivé de
 * l'absence de capacité auto_order d'un provider donné. Il ne doit
 * jamais apparaître dans cette liste, ni dans la contrainte DB
 * `suppliers_platform_check`, ni dans validators.PLATFORMS.
 *
 * Pas de table `supplier_providers` : cette autorité reste code tant
 * qu'aucun besoin de métadonnées persistées (activation, display_name,
 * lifecycle) n'est prouvé nécessaire par un provider réel.
 */
'use strict';

// Liste canonique — doit rester le miroir exact de la contrainte DB
// suppliers_platform_check (db/schema.sql). Toute évolution de l'un
// exige l'évolution symétrique de l'autre via migration.
const PROVIDERS = Object.freeze([
  'noon',
  'amazon_uae',
  'aliexpress',
  'local',
  'whatsapp',
  'allegro',
]);

const PROVIDER_SET = new Set(PROVIDERS);

function normalizeProviderCode(code) {
  return String(code || '').trim().toLowerCase();
}

function isSupportedProvider(code) {
  return PROVIDER_SET.has(normalizeProviderCode(code));
}

module.exports = {
  PROVIDERS,
  isSupportedProvider,
  normalizeProviderCode,
};
