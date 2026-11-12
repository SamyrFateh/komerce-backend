/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
'use strict';

jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const mockTransitionOrderStatus = jest.fn();
jest.mock('../../services/order-status-machine', () => ({
  transitionOrderStatus: (...args) => mockTransitionOrderStatus(...args),
}));

jest.mock('../../db', () => ({ query: jest.fn() }));

const { syncScanToParcels } = require('../../utils/parcelSync');

describe('parcelSync — retrait partiel ciblé', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('target_one_available collecte exactement le premier parcel AVAILABLE puis recalcule le parent', async () => {
    const client = { query: jest.fn() };
    client.query.mockImplementation((sql, params) => {
      if (sql.includes("status = 'available'") && sql.includes('FOR UPDATE')) {
        return Promise.resolve({ rows: [{ id: 'p-local', status: 'available', reference: 'PAR-LOCAL' }] });
      }
      if (sql.includes('SELECT pi.order_item_id') && sql.includes('FOR UPDATE OF pi')) {
        return Promise.resolve({ rows: [
          { order_item_id: 'item-local', quantity: 2, qty_received: 2, qty_collected: 0 },
        ] });
      }
      if (sql.includes('SELECT status, type FROM parcels')) {
        return Promise.resolve({ rows: [
          { status: 'collected', type: 'partial' },
          { status: 'in_transit', type: 'standard' },
        ] });
      }
      return Promise.resolve({ rows: [] });
    });
    mockTransitionOrderStatus.mockResolvedValue({ success: true, newStatus: 'available' });

    const result = await syncScanToParcels({
      order_id: 'o1',
      step: 'collected',
      scan_id: 's1',
      target_one_available: true,
      scanned_by: 'agent1',
      notes: 'retrait',
    }, client);

    expect(result).toEqual(expect.objectContaining({
      synced: true,
      parcelsUpdated: 1,
      orderStatus: 'available',
      parcelId: 'p-local',
      parcelReference: 'PAR-LOCAL',
    }));
    const updateParcel = client.query.mock.calls.find(([sql]) =>
      sql.includes('UPDATE parcels')
    );
    expect(updateParcel[1][1]).toBe('p-local');
    expect(client.query.mock.calls.some(([sql, params]) =>
      sql.includes('UPDATE parcel_items') &&
      sql.includes('qty_collected = qty_received') &&
      params[0] === 'p-local'
    )).toBe(true);
    expect(client.query.mock.calls.some(([sql, params]) =>
      sql.includes('UPDATE order_items oi') &&
      sql.includes('SUM(pi.qty_collected)') &&
      params[0][0] === 'item-local'
    )).toBe(true);
  });

  test('refuse un colis sans quantité physiquement réceptionnée avant tout statut collected', async () => {
    const client = { query: jest.fn(async sql => {
      if (sql.includes("status = 'available'") && sql.includes('FOR UPDATE')) {
        return { rows: [{ id:'p-local', status:'available', reference:'P-LOCAL' }] };
      }
      if (sql.includes('SELECT pi.order_item_id') && sql.includes('FOR UPDATE OF pi')) {
        return { rows: [{ order_item_id:'item-local', quantity:2, qty_received:0, qty_collected:0 }] };
      }
      return { rows: [] };
    }) };
    await expect(syncScanToParcels({
      order_id:'o1', step:'collected', scan_id:'s1', target_one_available:true
    },client)).rejects.toThrow('PICKUP_PHYSICAL_QUANTITY_INVALID');
    expect(client.query.mock.calls.some(([sql]) => sql.includes('UPDATE parcels'))).toBe(false);
    expect(client.query.mock.calls.some(([sql]) => sql.includes('UPDATE parcel_items'))).toBe(false);
  });

  test('distingue aucun parcel prêt de la commande legacy sans parcel', async () => {
    const withRemaining = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'p-transit' }] }),
    };
    const noParcels = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] }),
    };

    await expect(syncScanToParcels({
      order_id: 'o1', step: 'collected', scan_id: 's1', target_one_available: true,
    }, withRemaining)).resolves.toEqual(expect.objectContaining({
      synced: false, reason: 'no_available_parcel',
    }));

    await expect(syncScanToParcels({
      order_id: 'o2', step: 'collected', scan_id: 's2', target_one_available: true,
    }, noParcels)).resolves.toEqual(expect.objectContaining({
      synced: false, reason: 'no_parcels',
    }));
  });
});
