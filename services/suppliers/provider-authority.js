/**
 * @komerce-arch
 * @role          provider-authority
 * @domain        purchasing
 * @layer         service
 * @criticality   high
 * @inputs        provider code (string)
 * @outputs       canonical provider list, support verdict, normalized code, remote preflight requirement, reconciliation requirement
 * @depends       none
 * @used-by       services/suppliers/purchasing-validators.js (isSupportedProvider), services/suppliers/canonical-unit-purchasing-gate.js (remotePreflightRequirement, GAP-4A), services/purchasing-admin-service.js (reconciliationRequirement, GAP-5)
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

// GAP-4A — Canonical Procurement Readiness (docs/gaps/GAP_SUPPLIER_CONNECTIVITY_ALIGNMENT.md).
//
// Capability PROUVÉE, déclarée ici et nulle part ailleurs : ce provider
// a-t-il une intégration distante réelle capable de vérifier la
// disponibilité/le prix avant achat ? Ce n'est PAS dérivé de la présence
// d'un adapter dans un registry d'exécution — l'absence d'adapter ne doit
// jamais valoir implicitement absence de besoin de preflight (sinon un
// adapter oublié au registre redevient silencieusement "pas nécessaire").
// `true` = un connecteur live existe et a été exercé en Golden (Allegro
// sandbox, AliExpress preflight). `false` = aucune intégration distante
// n'a jamais existé pour ce provider (local/whatsapp/noon/amazon_uae
// sont des flux humains ou jamais raccordés) — fait constaté, pas supposé.
const REMOTE_PREFLIGHT_REQUIRED = Object.freeze({
  allegro: true,
  aliexpress: true,
  noon: false,
  amazon_uae: false,
  local: false,
  whatsapp: false,
});

const PREFLIGHT_REQUIREMENT = Object.freeze({
  REQUIRED: 'REQUIRED',
  NOT_REQUIRED: 'NOT_REQUIRED',
  // Provider non supporté OU supporté mais sans capability déclarée ici.
  // Ce dernier cas ne devrait jamais arriver (PROVIDERS et
  // REMOTE_PREFLIGHT_REQUIRED doivent rester en bijection) mais reste
  // fail-closed par construction si un provider est ajouté à PROVIDERS
  // sans mise à jour symétrique de sa capability.
  UNKNOWN: 'UNKNOWN',
});

// GAP-5 — Execution Evidence Boundary (docs/gaps/GAP_SUPPLIER_CONNECTIVITY_ALIGNMENT.md).
//
// Capability PROUVÉE, distincte de REMOTE_PREFLIGHT_REQUIRED : ce provider
// dispose-t-il d'un mécanisme RÉEL de réconciliation post-achat (vérifier
// qu'une preuve fournisseur correspond bien à l'intention Komerce) ? Ce
// n'est PAS le même axe que le preflight (avant achat) — un provider peut
// avoir l'un sans l'autre. `true` = un module de réconciliation existe et a
// été exercé (Allegro : `allegro-purchase-reconciliation.js`, prouvé par
// le Golden Sandbox). `false` = aucun mécanisme de réconciliation n'a
// jamais été construit pour ce provider — fait constaté à ce jour, pas une
// décision de ne jamais en avoir besoin. AliExpress a un preflight réel
// mais aucune réconciliation post-achat n'existe encore : marqué `false`
// ici délibérément (la confirmation manuelle AliExpress garde aujourd'hui
// son comportement historique, non vérifié) — GAP-5 se limite à brancher
// Allegro comme première preuve, ne force pas une exigence non prouvée
// sur un second provider.
const RECONCILIATION_REQUIRED = Object.freeze({
  allegro: true,
  aliexpress: false,
  noon: false,
  amazon_uae: false,
  local: false,
  whatsapp: false,
});

function normalizeProviderCode(code) {
  return String(code || '').trim().toLowerCase();
}

function isSupportedProvider(code) {
  return PROVIDER_SET.has(normalizeProviderCode(code));
}

function remotePreflightRequirement(code) {
  const normalized = normalizeProviderCode(code);
  if (!PROVIDER_SET.has(normalized)) return PREFLIGHT_REQUIREMENT.UNKNOWN;
  if (!Object.prototype.hasOwnProperty.call(REMOTE_PREFLIGHT_REQUIRED, normalized)) {
    return PREFLIGHT_REQUIREMENT.UNKNOWN;
  }
  return REMOTE_PREFLIGHT_REQUIRED[normalized]
    ? PREFLIGHT_REQUIREMENT.REQUIRED
    : PREFLIGHT_REQUIREMENT.NOT_REQUIRED;
}

// Réutilise le même vocabulaire REQUIRED/NOT_REQUIRED/UNKNOWN que le
// preflight (PREFLIGHT_REQUIREMENT) — même sémantique fail-closed sur
// UNKNOWN, axe différent. Pas de nouvel enum : un seul vocabulaire de
// "requirement" pour tout provider-authority.
function reconciliationRequirement(code) {
  const normalized = normalizeProviderCode(code);
  if (!PROVIDER_SET.has(normalized)) return PREFLIGHT_REQUIREMENT.UNKNOWN;
  if (!Object.prototype.hasOwnProperty.call(RECONCILIATION_REQUIRED, normalized)) {
    return PREFLIGHT_REQUIREMENT.UNKNOWN;
  }
  return RECONCILIATION_REQUIRED[normalized]
    ? PREFLIGHT_REQUIREMENT.REQUIRED
    : PREFLIGHT_REQUIREMENT.NOT_REQUIRED;
}

module.exports = {
  PROVIDERS,
  PREFLIGHT_REQUIREMENT,
  isSupportedProvider,
  normalizeProviderCode,
  remotePreflightRequirement,
  reconciliationRequirement,
};
