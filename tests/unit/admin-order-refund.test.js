'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const { makeClient, expectTransactionCommitted, expectTransactionRolledBack } = require('../integration/test-harness/mock-db');

jest.mock('../../db', () => ({ getClient: jest.fn(), query: jest.fn() }));
jest.mock('../../services/refund-service', () => ({ processRefund: jest.fn() }));
jest.mock('../../services/order-status-machine', () => ({ transitionOrderStatus: jest.fn() }));
jest.mock('../../services/payment-service', () => ({ markRefunded: jest.fn() }));
jest.mock('../../services/documents/refund-receipt', () => ({ issue: jest.fn() }));
jest.mock('../../utils/logger', () => ({ child: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() })) }));

const db = require('../../db');
const { processRefund } = require('../../services/refund-service');
const { transitionOrderStatus } = require('../../services/order-status-machine');
const { markRefunded } = require('../../services/payment-service');
const refundReceiptService = require('../../services/documents/refund-receipt');
const { refundCancelledOrder } = require('../../services/admin-order-refund');

describe('admin-order-refund', () => {
  beforeEach(() => jest.clearAllMocks());

  it('refuse un utilisateur non admin avant transaction', async () => {
    await expect(refundCancelledOrder({ orderId: 'order-001', user: { id: 'u1', role: 'client' } }))
      .resolves.toEqual({ status: 403, body: { error: 'Accès réservé admin' } });
    expect(db.getClient).not.toHaveBeenCalled();
  });

  it('refuse un orderId manquant avant transaction', async () => {
    await expect(refundCancelledOrder({ user: { id: 'admin-001', role: 'admin' } }))
      .resolves.toEqual({ status: 400, body: { error: 'orderId requis' } });
    expect(db.getClient).not.toHaveBeenCalled();
  });

  it('rollback si la commande est introuvable', async () => {
    const client = makeClient([{ rows: [] }]);
    db.getClient.mockResolvedValue(client);

    await expect(refundCancelledOrder({ orderId: 'order-001', user: { id: 'admin-001', role: 'admin' } }))
      .resolves.toEqual({ status: 404, body: { error: 'Commande introuvable' } });
    expectTransactionRolledBack(client);
  });

  it('rollback si la commande nest pas cancelled', async () => {
    const client = makeClient([{ rows: [{ id: 'order-001', status: 'paid' }] }]);
    db.getClient.mockResolvedValue(client);

    const result = await refundCancelledOrder({ orderId: 'order-001', user: { id: 'admin-001', role: 'admin' } });

    expect(result).toEqual({
      status: 409,
      body: { error: 'La commande doit être cancelled avant remboursement financier', current_status: 'paid' },
    });
    expectTransactionRolledBack(client);
  });

  it('dryRun planifie la methode sans executer le remboursement', async () => {
    const order = {
      id: 'order-001', reference: 'CMD-001', status: 'cancelled', payment_status: 'paid',
      payment_mode: 'stripe_eur', stripe_payment_id: 'pi_001', total_kmf: 5000, total_eur: 10.16,
    };
    const client = makeClient([{ rows: [order] }, { rows: [] }]);
    db.getClient.mockResolvedValue(client);

    const result = await refundCancelledOrder({ orderId: 'order-001', user: { id: 'admin-001', role: 'admin' }, dryRun: true });

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ dry_run: true, planned_method: 'stripe', amount_kmf: 5000, amount_eur: 10.16 });
    expect(processRefund).not.toHaveBeenCalled();
    expectTransactionRolledBack(client);
  });

  it('cash manuel cree une alerte et ne marque pas refunded', async () => {
    const order = {
      id: 'order-001', reference: 'CMD-001', status: 'cancelled', payment_status: 'paid',
      payment_mode: 'cash', total_kmf: 5000, total_eur: 0,
    };
    const client = makeClient([{ rows: [order] }, { rows: [] }, { rows: [], rowCount: 1 }]);
    db.getClient.mockResolvedValue(client);

    const result = await refundCancelledOrder({ orderId: 'order-001', user: { id: 'admin-001', role: 'admin' }, dryRun: false });

    expect(result.status).toBe(202);
    expect(result.body).toMatchObject({ manual_required: true, order_id: 'order-001' });
    expect(client.calls.find(c => String(c.sql).includes('INSERT INTO alerts'))).toBeDefined();
    expect(processRefund).not.toHaveBeenCalled();
    expect(markRefunded).not.toHaveBeenCalled();
    expectTransactionCommitted(client);
  });

  it('execute le remboursement financier puis marque commande et paiement refunded', async () => {
    const order = {
      id: 'order-001', reference: 'CMD-001', status: 'cancelled', payment_status: 'paid',
      payment_mode: 'stripe_eur', stripe_payment_id: 'pi_001', total_kmf: 5000, total_eur: 10.16,
    };
    const refund = { method: 'stripe', stripeRefundId: 're_001' };
    const client = makeClient([{ rows: [order] }, { rows: [] }]);
    db.getClient.mockResolvedValue(client);
    processRefund.mockResolvedValue(refund);
    transitionOrderStatus.mockResolvedValue({ success: true });
    markRefunded.mockResolvedValue({ ok: true });
    db.query.mockResolvedValueOnce({ rows: [{ id: 'refund-001' }] });
    refundReceiptService.issue.mockResolvedValue({ id: 'doc-001' });

    const result = await refundCancelledOrder({
      orderId: 'order-001', user: { id: 'admin-001', role: 'admin' }, dryRun: false, reason: 'annulation',
    });

    expect(processRefund).toHaveBeenCalledWith(client, order, 5000, 10.16, 'full', 'annulation', 'admin-001', null);
    expect(transitionOrderStatus).toHaveBeenCalledWith(expect.objectContaining({ orderId: 'order-001', newStatus: 'refunded', dbClient: client }));
    expect(markRefunded).toHaveBeenCalledWith('order-001', { client });
    expect(result).toEqual({
      status: 200,
      body: { success: true, order_id: 'order-001', reference: 'CMD-001', refund, status: 'refunded', payment_status: 'refunded' },
    });
    expectTransactionCommitted(client);
  });

  it('rollback si la transition refunded est refusee', async () => {
    const order = { id: 'order-001', reference: 'CMD-001', status: 'cancelled', payment_status: 'paid', payment_mode: 'stripe_eur', stripe_payment_id: 'pi_001', total_kmf: 5000, total_eur: 10.16 };
    const client = makeClient([{ rows: [order] }, { rows: [] }]);
    db.getClient.mockResolvedValue(client);
    processRefund.mockResolvedValue({ method: 'stripe' });
    transitionOrderStatus.mockResolvedValue({ success: false, error: 'bad transition' });

    await expect(refundCancelledOrder({ orderId: 'order-001', user: { id: 'admin-001', role: 'admin' }, dryRun: false }))
      .resolves.toEqual({ status: 409, body: { error: 'bad transition' } });
    expect(markRefunded).not.toHaveBeenCalled();
    expectTransactionRolledBack(client);
  });
});
