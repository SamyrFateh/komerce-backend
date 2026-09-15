'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
let query;
let assertCompatible;
let splitPacking;
let splitEvidence;
let repackEvidence;

jest.mock('../../db', () => ({
  withTransaction: async (work) => work({ query: (...args) => query(...args) }),
}));

jest.mock('../../services/hub-allocation-service', () => ({
  assertParcelCompatible: (...args) => assertCompatible(...args),
  hubAllocationError: (code, message, details = {}) => Object.assign(new Error(message || code), { code, details }),
}));

jest.mock('../../services/parcel-item-mutation-service', () => ({
  splitParcelItemAllocation: (...args) => splitPacking(...args),
}));

jest.mock('../../services/scan-write-service', () => ({
  recordHubSplitEvent: (...args) => splitEvidence(...args),
  recordHubRepackEvent: (...args) => repackEvidence(...args),
}));

const svc = require('../../services/hub-packing-service');

const base = {
  id: 'inv-1', status: 'assigned', parcel_id: 'p-from', quantity: 3,
  order_id: 'o-1', order_item_id: 'oi-1', product_id: 'prod-1',
  purchase_order_id: 'po-1', identity_verified_at: new Date('2026-09-15T10:00:00Z'),
  received_at: new Date('2026-09-15T11:00:00Z'), received_by: 'u-recv',
  market_id: 'm-1', relais_id: 'r-1',
  purchase_order_order_id: 'o-1', purchase_order_item_id: 'oi-1', purchase_status: 'confirmed',
};

beforeEach(() => {
  query = jest.fn();
  assertCompatible = jest.fn();
  splitPacking = jest.fn();
  splitEvidence = jest.fn();
  repackEvidence = jest.fn();
});

describe('splitPhysicalAllocation', () => {
  test('split partiel crée un enfant de même identité avec lineage', async () => {
    query
      .mockResolvedValueOnce({ rows: [base] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ ...base, id: 'inv-child', quantity: 1, parcel_id: 'p-to', split_from_inventory_item_id: 'inv-1' }] });
    assertCompatible.mockResolvedValue({ id: 'p-to', reference: 'PT' });
    splitPacking.mockResolvedValue({ target_parcel_item_id: 'pi-to' });
    splitEvidence.mockResolvedValue({ id: 'ev-split' });

    const result = await svc.splitPhysicalAllocation({ inventory_item_id: 'inv-1', to_parcel_id: 'p-to', quantity: 1, actor_id: 'u-1' });
    expect(result).toMatchObject({ split: true, source_remaining_quantity: 2, evidence_scan_event_id: 'ev-split' });
    expect(query.mock.calls[2][0]).toContain('split_from_inventory_item_id');
    expect(query.mock.calls[2][1]).toEqual(expect.arrayContaining(['oi-1', 'o-1', 'prod-1', 1, 'po-1', 'inv-1', 'p-to']));
    expect(splitEvidence).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      sourceInventoryItemId: 'inv-1', childInventoryItemId: 'inv-child', purchaseOrderId: 'po-1',
    }));
  });

  test('split total est interdit car ce serait un move implicite', async () => {
    query.mockResolvedValueOnce({ rows: [base] });
    await expect(svc.splitPhysicalAllocation({ inventory_item_id: 'inv-1', to_parcel_id: 'p-to', quantity: 3 }))
      .rejects.toMatchObject({ code: 'HUB_SPLIT_MUST_LEAVE_SOURCE' });
    expect(assertCompatible).not.toHaveBeenCalled();
  });
});

describe('repackPhysicalAllocation', () => {
  test('repack complet change seulement le contenant et conserve l’identité', async () => {
    query
      .mockResolvedValueOnce({ rows: [base] })
      .mockResolvedValueOnce({ rows: [
        { id: 'pi-from', parcel_id: 'p-from', quantity: 3 },
      ] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ ...base, parcel_id: 'p-to' }] });
    assertCompatible.mockResolvedValue({ id: 'p-to', reference: 'PT' });
    repackEvidence.mockResolvedValue({ id: 'ev-repack' });

    const result = await svc.repackPhysicalAllocation({ inventory_item_id: 'inv-1', to_parcel_id: 'p-to', actor_id: 'u-1' });
    expect(result).toMatchObject({ repacked: true, from_parcel_id: 'p-from', to_parcel_id: 'p-to', quantity: 3 });
    expect(query.mock.calls[4][0]).toContain('SET parcel_id = $2');
    expect(query.mock.calls[4][0]).not.toContain('order_item_id =');
    expect(query.mock.calls[4][0]).not.toContain('purchase_order_id =');
    expect(repackEvidence).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ inventoryItemId: 'inv-1', purchaseOrderId: 'po-1' }));
  });

  test('repack refuse une allocation non prouvée', async () => {
    query.mockResolvedValueOnce({ rows: [{ ...base, purchase_order_id: null }] });
    await expect(svc.repackPhysicalAllocation({ inventory_item_id: 'inv-1', to_parcel_id: 'p-to' }))
      .rejects.toMatchObject({ code: 'HUB_PURCHASE_ALLOCATION_UNPROVEN' });
  });
});
