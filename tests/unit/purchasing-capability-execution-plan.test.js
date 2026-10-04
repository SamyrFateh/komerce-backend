'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const { MODE, deriveExecutionPlan } = require('../../services/suppliers/purchasing-capability-execution-plan');

function readiness(evidence = {}) {
  return {
    ready: true,
    status: 'FULFILLMENT_READY',
    preflight: { ready: true, evidence },
  };
}

test('capability plan — full adapter devient AUTO_API', () => {
  const adapter = {
    provider: 'demo',
    evaluate: jest.fn(),
    buildOrderPayload: jest.fn(),
    placeOrder: jest.fn(),
    reconcile: jest.fn(),
  };
  expect(deriveExecutionPlan({ provider: 'demo', adapter, readiness: readiness() })).toMatchObject({
    mode: MODE.AUTO_API,
    can_advance: true,
    automation: { submit_order: true, reconcile: true },
    manual_gap: null,
  });
});

test('capability plan — Allegro-like devient MANUAL_EXTERNAL', () => {
  const adapter = {
    provider: 'allegro',
    evaluate: jest.fn(),
    buildOrderPayload: jest.fn(),
    reconcile: jest.fn(),
  };
  expect(deriveExecutionPlan({
    provider: 'allegro',
    adapter,
    readiness: readiness({ manual_procurement_ready: true }),
  })).toMatchObject({
    mode: MODE.MANUAL_EXTERNAL,
    can_advance: true,
    automation: { submit_order: false, reconcile: true },
    manual_gap: {
      step: 'PLACE_ORDER_OUTSIDE_API',
      operator_input_required: ['external_order_reference'],
    },
  });
});

test('capability plan — AliExpress-like readiness seule reste READINESS_ONLY', () => {
  const adapter = {
    provider: 'aliexpress',
    evaluate: jest.fn(),
  };
  expect(deriveExecutionPlan({
    provider: 'aliexpress',
    adapter,
    readiness: readiness({ exact_unit_resolved: true }),
  })).toMatchObject({
    mode: MODE.READINESS_ONLY,
    can_advance: false,
    manual_gap: {
      step: 'EXECUTION_PATH_NOT_PROVEN',
      missing_capabilities: ['buildOrderPayload', 'placeOrder'],
    },
  });
});

test('capability plan — aucune readiness ne déclenche jamais un fallback manuel', () => {
  const adapter = {
    provider: 'demo',
    evaluate: jest.fn(),
    buildOrderPayload: jest.fn(),
  };
  const plan = deriveExecutionPlan({
    provider: 'demo',
    adapter,
    readiness: { ready: false, status: 'OUT_OF_STOCK', reason: 'stock' },
  });
  expect(plan).toMatchObject({
    mode: MODE.BLOCKED,
    can_advance: false,
    manual_gap: null,
    reason: 'stock',
  });
});

test('capability plan — placeOrder sans reconcile automatise l achat mais expose le gap de preuve', () => {
  const adapter = {
    provider: 'demo',
    evaluate: jest.fn(),
    buildOrderPayload: jest.fn(),
    placeOrder: jest.fn(),
  };
  expect(deriveExecutionPlan({ provider: 'demo', adapter, readiness: readiness() })).toMatchObject({
    mode: MODE.AUTO_API,
    can_advance: true,
    automation: { submit_order: true, reconcile: false },
    manual_gap: { step: 'SUPPLIER_COMMITMENT_EVIDENCE' },
  });
});
