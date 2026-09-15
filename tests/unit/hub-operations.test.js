'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

jest.mock('../../db', () => ({
  query: jest.fn(),
  withTransaction: jest.fn(),
}));

jest.mock('../../services/hub-physical-identity', () => {
  class HubPhysicalError extends Error {
    constructor(code, message) { super(message || code); this.code = code; }
  }
  return {
    HubPhysicalError,
    createPhysicalUnit: jest.fn(),
    receiveSupplierPackage: jest.fn(),
    revalidateQuarantinedInbound: jest.fn(),
    transitionPhysicalUnit: jest.fn(),
    moveAllocationQuantity: jest.fn(),
    recordPhysicalUnitOutcome: jest.fn(),
  };
});

const db = require('../../db');
const hubPhysical = require('../../services/hub-physical-identity');
const hubOps = require('../../services/hub-operations');

const U1 = '00000000-0000-0000-0000-000000000101';
const U2 = '00000000-0000-0000-0000-000000000102';
const A1 = '00000000-0000-0000-0000-000000000201';
const PO1 = '00000000-0000-0000-0000-000000000301';
const I1 = '00000000-0000-0000-0000-000000000401';

function clientWithUnit(unit) {
  return { query: jest.fn().mockResolvedValue({ rows: unit ? [unit] : [] }) };
}

beforeEach(() => {
  jest.clearAllMocks();
  db.withTransaction.mockImplementation(async (work) => work(clientWithUnit(null)));
});

test('legacy /hub/scan is fail-closed and performs no DB mutation', async () => {
  const result = await hubOps.receiveParcel('LEGACY', 'u1');
  expect(result.status).toBe(410);
  expect(result.body.code).toBe('HUB_LEGACY_PARCEL_SCAN_DISABLED');
  expect(db.withTransaction).not.toHaveBeenCalled();
});

test('legacy batch scan is fail-closed', async () => {
  const result = await hubOps.batchScan(['P1'], 'u1');
  expect(result.status).toBe(410);
  expect(result.body.code).toBe('HUB_LEGACY_BATCH_SCAN_DISABLED');
});

test('canonical supplier receiving forwards exact multi-PO manifest to HUB-001', async () => {
  hubPhysical.receiveSupplierPackage.mockResolvedValue({ quarantined: false, unit: { id: U1 } });
  const tx = clientWithUnit(null);
  db.withTransaction.mockImplementation(async (work) => work(tx));

  const result = await hubOps.receiveSupplierPackageCommand({
    reference: 'SUP-MIX-001',
    external_ref: 'TRACK-1',
    location_ref: 'HUB-DXB-A1',
    contents: [
      { purchase_order_id: PO1, quantity: 1 },
      { purchase_order_id: '00000000-0000-0000-0000-000000000302', quantity: 2 },
    ],
  }, 'user-1');

  expect(result.status).toBe(201);
  expect(hubPhysical.receiveSupplierPackage).toHaveBeenCalledWith(tx, expect.objectContaining({
    reference: 'SUP-MIX-001',
    actorId: 'user-1',
    contents: [
      { purchase_order_id: PO1, quantity: 1 },
      { purchase_order_id: '00000000-0000-0000-0000-000000000302', quantity: 2 },
    ],
  }));
});

test('quarantined receiving returns 202 and preserves incident result', async () => {
  hubPhysical.receiveSupplierPackage.mockResolvedValue({ quarantined: true, unit: { id: U1 }, incident: { id: I1 } });
  const result = await hubOps.receiveSupplierPackageCommand({
    reference: 'SUP-BAD-001',
    contents: [{ purchase_order_id: PO1, quantity: 1 }],
  }, 'user-1');
  expect(result.status).toBe(202);
  expect(result.body.incident.id).toBe(I1);
});

test('invalid receipt quantity fails before HUB-001 call', async () => {
  const result = await hubOps.receiveSupplierPackageCommand({
    reference: 'SUP-BAD-QTY',
    contents: [{ purchase_order_id: PO1, quantity: 0 }],
  }, 'user-1');
  expect(result.status).toBe(400);
  expect(hubPhysical.receiveSupplierPackage).not.toHaveBeenCalled();
});

test('operator can create only HANDLING_UNIT or MARKET_PARCEL', async () => {
  hubPhysical.createPhysicalUnit.mockResolvedValue({ id: U1, unit_type: 'MARKET_PARCEL', state: 'RECEIVED' });
  const ok = await hubOps.createOperatorUnitCommand({ reference: 'MP-1', unit_type: 'MARKET_PARCEL' }, 'user-1');
  expect(ok.status).toBe(201);

  const denied = await hubOps.createOperatorUnitCommand({ reference: 'SUP-1', unit_type: 'SUPPLIER_PACKAGE' }, 'user-1');
  expect(denied.status).toBe(400);
});

test('operator transition cannot skip nominal custody sequence', async () => {
  const tx = clientWithUnit({ id: U1, unit_type: 'MARKET_PARCEL', state: 'RECEIVED' });
  db.withTransaction.mockImplementation(async (work) => work(tx));

  const denied = await hubOps.transitionOperatorUnitCommand({ unit_id: U1, to_state: 'PACKED' }, 'user-1');
  expect(denied.status).toBe(409);
  expect(denied.body.code).toBe('HUB_OPERATOR_TRANSITION_FORBIDDEN');
  expect(hubPhysical.transitionPhysicalUnit).not.toHaveBeenCalled();
});

test('operator transition advances exactly one state', async () => {
  const tx = clientWithUnit({ id: U1, unit_type: 'HANDLING_UNIT', state: 'RECEIVED' });
  db.withTransaction.mockImplementation(async (work) => work(tx));
  hubPhysical.transitionPhysicalUnit.mockResolvedValue({ noop: false, unit: { id: U1, state: 'IDENTIFIED' } });

  const result = await hubOps.transitionOperatorUnitCommand({ unit_id: U1, to_state: 'IDENTIFIED' }, 'user-1');
  expect(result.status).toBe(200);
  expect(hubPhysical.transitionPhysicalUnit).toHaveBeenCalledWith(tx, expect.objectContaining({
    unitId: U1, toState: 'IDENTIFIED', actorId: 'user-1',
  }));
});

test('PACKED requires a MARKET_PARCEL', async () => {
  const tx = clientWithUnit({ id: U1, unit_type: 'HANDLING_UNIT', state: 'PICKED' });
  db.withTransaction.mockImplementation(async (work) => work(tx));
  const result = await hubOps.packParcel(U1, 'user-1');
  expect(result.status).toBe(409);
  expect(result.body.code).toBe('HUB_OPERATOR_OUTBOUND_TYPE_REQUIRED');
});

test('pack is PICKED → PACKED on the exact physical unit', async () => {
  const tx = clientWithUnit({ id: U1, unit_type: 'MARKET_PARCEL', state: 'PICKED' });
  db.withTransaction.mockImplementation(async (work) => work(tx));
  hubPhysical.transitionPhysicalUnit.mockResolvedValue({ unit: { id: U1, unit_type: 'MARKET_PARCEL', state: 'PACKED' } });

  const result = await hubOps.packParcel(U1, 'user-1', 'BOX-1', 'ok');
  expect(result.status).toBe(200);
  expect(hubPhysical.transitionPhysicalUnit).toHaveBeenCalledWith(tx, expect.objectContaining({ unitId: U1, toState: 'PACKED' }));
});

test('seal is strictly PACKED → DISPATCHED and never order-scoped', async () => {
  const tx = clientWithUnit({ id: U1, unit_type: 'MARKET_PARCEL', state: 'PACKED' });
  db.withTransaction.mockImplementation(async (work) => work(tx));
  hubPhysical.transitionPhysicalUnit.mockResolvedValue({ unit: { id: U1, unit_type: 'MARKET_PARCEL', state: 'DISPATCHED' } });

  const result = await hubOps.sealParcel(U1, 'user-1', 'sealed');
  expect(result.status).toBe(200);
  expect(hubPhysical.transitionPhysicalUnit).toHaveBeenCalledWith(tx, expect.objectContaining({ unitId: U1, toState: 'DISPATCHED' }));
});

test('SPLIT/MERGE/REPACK command passes only physical placement identifiers', async () => {
  hubPhysical.moveAllocationQuantity.mockResolvedValue({ operation_id: 'op1', operation_type: 'SPLIT' });
  const tx = clientWithUnit(null);
  db.withTransaction.mockImplementation(async (work) => work(tx));

  const result = await hubOps.moveAllocationCommand({
    from_unit_id: U1,
    to_unit_id: U2,
    allocation_id: A1,
    quantity: 1,
    operation_type: 'SPLIT',
  }, 'user-1');
  expect(result.status).toBe(200);
  expect(hubPhysical.moveAllocationQuantity).toHaveBeenCalledWith(tx, expect.objectContaining({
    fromUnitId: U1,
    toUnitId: U2,
    allocationId: A1,
    quantity: 1,
    operationType: 'SPLIT',
  }));
});

test('quarantine revalidation delegates to F3-backed HUB-001 boundary', async () => {
  hubPhysical.revalidateQuarantinedInbound.mockResolvedValue({ resolved: true, unit: { id: U1, state: 'RECEIVED' } });
  const result = await hubOps.revalidateQuarantineCommand({ unit_id: U1, incident_id: I1 }, 'user-1');
  expect(result.status).toBe(200);
  expect(hubPhysical.revalidateQuarantinedInbound).toHaveBeenCalled();
});

test('physical outcome delegates atomically to HUB-001/F0 boundary', async () => {
  hubPhysical.recordPhysicalUnitOutcome.mockResolvedValue({ noop: false, unit: { id: U1 }, outbox_event_id: 'ev1' });
  const result = await hubOps.recordPhysicalOutcomeCommand({ unit_id: U1, outcome_type: 'LOST' }, 'user-1');
  expect(result.status).toBe(200);
  expect(hubPhysical.recordPhysicalUnitOutcome).toHaveBeenCalled();
});
