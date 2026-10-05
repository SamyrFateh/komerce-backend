/**
 * @komerce-arch
 * @role          supplier-reconciliation-contract
 * @domain        purchasing
 * @layer         service
 * @criticality   high
 * @inputs        reconciliation scope, expected facts, observed facts, bounded evidence, canonical verdict
 * @outputs       validated provider-agnostic reconciliation result
 * @depends       none
 * @used-by       purchasing reconciliation boundaries and provider adapters
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_SUPPLIER_RECONCILIATION.md
 * @impact-areas  purchasing, supplier-integration
 */
'use strict';

const SCOPE = Object.freeze({
  ORDER: 'ORDER',
  PAYMENT: 'PAYMENT',
  FULFILLMENT: 'FULFILLMENT',
});

const VERDICT = Object.freeze({
  MATCHED: 'MATCHED',
  NOT_FOUND: 'NOT_FOUND',
  MISMATCH: 'MISMATCH',
  AMBIGUOUS: 'AMBIGUOUS',
  PENDING: 'PENDING',
});

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeProvider(value) {
  return String(value || '').trim().toLowerCase();
}

function validateResult(result) {
  if (!isPlainObject(result)) return { ok: false, reason: 'RECONCILIATION_RESULT_REQUIRED' };
  if (!Object.values(SCOPE).includes(result.scope)) return { ok: false, reason: 'RECONCILIATION_SCOPE_INVALID' };
  if (!Object.values(VERDICT).includes(result.verdict)) return { ok: false, reason: 'RECONCILIATION_VERDICT_INVALID' };

  const provider = normalizeProvider(result.provider);
  if (!provider) return { ok: false, reason: 'RECONCILIATION_PROVIDER_REQUIRED' };

  if (!isPlainObject(result.expected)) return { ok: false, reason: 'RECONCILIATION_EXPECTED_REQUIRED' };
  if (!isPlainObject(result.observed)) return { ok: false, reason: 'RECONCILIATION_OBSERVED_REQUIRED' };
  if (!isPlainObject(result.evidence)) return { ok: false, reason: 'RECONCILIATION_EVIDENCE_REQUIRED' };

  if (result.external_ref != null && (typeof result.external_ref !== 'string' || !result.external_ref.trim())) {
    return { ok: false, reason: 'RECONCILIATION_EXTERNAL_REF_INVALID' };
  }

  if (result.reason != null && (typeof result.reason !== 'string' || !result.reason.trim())) {
    return { ok: false, reason: 'RECONCILIATION_REASON_INVALID' };
  }

  if (result.verdict !== VERDICT.MATCHED && !result.reason) {
    return { ok: false, reason: 'RECONCILIATION_NON_MATCH_REASON_REQUIRED' };
  }

  return { ok: true, provider };
}

function createResult({
  scope,
  provider,
  verdict,
  expected = {},
  observed = {},
  evidence = {},
  external_ref = null,
  reason = null,
} = {}) {
  const result = {
    scope,
    provider: normalizeProvider(provider),
    verdict,
    expected,
    observed,
    evidence,
    external_ref: external_ref == null ? null : String(external_ref).trim(),
    reason,
  };
  const checked = validateResult(result);
  if (!checked.ok) throw new Error(checked.reason);
  return Object.freeze(result);
}

module.exports = {
  SCOPE,
  VERDICT,
  createResult,
  validateResult,
};
