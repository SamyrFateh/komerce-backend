'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const {
  classifyProof,
  reconcileCustomerHandoff,
} = require('../../services/customer-handoff-reconciliation');

function client(script) {
  const query = jest.fn();
  for (const rows of script) query.mockResolvedValueOnce({ rows });
  return { query };
}

const order = (overrides = {}) => ({
  id: '11111111-1111-4111-8111-111111111111',
  reference: 'K-HANDOFF-1',
  status: 'available',
  relais_id: '22222222-2222-4222-8222-222222222222',
  ...overrides,
});

const parcel = (id, status, ref) => ({
  id,
  reference: ref,
  status,
  shipped_at: status === 'preparation' ? null : '2026-10-06T10:00:00Z',
  in_transit_at: ['in_transit', 'arrived', 'available', 'collected'].includes(status)
    ? '2026-10-06T12:00:00Z'
    : null,
  arrived_at: ['arrived', 'available', 'collected'].includes(status)
    ? '2026-10-06T14:00:00Z'
    : null,
  available_at: ['available', 'collected'].includes(status)
    ? '2026-10-06T15:00:00Z'
    : null,
  collected_at: status === 'collected' ? '2026-10-06T16:00:00Z' : null,
});

const scan = (overrides = {}) => ({
  id: '44444444-4444-4444-8444-444444444444',
  order_id: order().id,
  parcel_id: '33333333-3333-4333-8333-333333333333',
  step: 'collected',
  scan_code: order().reference,
  scanned_by: '55555555-5555-4555-8555-555555555555',
  notes: 'Retrait confirmé — code secret vérifié au guichet relais',
  pickup_method: 'PICKUP_CODE',
  authorization_version: null,
  document_checked: false,
  pickup_relais_id: order().relais_id,
  created_at: '2026-10-06T16:00:00Z',
  ...overrides,
});

test('PICKUP_CODE is a valid handoff proof', () => {
  expect(classifyProof(scan())).toEqual({
    valid: true,
    method: 'PICKUP_CODE',
    reason: null,
  });
});

test('authorized-name proof requires authorization version and checked document', () => {
  expect(classifyProof(scan({
    pickup_method: 'AUTHORIZED_NAME_ID_CHECK',
    authorization_version: 3,
    document_checked: true,
  }))).toEqual({
    valid: true,
    method: 'AUTHORIZED_NAME_ID_CHECK',
    reason: null,
  });

  expect(classifyProof(scan({
    pickup_method: 'AUTHORIZED_NAME_ID_CHECK',
    authorization_version: null,
    document_checked: false,
  }))).toEqual({
    valid: false,
    method: 'AUTHORIZED_NAME_ID_CHECK',
    reason: 'AUTHORIZED_COLLECTION_PROOF_INCOMPLETE',
  });
});

test('validated QR collection is a valid handoff proof', () => {
  expect(classifyProof(scan({
    pickup_method: null,
    scan_code: 'QR-abcd1234',
    notes: 'Retrait client via QR Code — token validé',
  }))).toEqual({
    valid: true,
    method: 'QR_TOKEN',
    reason: null,
  });
});

test('available parcel without collection proof remains HANDOFF_PENDING', async () => {
  const p = parcel('33333333-3333-4333-8333-333333333333', 'available', 'KOM-BOX-1');
  const c = client([[order()], [p], []]);

  await expect(reconcileCustomerHandoff(c, { orderId: order().id }))
    .resolves.toMatchObject({
      verdict: 'HANDOFF_PENDING',
      reason: 'CUSTOMER_HANDOFF_NOT_COLLECTED',
      parcel_count: 1,
      collected_parcel_count: 0,
    });
});

test('parcel marked collected without authorized scan proof is a mismatch', async () => {
  const p = parcel('33333333-3333-4333-8333-333333333333', 'collected', 'KOM-BOX-1');
  const c = client([[order({ status: 'collected' })], [p], []]);

  await expect(reconcileCustomerHandoff(c, { orderId: order().id }))
    .resolves.toMatchObject({
      verdict: 'HANDOFF_MISMATCH',
      reason: 'CUSTOMER_HANDOFF_COLLECTED_WITHOUT_PROOF',
    });
});

test('one collected parcel with PICKUP_CODE proof closes the handoff', async () => {
  const p = parcel('33333333-3333-4333-8333-333333333333', 'collected', 'KOM-BOX-1');
  const c = client([
    [order({ status: 'collected' })],
    [p],
    [scan({ parcel_id: p.id })],
  ]);

  const out = await reconcileCustomerHandoff(c, { orderId: order().id });

  expect(out).toMatchObject({
    verdict: 'HANDOFF_MATCHED',
    reason: null,
    parcel_count: 1,
    collected_parcel_count: 1,
  });
  expect(out.proofs).toEqual([
    expect.objectContaining({
      parcel_id: p.id,
      method: 'PICKUP_CODE',
    }),
  ]);
});

test('split order remains pending until every active parcel is collected with proof', async () => {
  const p1 = parcel('33333333-3333-4333-8333-333333333331', 'collected', 'KOM-BOX-1');
  const p2 = parcel('33333333-3333-4333-8333-333333333332', 'available', 'KOM-BOX-2');
  const c = client([
    [order({ status: 'available' })],
    [p1, p2],
    [scan({ parcel_id: p1.id })],
  ]);

  await expect(reconcileCustomerHandoff(c, { orderId: order().id }))
    .resolves.toMatchObject({
      verdict: 'HANDOFF_PENDING',
      reason: 'CUSTOMER_HANDOFF_PARTIAL_COLLECTION',
      parcel_count: 2,
      collected_parcel_count: 1,
    });
});

test('invalid exceptional proof on a collected parcel forces mismatch', async () => {
  const p = parcel('33333333-3333-4333-8333-333333333333', 'collected', 'KOM-BOX-1');
  const c = client([
    [order({ status: 'collected' })],
    [p],
    [scan({
      parcel_id: p.id,
      pickup_method: 'AUTHORIZED_NAME_ID_CHECK',
      authorization_version: null,
      document_checked: false,
    })],
  ]);

  const out = await reconcileCustomerHandoff(c, { orderId: order().id });

  expect(out).toMatchObject({
    verdict: 'HANDOFF_MISMATCH',
    reason: 'CUSTOMER_HANDOFF_COLLECTED_WITHOUT_PROOF',
  });
  expect(out.invalid_proofs).toEqual([
    expect.objectContaining({
      parcel_id: p.id,
      reason: 'AUTHORIZED_COLLECTION_PROOF_INCOMPLETE',
    }),
  ]);
});

test('all parcels proved collected but order lifecycle not collected is inconsistent', async () => {
  const p = parcel('33333333-3333-4333-8333-333333333333', 'collected', 'KOM-BOX-1');
  const c = client([
    [order({ status: 'available' })],
    [p],
    [scan({ parcel_id: p.id })],
  ]);

  await expect(reconcileCustomerHandoff(c, { orderId: order().id }))
    .resolves.toMatchObject({
      verdict: 'HANDOFF_MISMATCH',
      reason: 'CUSTOMER_HANDOFF_ORDER_STATUS_INCONSISTENT',
    });
});

test('legacy order without parcels can close only with a canonical collected scan', async () => {
  const c = client([
    [order({ status: 'collected' })],
    [],
    [scan({ parcel_id: null })],
  ]);

  await expect(reconcileCustomerHandoff(c, { orderId: order().id }))
    .resolves.toMatchObject({
      verdict: 'HANDOFF_MATCHED',
      parcel_count: 0,
      collected_parcel_count: 0,
    });
});
