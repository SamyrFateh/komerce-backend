'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/receive-purchase-order.test.js
 * Couvre services/receive-purchase-order.js
 */
const { makeClient, expectTransactionCommitted, expectTransactionRolledBack } = require('../integration/test-harness/mock-db');

jest.mock('../../db', () => ({ query: jest.fn(), getClient: jest.fn() }));
jest.mock('../../services/order-status-machine', () => ({ transitionOrderStatus: jest.fn() }));
jest.mock('../../utils/logger', () => ({
  child: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() })),
  forModule: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() })),
}));

const db = require('../../db');
const { transitionOrderStatus } = require('../../services/order-status-machine');
const { receivePurchaseOrder } = require('../../services/receive-purchase-order');

describe('receivePurchaseOrder', () => {
  beforeEach(() => jest.clearAllMocks());

  it('po_id manquant → 400', async () => {
    const result = await receivePurchaseOrder({});
    expect(result.status).toBe(400);
    expect(result.body.error).toContain('po_id');
  });

  it('qtyReceived non numerique → 400', async () => {
    const result = await receivePurchaseOrder({ poId: 'po-1', qtyReceived: 'abc' });
    expect(result.status).toBe(400);
    expect(result.body.error).toContain('qty_recue');
  });

  it('qtyReceived negatif → 400', async () => {
    const result = await receivePurchaseOrder({ poId: 'po-1', qtyReceived: -3 });
    expect(result.status).toBe(400);
  });

  it('PO introuvable → 404 + ROLLBACK', async () => {
    const client = makeClient([{ rows: [] }]); // SELECT FOR UPDATE
    db.getClient.mockResolvedValue(client);

    const result = await receivePurchaseOrder({ poId: 'po-x' });
    expect(result.status).toBe(404);
    expectTransactionRolledBack(client);
  });

  it('quantite deja recue en totalite (delta<=0) → 400 + ROLLBACK', async () => {
    const client = makeClient([
      { rows: [{ id: 'po-1', order_id: 'order-1', qty: 10, received_qty: 10, status: 'confirmed' }] },
    ]);
    db.getClient.mockResolvedValue(client);

    const result = await receivePurchaseOrder({ poId: 'po-1' });
    expect(result.status).toBe(400);
    expect(result.body.error).toContain('totalité');
    expectTransactionRolledBack(client);
  });

  it('reception partielle (po pas complet) → 200, order_status=ordered, pas de transition', async () => {
    const client = makeClient([
      { rows: [{ id: 'po-1', order_id: 'order-1', qty: 10, received_qty: 0, status: 'confirmed' }] }, // SELECT FOR UPDATE
      { rows: [{ id: 'po-1', status: 'confirmed' }] }, // UPDATE po
      { rows: [{ total: '2', recus: '0', qty_totale: '20', qty_recue: '5' }] }, // completeness
    ]);
    db.getClient.mockResolvedValue(client);

    const result = await receivePurchaseOrder({ poId: 'po-1', qtyReceived: 5 });
    expect(result.status).toBe(200);
    expect(result.body.ready_to_prepare).toBe(false);
    expect(result.body.order_status).toBe('ordered');
    expect(transitionOrderStatus).not.toHaveBeenCalled();
    expectTransactionCommitted(client);
  });

  it('reception complete pour le PO et toute la commande → transition vers preparation + 200', async () => {
    const client = makeClient([
      { rows: [{ id: 'po-1', order_id: 'order-1', qty: 10, received_qty: 0, status: 'confirmed' }] },
      { rows: [{ id: 'po-1', status: 'hub_received' }] },
      { rows: [{ total: '1', recus: '1', qty_totale: '10', qty_recue: '10' }] },
    ]);
    db.getClient.mockResolvedValue(client);
    transitionOrderStatus.mockResolvedValue({ success: true });

    const result = await receivePurchaseOrder({ poId: 'po-1', qtyReceived: 10, actor: { id: 'u1', role: 'admin' } });
    expect(result.status).toBe(200);
    expect(result.body.ready_to_prepare).toBe(true);
    expect(result.body.order_status).toBe('preparation');
    expect(transitionOrderStatus).toHaveBeenCalledWith(expect.objectContaining({ orderId: 'order-1', newStatus: 'preparation' }));
    expectTransactionCommitted(client);
  });

  it('transition refusee (commande complete) → 409 + ROLLBACK', async () => {
    const client = makeClient([
      { rows: [{ id: 'po-1', order_id: 'order-1', qty: 10, received_qty: 0, status: 'confirmed' }] },
      { rows: [{ id: 'po-1', status: 'hub_received' }] },
      { rows: [{ total: '1', recus: '1', qty_totale: '10', qty_recue: '10' }] },
    ]);
    db.getClient.mockResolvedValue(client);
    transitionOrderStatus.mockResolvedValue({ success: false, noop: false, error: 'transition refusee' });

    const result = await receivePurchaseOrder({ poId: 'po-1', qtyReceived: 10 });
    expect(result.status).toBe(409);
    expectTransactionRolledBack(client);
  });

  it('triggerScan3 declenche en arriere-plan quand commande complete', async () => {
    const client = makeClient([
      { rows: [{ id: 'po-1', order_id: 'order-1', qty: 5, received_qty: 0, status: 'confirmed' }] },
      { rows: [{ id: 'po-1', status: 'hub_received' }] },
      { rows: [{ total: '1', recus: '1', qty_totale: '5', qty_recue: '5' }] },
    ]);
    db.getClient.mockResolvedValue(client);
    transitionOrderStatus.mockResolvedValue({ success: true });
    const triggerScan3 = jest.fn().mockResolvedValue();

    await receivePurchaseOrder({ poId: 'po-1', qtyReceived: 5, actor: { id: 'u1' }, triggerScan3 });
    expect(triggerScan3).toHaveBeenCalledWith('order-1', 'u1');
  });

  it('qty deja en partie recue → delta limite par le restant', async () => {
    const client = makeClient([
      { rows: [{ id: 'po-1', order_id: 'order-1', qty: 10, received_qty: 8, status: 'confirmed' }] },
      { rows: [{ id: 'po-1', status: 'hub_received' }] },
      { rows: [{ total: '1', recus: '1', qty_totale: '10', qty_recue: '10' }] },
    ]);
    db.getClient.mockResolvedValue(client);
    transitionOrderStatus.mockResolvedValue({ success: true });

    // demande 100, mais seulement 2 restent (10-8)
    const result = await receivePurchaseOrder({ poId: 'po-1', qtyReceived: 100 });
    expect(result.status).toBe(200);
    // verifie que l'UPDATE a ete appele avec newReceived = 10 (8+2), pas 108
    const updateCall = client.calls.find(c => String(c.sql).includes('UPDATE purchase_orders'));
    expect(updateCall.params[0]).toBe(10);
  });
});
