/**
 * @komerce-arch
 * @role          purchase-order-confirmation-boundary
 * @domain        purchasing
 * @layer         service
 * @criticality   high
 * @inputs        Supplier Order Identity, external reference to verify, provider adapters, provider authority
 * @outputs       reconciliation_required_verdict_or_committed_or_rejected
 * @depends       services/suppliers/provider-authority.js, services/suppliers/supplier-fulfillment-adapter-contract.js
 * @used-by       services/purchasing-admin-service.js (confirmPurchaseOrder, GAP-5)
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_PROCUREMENT_FULFILLMENT.md, docs/gaps/GAP_SUPPLIER_CONNECTIVITY_ALIGNMENT.md
 * @impact-areas  purchasing, supplier-integration
 * @version       2026-09
 *
 * GAP-5 — Execution Evidence Boundary.
 *
 * "Cette référence externe correspond-elle réellement à un engagement
 * fournisseur, avant que Komerce ne confirme la PO ?"
 *
 * Contrat :
 *   execute (manuel ou auto)
 *     → provider evidence (opaque)
 *     → verify/reconcile → { provider, external_ref, commitment_verdict, evidence:opaque }
 *     → PO confirmée UNIQUEMENT si commitment_verdict = 'committed'
 *
 * Minimum canonique figé (arbitrage) : provider, external_ref,
 * commitment_verdict, evidence opaque. Rien d'autre — quantité, prix,
 * statut natif, line item restent adapter-owned, jamais interprétés ici.
 *
 * Le besoin de réconciliation est une capability DÉCLARÉE par l'autorité
 * provider (provider-authority.js:reconciliationRequirement), jamais
 * dérivée de la présence/absence d'un adapter — même discipline que
 * GAP-4A (remotePreflightRequirement) et GAP-4B (validateExecutionAdapter).
 * Un adapter manquant pour un provider REQUIRED est un rejet explicite,
 * jamais un repli silencieux vers "pas nécessaire".
 *
 * Discovery (comment obtenir une external_ref quand aucune n'a été
 * fournie a priori) reste strictement hors de cette frontière et
 * provider-specific (arbitrage — pas de framework Discovery générique) :
 * cette fonction vérifie une external_ref déjà connue, elle n'en
 * découvre jamais une.
 *
 * Chemin futur pour un adapter auto (documenté, non codé) : placeOrder()
 * produit son external_ref de façon synchrone → reconcile() devient
 * trivial (evidence = la réponse API elle-même, déjà en main) → même
 * frontière, même confirmation. Aucun code Purchasing-specific provider
 * dans le cœur.
 */
'use strict';

const providerAuthority = require('./provider-authority');
const adapterContract = require('./supplier-fulfillment-adapter-contract');

const COMMITMENT_VERDICT = Object.freeze({
  COMMITTED: 'committed',
  REJECTED: 'rejected',
});

function rejected(provider, reason, extra = {}) {
  return {
    required: true,
    provider: provider || null,
    external_ref: null,
    commitment_verdict: COMMITMENT_VERDICT.REJECTED,
    evidence: { reason, ...extra },
  };
}

/**
 * @param {object} params
 * @param {object} [params.identity] Supplier Order Identity normalisée de
 *   la PO à confirmer. Absente ou sans `.provider` → réconciliation non
 *   requise (comportement legacy préservé pour les PO sans identité
 *   structurée — la majorité aujourd'hui).
 * @param {string} [params.externalRef] Référence externe à vérifier (ex.
 *   pour Allegro : le checkoutFormId communiqué par l'opérateur).
 * @param {string} [params.supplierUnitRef]
 * @param {string} [params.supplierSku]
 * @param {number} [params.quantity]
 * @param {object} [params.adapters] registry provider→adapter (réutiliser
 *   EXECUTION_ADAPTER_REGISTRY de GAP-2, ne pas en construire un second).
 * @param {object} [params.context]
 * @returns {{required: boolean, provider: (string|null), external_ref: (string|null), commitment_verdict: (string|undefined), evidence: (object|undefined)}}
 *   `required: false` signifie que ce provider n'a aucune capability de
 *   réconciliation prouvée — le caller garde son comportement historique
 *   (confiance dans l'external_ref fourni, non vérifié). `required: true`
 *   signifie que `commitment_verdict` gouverne strictement : seul
 *   `'committed'` autorise la confirmation.
 */
async function verifyProviderEvidenceForConfirmation({
  identity = null,
  externalRef = null,
  supplierUnitRef = null,
  supplierSku = null,
  quantity = null,
  adapters = {},
  context = {},
} = {}) {
  if (!identity || typeof identity !== 'object' || !identity.provider) {
    return { required: false, provider: null };
  }

  const requirement = providerAuthority.reconciliationRequirement(identity.provider);

  if (requirement === providerAuthority.PREFLIGHT_REQUIREMENT.UNKNOWN) {
    return rejected(identity.provider, 'RECONCILIATION_REQUIREMENT_UNKNOWN');
  }
  if (requirement === providerAuthority.PREFLIGHT_REQUIREMENT.NOT_REQUIRED) {
    return { required: false, provider: identity.provider };
  }

  // requirement === REQUIRED
  const adapterCheck = adapterContract.validateReconciliationAdapter(identity.provider, adapters[identity.provider]);
  if (!adapterCheck.ok) {
    return rejected(identity.provider, 'RECONCILIATION_ADAPTER_UNAVAILABLE', { adapter_reason: adapterCheck.reason });
  }
  if (!externalRef || typeof externalRef !== 'string' || !externalRef.trim()) {
    return rejected(identity.provider, 'EXTERNAL_REF_REQUIRED');
  }

  const verdict = await adapterCheck.adapter.reconcile({
    externalRef: externalRef.trim(),
    identity,
    supplierUnitRef,
    supplierSku,
    quantity,
    context,
  });

  return { required: true, ...verdict };
}

module.exports = { COMMITMENT_VERDICT, verifyProviderEvidenceForConfirmation };
