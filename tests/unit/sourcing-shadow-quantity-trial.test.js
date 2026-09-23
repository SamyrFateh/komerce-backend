'use strict';
/** @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const { STATUS, evaluateShadowQuantityTrial } = require('../../services/sourcing-shadow-quantity-trial');

const NOW = '2026-09-22T20:00:00.000Z';
const OBSERVED = '2026-09-22T19:59:00.000Z';
const AGE_POLICY_MS = 120000; // Trial input only, not an adopted provider freshness SLA.

function snapshot(supplierStock = 3, catalogStock = 3, extra = {}) {
  return {
    product_sku_id: 'sku-1', canonical_unit_id: 'unit-1',
    authority: 'shadow_read_only', commercial_readiness: 'NOT_EVALUATED',
    status: 'COMPARED', observed_at: OBSERVED,
    observed_supplier_stock: supplierStock, catalog_sku_stock: catalogStock,
    ...extra,
  };
}
function report(observations = [snapshot()], extra = {}) {
  return {
    authority_unchanged: true,
    stock_observations: observations,
    hard_failures: [], ambiguities: [], missing_identities: [],
    ...extra,
  };
}
function run(items, comparison = report(), override = {}) {
  return evaluateShadowQuantityTrial({
    items, report: comparison, now: NOW, maxObservationAgeMs: AGE_POLICY_MS, ...override,
  });
}

test('aggregates multiple lines of the SAME exact SKU before evaluating observed quantity', () => {
  const result = run([
    { sku_id: 'sku-1', quantity: 2 }, { sku_id: 'sku-1', quantity: 2 },
  ]);
  expect(result).toMatchObject({
    status: STATUS.SHORTFALL, authority: 'shadow_read_only',
    commercial_readiness: 'NOT_EVALUATED', supplier_reservation: 'NOT_PROVED',
    checkout_gate_invoked: false, provider_called: false,
    sku_evidence: [{
      sku_id: 'sku-1', requested_quantity: 4, status: STATUS.SHORTFALL,
      reason: 'SUPPLIER_OBSERVED_SHORTFALL', supplier_observed_stock: 3,
      catalog_sku_stock: 3,
    }],
  });
});

test('3 observed then 1: quantity 1 is only observed sufficient; quantity 2 is shortfall', () => {
  const one = run([{ sku_id: 'sku-1', quantity: 1 }], report([snapshot(1, 3)]));
  expect(one.status).toBe(STATUS.OBSERVED_SUFFICIENT);
  expect(one.sku_evidence[0]).toMatchObject({
    reason: 'OBSERVED_QUANTITY_ONLY', observation_age_ms: 60000,
  });
  expect(one.commercial_readiness).toBe('NOT_EVALUATED');
  expect(run([{ sku_id: 'sku-1', quantity: 2 }], report([snapshot(1, 3)])).status)
    .toBe(STATUS.SHORTFALL);
  expect(run([{ sku_id: 'sku-1', quantity: 2 }], report([snapshot(3, 1)]))
    .sku_evidence[0].reason).toBe('CATALOG_SNAPSHOT_SHORTFALL');
});

test('UNKNOWN does not become zero, available, or a checkout decision', () => {
  for (const stock of [null, undefined, -1, 1.5]) {
    const result = run([{ sku_id: 'sku-1', quantity: 1 }], report([snapshot(3, 3, { observed_supplier_stock: stock })]));
    expect(result).toMatchObject({ status: STATUS.UNKNOWN, commercial_readiness: 'NOT_EVALUATED' });
    expect(result.sku_evidence[0]).toMatchObject({ status: STATUS.UNKNOWN, reason: 'STOCK_UNKNOWN' });
  }
  const missing = run([{ sku_id: 'sku-1', quantity: 1 }], report([]));
  expect(missing.sku_evidence[0].reason).toBe('CANONICAL_IDENTITY_UNPROVEN');
  expect(run([{ sku_id: 'sku-1', quantity: 1 }], report([snapshot(0, 3)])).status)
    .toBe(STATUS.SHORTFALL);
});

test('stale, future or undated evidence is unknown with explicit caller policy', () => {
  for (const observed_at of [
    '2026-09-22T19:57:59.999Z', '2026-09-22T20:00:01.000Z', null,
  ]) {
    const result = run([{ sku_id: 'sku-1', quantity: 1 }],
      report([snapshot(3, 3, { observed_at })]));
    expect(result.status).toBe(STATUS.UNKNOWN);
    expect(result.sku_evidence[0].reason).toBe('OBSERVATION_AGE_UNPROVEN');
  }
  expect(run([{ sku_id: 'sku-1', quantity: 1 }], report(),
    { maxObservationAgeMs: undefined }).reason).toBe('INVALID_TRIAL_INPUT');
  expect(run([{ sku_id: 'sku-1', quantity: 1 }], report(),
    { now: '2026-09-22' }).status).toBe(STATUS.UNKNOWN);
});

test('identity ambiguity, duplicate mappings and unproved source scope refuse comparison', () => {
  const lines = [{ sku_id: 'sku-1', quantity: 1 }];
  expect(run(lines, report([snapshot()], {
    hard_failures: [{ product_sku_id: 'sku-1', reason: 'supplier_order_identity_mismatch' }],
  })).sku_evidence[0].reason).toBe('CANONICAL_IDENTITY_UNPROVEN');
  expect(run(lines, report([snapshot(), snapshot()]))
    .sku_evidence[0].reason).toBe('CANONICAL_IDENTITY_UNPROVEN');
  expect(run(lines, report([snapshot(), snapshot(3, 3, {
    product_sku_id: 'sku-2',
  })])).sku_evidence[0].reason).toBe('CANONICAL_IDENTITY_UNPROVEN');
  expect(run(lines, report([snapshot(3, 3, {
    status: 'UNKNOWN', reason: 'SOURCE_SCOPE_UNPROVEN',
  })])).sku_evidence[0].reason).toBe('OBSERVATION_UNKNOWN');
});

test('all SKU lines are checked, fail closed for missing evidence, invalid quantities or overflow', () => {
  const two = snapshot(2, 2, { product_sku_id: 'sku-2', canonical_unit_id: 'unit-2' });
  expect(run([
    { sku_id: 'sku-1', quantity: 1 }, { sku_id: 'sku-2', quantity: 2 },
  ], report([snapshot(), two])).status).toBe(STATUS.OBSERVED_SUFFICIENT);
  expect(run([
    { sku_id: 'sku-1', quantity: 1 }, { sku_id: 'sku-missing', quantity: 1 },
  ], report([snapshot()])).status).toBe(STATUS.UNKNOWN);
  for (const bad of [0, -1, 1.5, '2', undefined]) {
    expect(run([{ sku_id: 'sku-1', quantity: bad }]).reason).toBe('INVALID_QUANTITY_OR_SKU');
  }
  expect(run([
    { sku_id: 'sku-1', quantity: Number.MAX_SAFE_INTEGER },
    { sku_id: 'sku-1', quantity: 1 },
  ]).reason).toBe('QUANTITY_OVERFLOW');
});
