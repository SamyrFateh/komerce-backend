'use strict';

const mockLogFn = () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() });
jest.mock('../../utils/logger', () => { const f = jest.fn(mockLogFn); return { child: f, forModule: f, info: jest.fn(), warn: jest.fn(), error: jest.fn() }; });

const {
  syncPurchaseOrdersOnOrderCancel,
  AUTO_CANCEL_STATUSES,
  BLOCKING_STATUSES,
} = require('../../services/cancel-order-purchase-orders');

describe('cancel-order-purchase-orders', () => {
  it('expose les statuts doctrine auto-cancel et blocking', () => {
    expect(AUTO_CANCEL_STATUSES).toEqual(['pending', 'notified']);
    expect(BLOCKING_STATUSES).toEqual(['confirmed', 'received', 'partially_received', 'hub_received']);
  });

  it('refuse un appel sans orderId', async () => {
    await expect(syncPurchaseOrdersOnOrderCancel({ query: jest.fn() }, {})).rejects.toThrow('orderId requis');
  });

  it('retourne zero si aucune PO active', async () => {
    const q = { query: jest.fn().mockResolvedValueOnce({ rows: [] }) };

    await expect(syncPurchaseOrdersOnOrderCancel(q, { orderId: 'order-001' })).resolves.toEqual({
      total: 0,
      auto_cancelled: 0,
      blocking: 0,
      blocking_pos: [],
    });
    expect(q.query).toHaveBeenCalledWith(expect.stringContaining('FOR UPDATE'), ['order-001']);
  });

  it('auto-cancel pending/notified et cree une alerte pour les POs engagees', async () => {
    const purchaseOrders = [
      { id: 'po-pending', status: 'pending', supplier_id: 'sup-1', supplier_order_id: null },
      { id: 'po-notified', status: 'notified', supplier_id: 'sup-2', supplier_order_id: 'S-2' },
      { id: 'po-confirmed', status: 'confirmed', supplier_id: 'sup-3', supplier_order_id: 'S-3' },
    ];
    const q = { query: jest.fn()
      .mockResolvedValueOnce({ rows: purchaseOrders })              // SELECT ... FOR UPDATE
      .mockResolvedValueOnce({ rows: [], rowCount: 2 })              // UPDATE status='cancelled'
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })              // SAVEPOINT cancel_order_po_alert
      .mockResolvedValueOnce({ rows: [{ id: 'alert-1' }] })          // INSERT alerts (createAlert)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) };           // RELEASE SAVEPOINT cancel_order_po_alert

    const result = await syncPurchaseOrdersOnOrderCancel(q, {
      orderId: 'order-001',
      orderReference: 'CMD-001',
      actor: { id: 'admin', role: 'admin' },
      reason: 'client_cancel',
    });

    expect(result).toEqual({
      total: 3,
      auto_cancelled: 2,
      blocking: 1,
      blocking_pos: [{ id: 'po-confirmed', status: 'confirmed', supplier_id: 'sup-3', supplier_order_id: 'S-3' }],
    });
    expect(q.query.mock.calls[1][0]).toContain("SET status = 'cancelled'");
    expect(q.query.mock.calls[1][1][0]).toEqual(['po-pending', 'po-notified']);
    expect(q.query.mock.calls[1][1][1]).toContain('client_cancel');
    expect(q.query.mock.calls[3][0]).toContain('INSERT INTO alerts');
    expect(q.query.mock.calls[3][1]).toEqual(expect.arrayContaining(['order_cancel_purchasing_blocked', 'order', 'order-001', 'medium']));
    const description = q.query.mock.calls[3][1][5];
    expect(description).toContain('client_cancel');
    expect(description).toContain('po-confirmed');
  });

  it('ne casse pas lannulation si linsertion dalerte echoue', async () => {
    const q = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'po-1', status: 'received', supplier_id: 'sup', supplier_order_id: null }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })   // SAVEPOINT cancel_order_po_alert
      .mockRejectedValueOnce(new Error('alert_down'))     // INSERT alerts (createAlert) échoue
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) }; // ROLLBACK TO SAVEPOINT cancel_order_po_alert

    await expect(syncPurchaseOrdersOnOrderCancel(q, { orderId: 'order-001' })).resolves.toMatchObject({
      total: 1,
      auto_cancelled: 0,
      blocking: 1,
    });
  });
});
