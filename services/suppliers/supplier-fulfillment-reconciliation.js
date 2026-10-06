/**
 * @komerce-arch
 * @role          supplier-fulfillment-reconciliation
 * @domain        purchasing
 * @layer         service
 * @criticality   high
 * @inputs        expected fulfillment facts, observed provider facts, bounded evidence
 * @outputs       canonical FULFILLMENT reconciliation result
 * @depends       services/suppliers/supplier-reconciliation-contract.js
 * @used-by       provider-specific fulfillment readers
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_SUPPLIER_RECONCILIATION.md, docs/doctrine/DOCTRINE_SUPPLIER_FULFILLMENT_FACT.md
 * @impact-areas  purchasing, supplier-integration
 */
'use strict';

const { SCOPE, VERDICT, createResult } = require('./supplier-reconciliation-contract');

function qty(value) {
  return Number.isSafeInteger(Number(value)) ? Number(value) : null;
}

function reconcileFulfillment({
  provider,
  externalRef = null,
  expected = {},
  observed = {},
  evidence = {},
} = {}) {
  const expectedQty = qty(expected.quantity);
  const observedQty = observed.quantity == null ? null : qty(observed.quantity);

  if (!expectedQty || expectedQty < 1) {
    throw new Error('FULFILLMENT_EXPECTED_QUANTITY_INVALID');
  }

  if (observed.not_found === true) {
    return createResult({
      scope: SCOPE.FULFILLMENT,
      provider,
      verdict: VERDICT.NOT_FOUND,
      expected,
      observed,
      evidence,
      external_ref: externalRef,
      reason: 'FULFILLMENT_PROVIDER_FACT_NOT_FOUND',
    });
  }

  if (observed.ambiguous === true) {
    return createResult({
      scope: SCOPE.FULFILLMENT,
      provider,
      verdict: VERDICT.AMBIGUOUS,
      expected,
      observed,
      evidence,
      external_ref: externalRef,
      reason: 'FULFILLMENT_PROVIDER_FACT_AMBIGUOUS',
    });
  }

  if (observed.pending === true) {
    return createResult({
      scope: SCOPE.FULFILLMENT,
      provider,
      verdict: VERDICT.PENDING,
      expected,
      observed,
      evidence,
      external_ref: externalRef,
      reason: 'FULFILLMENT_PROVIDER_PENDING',
    });
  }

  if (observedQty == null || observedQty !== expectedQty) {
    return createResult({
      scope: SCOPE.FULFILLMENT,
      provider,
      verdict: VERDICT.MISMATCH,
      expected,
      observed,
      evidence,
      external_ref: externalRef,
      reason: 'FULFILLMENT_QUANTITY_MISMATCH',
    });
  }

  if (!String(observed.provider_status || '').trim() && !String(observed.tracking_number || '').trim()) {
    return createResult({
      scope: SCOPE.FULFILLMENT,
      provider,
      verdict: VERDICT.PENDING,
      expected,
      observed,
      evidence,
      external_ref: externalRef,
      reason: 'FULFILLMENT_PROVIDER_FACT_INCOMPLETE',
    });
  }

  return createResult({
    scope: SCOPE.FULFILLMENT,
    provider,
    verdict: VERDICT.MATCHED,
    expected,
    observed,
    evidence,
    external_ref: externalRef,
  });
}

module.exports = { reconcileFulfillment };
