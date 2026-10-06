'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const { reconcileHubInbound } = require('../../services/hub-inbound-reconciliation');

function client(script) {
  const query = jest.fn();
  for (const rows of script) query.mockResolvedValueOnce({ rows });
  return { query };
}

const fulfillment = (overrides = {}) => ({
  id: 'ful-1',
  supplier_execution_order_id: 'exec-1',
  provider: 'cj',
  expected_quantity: 2,
  observed_quantity: 2,
  provider_status: 'SHIPPED',
  tracking_number: 'TRK-1',
  reconciliation_status: 'matched',
  supplier_order_id: 'CJ-1',
  supplier_unit_ref: 'VID-1',
  facts: { supplier_unit_ref: 'VID-1' },
  ...overrides,
});

const lineage = [{
  purchase_line_id: '11111111-1111-4111-8111-111111111111',
  purchase_order_id: '22222222-2222-4222-8222-222222222222',
  order_item_id: '33333333-3333-4333-8333-333333333333',
  supplier_unit_ref: 'VID-1',
  supplier_execution_quantity: 2,
}];

test('supplier tracking alone never proves Hub receipt', async () => {
  const c = client([
    [fulfillment()],
    lineage,
    [{
      received_quantity: 0,
      has_quarantine: false,
      hub_unit_refs: [],
      hub_unit_ids: [],
    }],
    [],
  ]);

  const out = await reconcileHubInbound(c, { supplierFulfillmentId: 'ful-1' });

  expect(out).toMatchObject({
    scope: 'HUB_INBOUND',
    verdict: 'PENDING',
    reason: 'HUB_INBOUND_NOT_RECEIVED',
    expected_quantity: 2,
    received_quantity: 0,
    supplier_tracking_number: 'TRK-1',
    supplier_tracking_present: true,
  });
});

test('upstream fulfillment not matched stays pending before any Hub inference', async () => {
  const c = client([
    [fulfillment({ reconciliation_status: 'pending' })],
  ]);

  await expect(reconcileHubInbound(c, { supplierFulfillmentId: 'ful-1' }))
    .resolves.toMatchObject({
      verdict: 'PENDING',
      reason: 'SUPPLIER_FULFILLMENT_NOT_MATCHED',
    });

  expect(c.query).toHaveBeenCalledTimes(1);
});

test('missing supplier-order to purchase-line lineage stays pending', async () => {
  const c = client([
    [fulfillment()],
    [],
  ]);

  await expect(reconcileHubInbound(c, { supplierFulfillmentId: 'ful-1' }))
    .resolves.toMatchObject({
      verdict: 'PENDING',
      reason: 'HUB_INBOUND_LINEAGE_MISSING',
    });
});

test('exact physical quantity with no anomaly becomes INBOUND_MATCHED', async () => {
  const c = client([
    [fulfillment()],
    lineage,
    [{
      received_quantity: 2,
      has_quarantine: false,
      hub_unit_refs: ['KOM-RCV-1'],
      hub_unit_ids: ['44444444-4444-4444-8444-444444444444'],
    }],
    [],
  ]);

  const out = await reconcileHubInbound(c, { supplierFulfillmentId: 'ful-1' });

  expect(out).toMatchObject({
    verdict: 'INBOUND_MATCHED',
    reason: null,
    expected_quantity: 2,
    received_quantity: 2,
    hub_unit_refs: ['KOM-RCV-1'],
  });
});

test('partial physical receipt stays pending', async () => {
  const c = client([
    [fulfillment()],
    lineage,
    [{
      received_quantity: 1,
      has_quarantine: false,
      hub_unit_refs: ['KOM-RCV-1'],
      hub_unit_ids: ['44444444-4444-4444-8444-444444444444'],
    }],
    [],
  ]);

  await expect(reconcileHubInbound(c, { supplierFulfillmentId: 'ful-1' }))
    .resolves.toMatchObject({
      verdict: 'PENDING',
      reason: 'HUB_INBOUND_PARTIAL_RECEIPT',
      expected_quantity: 2,
      received_quantity: 1,
    });
});

test('over-receipt is a mismatch', async () => {
  const c = client([
    [fulfillment()],
    lineage,
    [{
      received_quantity: 3,
      has_quarantine: false,
      hub_unit_refs: ['KOM-RCV-1'],
      hub_unit_ids: ['44444444-4444-4444-8444-444444444444'],
    }],
    [],
  ]);

  await expect(reconcileHubInbound(c, { supplierFulfillmentId: 'ful-1' }))
    .resolves.toMatchObject({
      verdict: 'MISMATCH',
      reason: 'HUB_INBOUND_OVER_RECEIVED',
      received_quantity: 3,
    });
});

test('quarantined physical unit forces mismatch even at exact quantity', async () => {
  const c = client([
    [fulfillment()],
    lineage,
    [{
      received_quantity: 2,
      has_quarantine: true,
      hub_unit_refs: ['KOM-RCV-1'],
      hub_unit_ids: ['44444444-4444-4444-8444-444444444444'],
    }],
    [],
  ]);

  await expect(reconcileHubInbound(c, { supplierFulfillmentId: 'ful-1' }))
    .resolves.toMatchObject({
      verdict: 'MISMATCH',
      reason: 'HUB_INBOUND_QUARANTINED',
    });
});

test('open physical incident forces mismatch and is exposed as evidence', async () => {
  const incident = {
    id: '55555555-5555-4555-8555-555555555555',
    incident_type: 'damaged_item',
    reason_code: 'HUB_DAMAGE',
  };
  const c = client([
    [fulfillment()],
    lineage,
    [{
      received_quantity: 2,
      has_quarantine: false,
      hub_unit_refs: ['KOM-RCV-1'],
      hub_unit_ids: ['44444444-4444-4444-8444-444444444444'],
    }],
    [incident],
  ]);

  const out = await reconcileHubInbound(c, { supplierFulfillmentId: 'ful-1' });

  expect(out).toMatchObject({
    verdict: 'MISMATCH',
    reason: 'HUB_INBOUND_PHYSICAL_INCIDENT',
    incidents: [{
      id: incident.id,
      incident_type: 'damaged_item',
      reason_code: 'HUB_DAMAGE',
    }],
  });
});
