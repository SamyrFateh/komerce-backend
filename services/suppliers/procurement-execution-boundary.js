/**
 * @komerce-arch
 * @role          procurement-execution-boundary
 * @domain        purchasing
 * @layer         service
 * @criticality   high
 * @inputs        canonical procurement readiness verdict (GAP-4A), provider adapters
 * @outputs       execution_boundary_verdict (crossed_or_not_reached)
 * @depends       services/suppliers/supplier-fulfillment-adapter-contract.js
 * @used-by       services/purchasing-trigger-service.js (GAP-4B)
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_CANONICAL_UNIT_PURCHASING.md, docs/gaps/GAP_SUPPLIER_CONNECTIVITY_ALIGNMENT.md
 * @impact-areas  purchasing, supplier-integration
 * @version       2026-09
 *
 * GAP-4B — Procurement Execution Boundary.
 *
 * "Cette unité, déjà jugée commandable par GAP-4A (readiness), doit-elle
 * être commandée automatiquement maintenant — et comment ?" C'est la
 * frontière d'exécution que GAP-4A refuse délibérément de franchir.
 *
 * Ne s'atteint QUE si auto_order=true pour ce mapping fournisseur ; le
 * chemin manuel/whatsapp ne traverse jamais ce module (voir
 * canonical-unit-purchasing-gate.js pour la doctrine complète).
 *
 * Exige placeOrder ET buildOrderPayload sur le MÊME adapter (jamais l'un
 * via un provider substitué). Aujourd'hui, aucun adapter du registry
 * d'exécution (allegro, aliexpress) n'a les deux — fait constaté, pas une
 * lacune de ce module — donc ce chemin n'est jamais exercé en production
 * et le comportement Golden (fallback vers notification manuelle) reste
 * inchangé. Le jour où un adapter réel aura les deux capacités, ce module
 * (et lui seul) est le point où l'exécution automatique s'active.
 */
'use strict';

const adapterContract = require('./supplier-fulfillment-adapter-contract');

const NOT_REACHED = 'EXECUTION_BOUNDARY_NOT_REACHED';

function notReached(reason, evidence = {}) {
  return { crossed: false, status: NOT_REACHED, reason, evidence, place_order_invoked: false };
}

/**
 * @param {object} params
 * @param {object} params.identity Supplier Order Identity normalisée (GAP-4A).
 * @param {number} params.quantity
 * @param {object} params.canonicalUnit Canonical Unit résolue (GAP-4A,
 *   `readiness.canonical_unit` — donnée brute, jamais un payload construit).
 * @param {object} [params.preflight] Verdict preflight distant (GAP-4A), passé
 *   tel quel à buildOrderPayload — jamais réinterprété ici.
 * @param {object} [params.context]
 * @param {object} [params.adapters] registry provider→adapter (réutiliser
 *   EXECUTION_ADAPTER_REGISTRY de GAP-2, ne pas en construire un second).
 */
async function evaluateProcurementExecutionBoundary({
  identity,
  quantity,
  canonicalUnit,
  preflight = null,
  context = {},
  adapters = {},
} = {}) {
  if (!identity || typeof identity !== 'object') {
    return notReached('IDENTITY_REQUIRED');
  }

  const adapterCheck = adapterContract.validateExecutionAdapter(identity.provider, adapters[identity.provider]);
  if (!adapterCheck.ok) {
    return notReached('EXECUTION_ADAPTER_INCOMPLETE', { provider: identity.provider, reason: adapterCheck.reason });
  }

  let payload;
  try {
    payload = await adapterCheck.adapter.buildOrderPayload({ identity, quantity, canonicalUnit, preflight, context });
  } catch (error) {
    return notReached('BUILD_ORDER_PAYLOAD_ERROR', { provider: identity.provider, error_name: error?.name || 'Error' });
  }
  if (payload === null || payload === undefined) {
    return notReached('BUILD_ORDER_PAYLOAD_EMPTY', { provider: identity.provider });
  }

  let result;
  try {
    result = await adapterCheck.adapter.placeOrder(payload, context);
  } catch (error) {
    return notReached('PLACE_ORDER_ERROR', { provider: identity.provider, error_name: error?.name || 'Error' });
  }

  return {
    crossed: true,
    status: 'EXECUTION_BOUNDARY_CROSSED',
    place_order_invoked: true,
    provider: identity.provider,
    payload,
    result: result || {},
  };
}

module.exports = { NOT_REACHED, evaluateProcurementExecutionBoundary };
