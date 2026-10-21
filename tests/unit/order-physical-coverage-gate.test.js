'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
jest.mock('../../utils/logger', () => {
  const child = () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() });
  return { child, forModule: child };
});
jest.mock('../../services/wallet-service', () => ({ removeFromOrder: jest.fn(), credit: jest.fn() }));
jest.mock('../../services/cancel-order-purchase-orders', () => ({
  syncPurchaseOrdersOnOrderCancel: jest.fn().mockResolvedValue({ cancelled: 0, alerted: 0 }),
}));
jest.mock('../../services/order-physical-coverage-service', () => ({ getOrderPhysicalCoverage: jest.fn() }));

const { getOrderPhysicalCoverage } = require('../../services/order-physical-coverage-service');
const { transitionOrderStatus } = require('../../services/order-status-machine');

const ORDER = '00000000-0000-0000-0000-0000000000aa';
const query = jest.fn();
const db = { query };
const admin = { id: 'a1', role: 'admin' };

function order(status) {
  query.mockReset();
  query.mockResolvedValueOnce({ rows: [{ id: ORDER, status, payment_mode: 'cash_relais', relais_id: null, pickup_secret_hash: null, user_id: 'u', reference: 'R' }] });
  query.mockResolvedValue({ rows: [{}] });
}

beforeEach(() => getOrderPhysicalCoverage.mockReset());

describe('gate de couverture physique → preparation (C2)', () => {
  test('couverture incomplète : refus PHYSICAL_RECEPTION_INCOMPLETE, aucun UPDATE', async () => {
    order('ordered');
    getOrderPhysicalCoverage.mockResolvedValue({ covered: false, uncovered: [{ order_item_id: 'i1', needed: 3, usable: 1, missing: 2 }] });
    const r = await transitionOrderStatus({ orderId: ORDER, newStatus: 'preparation', actor: admin, source: 'patch', dbClient: db });
    expect(r).toMatchObject({ success: false, code: 'PHYSICAL_RECEPTION_INCOMPLETE', previousStatus: 'ordered', coverage: [{ missing: 2 }] });
    expect(query.mock.calls.some(([sql]) => /UPDATE orders/.test(sql))).toBe(false);
  });

  test.each(['system', 'hub_start_prep', 'auto_parcel', 'scan_engine_sync'])('source %s : même refus (point d\'étranglement unique)', async (source) => {
    order('ordered');
    getOrderPhysicalCoverage.mockResolvedValue({ covered: false, uncovered: [{ missing: 1 }] });
    const r = await transitionOrderStatus({ orderId: ORDER, newStatus: 'preparation', actor: admin, source, dbClient: db });
    expect(r).toMatchObject({ success: false, code: 'PHYSICAL_RECEPTION_INCOMPLETE' });
    expect(query.mock.calls.some(([sql]) => /UPDATE orders/.test(sql))).toBe(false);
  });

  test('couverture complète : la transition passe', async () => {
    order('ordered');
    getOrderPhysicalCoverage.mockResolvedValue({ covered: true, uncovered: [] });
    const r = await transitionOrderStatus({ orderId: ORDER, newStatus: 'preparation', actor: admin, source: 'patch', dbClient: db });
    expect(r.success).toBe(true);
    expect(getOrderPhysicalCoverage).toHaveBeenCalledWith(db, ORDER);
  });

  test('annulation jamais bloquée, même sans couverture ; état déjà en preparation = noop sans contrôle', async () => {
    getOrderPhysicalCoverage.mockResolvedValue({ covered: false, uncovered: [{ missing: 9 }] });
    order('ordered');
    const cancelled = await transitionOrderStatus({ orderId: ORDER, newStatus: 'cancelled', actor: admin, source: 'patch', dbClient: db });
    expect(cancelled.success).toBe(true);
    order('preparation');
    const noop = await transitionOrderStatus({ orderId: ORDER, newStatus: 'preparation', actor: admin, source: 'patch', dbClient: db });
    expect(noop).toMatchObject({ success: true, noop: true });
    expect(getOrderPhysicalCoverage).not.toHaveBeenCalled();
  });
});
