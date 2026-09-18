/**
 * @komerce-arch
 * @role          supplier-fulfillment-adapter-contract
 * @domain        purchasing
 * @layer         service
 * @criticality   high
 * @inputs        provider, supplier fulfillment adapter, supplier fulfillment verdict
 * @outputs       validated adapter shape and canonical verdict contract
 * @depends       none
 * @used-by       services/suppliers/supplier-fulfillment-readiness.js, services/suppliers/procurement-execution-boundary.js (GAP-4B)
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_SUPPLIER_ORDER_IDENTITY.md
 * @impact-areas  purchasing, supplier-integration
 */
'use strict';

function normalizeProvider(value) {
  return String(value || '').trim().toLowerCase();
}

function validateAdapter(provider, adapter) {
  const expectedProvider = normalizeProvider(provider);
  if (!expectedProvider) return { ok: false, reason: 'provider fournisseur requis' };
  if (!adapter || typeof adapter !== 'object') {
    return { ok: false, reason: `Adapter fulfillment absent pour ${expectedProvider}` };
  }
  if (typeof adapter.evaluate !== 'function') {
    return { ok: false, reason: `Adapter fulfillment ${expectedProvider} sans evaluate()` };
  }

  const declaredProvider = normalizeProvider(adapter.provider);
  if (!declaredProvider) {
    return { ok: false, reason: `Adapter fulfillment ${expectedProvider} sans provider déclaré` };
  }
  if (declaredProvider !== expectedProvider) {
    return {
      ok: false,
      reason: `Adapter fulfillment provider mismatch: attendu ${expectedProvider}, reçu ${declaredProvider}`,
    };
  }

  return { ok: true, provider: expectedProvider, adapter };
}

/**
 * GAP-4B — Procurement Execution Boundary. Un adapter n'est éligible à
 * l'exécution automatique que s'il expose buildOrderPayload ET placeOrder
 * SUR LE MÊME adapter (jamais l'un via un provider, l'autre via un autre).
 * Réutilise validateAdapter pour le socle (provider match + evaluate) au
 * lieu de réimplémenter cette vérification.
 */
function validateExecutionAdapter(provider, adapter) {
  const base = validateAdapter(provider, adapter);
  if (!base.ok) return base;
  if (typeof base.adapter.buildOrderPayload !== 'function') {
    return { ok: false, reason: `Adapter fulfillment ${base.provider} sans buildOrderPayload()` };
  }
  if (typeof base.adapter.placeOrder !== 'function') {
    return { ok: false, reason: `Adapter fulfillment ${base.provider} sans placeOrder()` };
  }
  return { ok: true, provider: base.provider, adapter: base.adapter };
}

function validateVerdict(verdict, VERDICT) {
  if (!verdict || typeof verdict !== 'object' || Array.isArray(verdict)) {
    return { ok: false, reason: 'Verdict fulfillment absent ou invalide' };
  }
  if (!VERDICT || typeof VERDICT !== 'object') {
    return { ok: false, reason: 'Référentiel de verdicts fulfillment absent' };
  }

  const allowedStatuses = new Set(Object.values(VERDICT));
  if (typeof verdict.status !== 'string' || !allowedStatuses.has(verdict.status)) {
    return { ok: false, reason: `Statut fulfillment non canonique: ${String(verdict.status || '')}` };
  }
  if (typeof verdict.ready !== 'boolean') {
    return { ok: false, reason: 'Verdict fulfillment sans ready booléen' };
  }

  const expectedReady = verdict.status === VERDICT.READY;
  if (verdict.ready !== expectedReady) {
    return {
      ok: false,
      reason: `Incohérence fulfillment: ready=${verdict.ready} pour status=${verdict.status}`,
    };
  }
  if (verdict.evidence != null && (typeof verdict.evidence !== 'object' || Array.isArray(verdict.evidence))) {
    return { ok: false, reason: 'Verdict fulfillment evidence invalide' };
  }
  if (verdict.reason != null && typeof verdict.reason !== 'string') {
    return { ok: false, reason: 'Verdict fulfillment reason invalide' };
  }

  return { ok: true };
}

module.exports = {
  normalizeProvider,
  validateAdapter,
  validateExecutionAdapter,
  validateVerdict,
};
