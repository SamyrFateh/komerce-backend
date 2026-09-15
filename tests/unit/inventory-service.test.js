'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
let mockQuery;
let mockResolvePurchaseAllocation;
let mockAssertParcelCompatible;
let mockAssignPhysical;
let mockRecordEvidence;
let mockSetCompletion;

jest.mock('../../db', () => ({
  query: (...args) => mockQuery(...args),
  withTransaction: async (work) => work({ query: (...args) => mockQuery(...args) }),
}));

jest.mock('../../services/hub-allocation-service', () => ({
  resolvePurchaseAllocation: (...args) => mockResolvePurchaseAllocation(...args),
  assertParcelCompatible: (...args) => mockAssertParcelCompatible(...args),
  hubAllocationError: (code, message, details = {}) => Object.assign(new Error(message || code), { code, details }),
}));

jest.mock('../../services/parcel-item-mutation-service', () => ({
  assignPhysicalAllocationToParcel: (...args) => mockAssignPhysical(...args),
}));

jest.mock('../../services/scan-write-service', () => ({
  recordHubAllocationScanEvent: (...args) => mockRecordEvidence(...args),
}));

jest.mock('../../services/order-mutation-service', () => ({
  setInventoryCompletion: (...args) => mockSetCompletion(...args),
}));

const svc = require('../../services/inventory-service');

beforeEach(() => {
  mockQuery = jest.fn();
  mockResolvePurchaseAllocation = jest.fn();
  mockAssertParcelCompatible = jest.fn();
  mockAssignPhysical = jest.fn();
  mockRecordEvidence = jest.fn();
  mockSetCompletion = jest.fn().mockResolvedValue({});
});

const allocation = {
  order_item_id: 'oi-1', order_id: 'ord-1', product_id: 'prod-1',
  purchase_order_id: 'po-1', physical_quantity: 2,
  market_id: 'market-1', relais_id: 'relais-1', identity_strength: 'EXACT_SUPPLIER_UNIT',
};

describe('receiveItem — proven purchase allocation', () => {
  test('order_id fourni ne peut jamais réassigner la ligne commerciale', async () => {
    mockResolvePurchaseAllocation.mockResolvedValue(allocation);
    await expect(svc.receiveItem({ order_item_id: 'oi-1', order_id: 'ord-other', quantity: 1 }))
      .rejects.toMatchObject({ code: 'HUB_ORDER_REASSIGNMENT_FORBIDDEN' });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('réception nominale persiste PO exacte + verification et propose par destination canonique', async () => {
    mockResolvePurchaseAllocation.mockResolvedValue(allocation);
    const inv = {
      id: 'inv-1', order_item_id: 'oi-1', order_id: 'ord-1', product_id: 'prod-1', quantity: 2,
      purchase_order_id: 'po-1', identity_verified_at: new Date(), status: 'received',
    };
    mockQuery
      .mockResolvedValueOnce({ rows: [inv] })
      .mockResolvedValueOnce({ rows: [{ ...inv, relais_id: 'relais-1', market_id: 'market-1', authoritative_order_id: 'ord-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'parcel-1', reference: 'P1', order_id: 'ord-1', relais_id: 'relais-1', priority: -1, item_count: 1 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: 2, received: 2, assigned: 0 }] });

    const result = await svc.receiveItem({ order_item_id: 'oi-1', purchase_order_id: 'po-1', quantity: 2, received_by: 'u-1' });
    expect(result.allocation).toEqual(expect.objectContaining({ purchase_order_id: 'po-1', market_id: 'market-1', relais_id: 'relais-1' }));
    expect(result.proposal).toMatchObject({ status: 'proposed', parcel_id: 'parcel-1' });
    expect(mockQuery.mock.calls[0][0]).toContain('purchase_order_id, identity_verified_at');
    expect(mockSetCompletion).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      orderId: 'ord-1', itemsReceived: 2, itemsTotal: 2, completionRatio: 1,
    }));
  });
});

describe('proposeAssignment — guidance only', () => {
  test('allocation non prouvée est bufferisée, jamais proposée', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{
        id: 'inv-u', order_id: 'ord-1', order_item_id: 'oi-1', purchase_order_id: null,
        identity_verified_at: null, relais_id: 'r-1', market_id: 'm-1', authoritative_order_id: 'ord-1', status: 'received',
      }] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(svc.proposeAssignment('inv-u')).resolves.toMatchObject({
      status: 'buffered', reason: 'purchase_allocation_unproven',
    });
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  test('proposition filtre par relais ET market, pas par île', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{
        id: 'inv-2', order_id: 'ord-1', order_item_id: 'oi-1', purchase_order_id: 'po-1',
        identity_verified_at: new Date(), relais_id: 'r-1', market_id: 'm-1', authoritative_order_id: 'ord-1', status: 'received',
      }] })
      .mockResolvedValueOnce({ rows: [{ id: 'p-1', reference: 'P1', priority: 0, item_count: 0 }] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await svc.proposeAssignment('inv-2');
    expect(result.parcel_id).toBe('p-1');
    expect(mockQuery.mock.calls[1][0]).toContain('p.relais_id = $1');
    expect(mockQuery.mock.calls[1][0]).toContain('r.market_id = $2');
    expect(mockQuery.mock.calls[1][0]).not.toContain('destination_island');
  });
});

describe('scanIntoParcel — compatible container, no reassign', () => {
  const item = {
    id: 'inv-1', status: 'proposed', order_id: 'ord-1', order_item_id: 'oi-1', product_id: 'prod-1',
    quantity: 1, purchase_order_id: 'po-1', identity_verified_at: new Date(), proposed_parcel_id: 'parcel-1',
    market_id: 'market-1', relais_id: 'relais-1', purchase_order_order_id: 'ord-1', purchase_order_item_id: 'oi-1',
    purchase_status: 'confirmed',
  };

  test('allocation non prouvée ne peut pas être assignée', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...item, purchase_order_id: null, identity_verified_at: null }] });
    await expect(svc.scanIntoParcel('inv-1', 'parcel-1')).rejects.toMatchObject({ code: 'HUB_PURCHASE_ALLOCATION_UNPROVEN' });
    expect(mockAssertParcelCompatible).not.toHaveBeenCalled();
  });

  test('assignation nominale = compatibility + packing + evidence dans la même transaction', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [item] })
      .mockResolvedValueOnce({ rows: [{ ...item, status: 'assigned', parcel_id: 'parcel-1' }] })
      .mockResolvedValueOnce({ rows: [{ total: 1, received: 1, assigned: 1 }] });
    mockAssertParcelCompatible.mockResolvedValue({ id: 'parcel-1', reference: 'P1' });
    mockAssignPhysical.mockResolvedValue({ parcel_item_id: 'pi-1' });
    mockRecordEvidence.mockResolvedValue({ id: 'scan-event-1' });

    const result = await svc.scanIntoParcel('inv-1', 'parcel-1', { scanned_by: 'u-1' });
    expect(result).toMatchObject({ assigned: true, matched_proposal: true, evidence_scan_event_id: 'scan-event-1' });
    expect(mockRecordEvidence).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      purchaseOrderId: 'po-1', marketId: 'market-1', relaisId: 'relais-1',
    }));
  });

  test('colis différent mais compatible n’est pas une réassignation commerciale', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...item, proposed_parcel_id: 'parcel-proposed' }] })
      .mockResolvedValueOnce({ rows: [{ ...item, status: 'assigned', parcel_id: 'parcel-compatible' }] })
      .mockResolvedValueOnce({ rows: [{ total: 1, received: 1, assigned: 1 }] });
    mockAssertParcelCompatible.mockResolvedValue({ id: 'parcel-compatible', reference: 'PC' });
    mockAssignPhysical.mockResolvedValue({ parcel_item_id: 'pi-1' });
    mockRecordEvidence.mockResolvedValue({ id: 'ev-1' });

    const result = await svc.scanIntoParcel('inv-1', 'parcel-compatible');
    expect(result.matched_proposal).toBe(false);
    expect(result.message).toMatch(/aucune vérité commerciale réassignée/);
  });
});

describe('completion and dispatch', () => {
  test('completion additionne les quantités, pas le nombre de rows physiques', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ total: 5, received: 3, assigned: 2 }] });
    const result = await svc.updateOrderCompletion('ord-1');
    expect(result).toEqual({ total: 5, received: 3, assigned: 2, ratio: 0.6 });
  });

  test.each([
    [1, null, 'dispatch_full'],
    [0.7, new Date(Date.now() - 1000).toISOString(), 'dispatch_partial'],
    [0.3, new Date(Date.now() - 1000).toISOString(), 'wait_or_cancel'],
    [0.5, new Date(Date.now() + 86400000).toISOString(), 'wait'],
  ])('ratio=%s deadline=%s => %s', async (ratio, deadline, decision) => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'o', completion_ratio: ratio, deadline_dispatch: deadline }] });
    await expect(svc.shouldDispatch('o')).resolves.toMatchObject({ decision });
  });
});

describe('views', () => {
  test('stats expose identity_unproven', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ received: 1, proposed: 2, assigned: 3, buffered: 4, overdue: 1, identity_unproven: 2 }] })
      .mockResolvedValueOnce({ rows: [{ open_parcels: 5, shipped_parcels: 6 }] });
    await expect(svc.getStats()).resolves.toMatchObject({ identity_unproven: 2, open_parcels: 5 });
  });

  test('open parcels expose market + relay', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'p', market_id: 'm', relais_id: 'r' }] });
    await expect(svc.listOpenParcels()).resolves.toEqual([{ id: 'p', market_id: 'm', relais_id: 'r' }]);
  });
});
