/**
 * @komerce-arch
 * @role          purchasing-capability-execution-plan
 * @domain        purchasing
 * @layer         service
 * @criticality   high
 * @inputs        provider adapter + canonical readiness verdict
 * @outputs       capability-driven execution plan (AUTO_API / MANUAL_EXTERNAL / READINESS_ONLY / BLOCKED)
 * @depends       services/suppliers/supplier-fulfillment-adapter-contract.js
 * @used-by       purchasing orchestration / cockpit / future provider automation
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_PURCHASING_PROVIDER_GOLDEN_E2E.md, docs/doctrine/DOCTRINE_PURCHASING_CAPABILITY_DRIVEN_EXECUTION.md
 * @impact-areas  purchasing, supplier-integration, operations
 */
'use strict';

const adapterContract = require('./supplier-fulfillment-adapter-contract');

const MODE = Object.freeze({
  AUTO_API: 'AUTO_API',
  MANUAL_EXTERNAL: 'MANUAL_EXTERNAL',
  READINESS_ONLY: 'READINESS_ONLY',
  BLOCKED: 'BLOCKED',
});

function fn(adapter, name) {
  return Boolean(adapter && typeof adapter[name] === 'function');
}

function summarizeCapabilities(provider, adapter) {
  const base = adapterContract.validateAdapter(provider, adapter);
  return {
    provider,
    evaluate: base.ok && fn(adapter, 'evaluate'),
    build_order_payload: base.ok && fn(adapter, 'buildOrderPayload'),
    place_order: base.ok && fn(adapter, 'placeOrder'),
    reconcile: base.ok && fn(adapter, 'reconcile'),
    adapter_valid: base.ok,
    adapter_reason: base.ok ? null : base.reason,
  };
}

function deriveExecutionPlan({ provider, adapter, readiness } = {}) {
  const capabilities = summarizeCapabilities(provider, adapter);
  const evidence = readiness && readiness.preflight && readiness.preflight.evidence
    ? readiness.preflight.evidence
    : readiness && readiness.evidence
      ? readiness.evidence
      : {};

  if (!readiness || readiness.ready !== true) {
    return {
      provider,
      mode: MODE.BLOCKED,
      can_advance: false,
      capabilities,
      automation: { submit_order: false, reconcile: false },
      manual_gap: null,
      reason: readiness?.reason || readiness?.status || 'READINESS_NOT_CONFIRMED',
    };
  }

  if (capabilities.build_order_payload && capabilities.place_order) {
    return {
      provider,
      mode: MODE.AUTO_API,
      can_advance: true,
      capabilities,
      automation: {
        submit_order: true,
        reconcile: capabilities.reconcile,
      },
      manual_gap: capabilities.reconcile ? null : {
        step: 'SUPPLIER_COMMITMENT_EVIDENCE',
        reason: 'Provider order can be created automatically but no reconcile() capability is available.',
      },
      reason: null,
    };
  }

  if (capabilities.build_order_payload && evidence.manual_procurement_ready === true) {
    return {
      provider,
      mode: MODE.MANUAL_EXTERNAL,
      can_advance: true,
      capabilities,
      automation: {
        submit_order: false,
        reconcile: capabilities.reconcile,
      },
      manual_gap: {
        step: 'PLACE_ORDER_OUTSIDE_API',
        reason: 'Provider order creation is outside the proved API contract.',
        operator_input_required: capabilities.reconcile ? ['external_order_reference'] : ['external_order_reference', 'supplier_commitment_evidence'],
      },
      reason: null,
    };
  }

  return {
    provider,
    mode: MODE.READINESS_ONLY,
    can_advance: false,
    capabilities,
    automation: {
      submit_order: false,
      reconcile: capabilities.reconcile,
    },
    manual_gap: {
      step: 'EXECUTION_PATH_NOT_PROVEN',
      reason: 'Readiness is proved, but neither automatic order creation nor a proved manual procurement path is available.',
      missing_capabilities: [
        ...(!capabilities.build_order_payload ? ['buildOrderPayload'] : []),
        ...(!capabilities.place_order ? ['placeOrder'] : []),
      ],
    },
    reason: null,
  };
}

module.exports = {
  MODE,
  summarizeCapabilities,
  deriveExecutionPlan,
};
