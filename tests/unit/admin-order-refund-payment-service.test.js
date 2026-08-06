'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
// P3-A.2 — refundCancelledOrder doit produire le MÊME effet DB qu'avant
// la migration (payment_status='refunded'), mais désormais via
// services/payment-service.js (markRefunded) plutôt qu'un UPDATE inline.
// orders.status reste owné par order-status-machine (I3) : markRefunded
// ne doit JAMAIS toucher la colonne status.

const { makeClient, expectTransactionCommitted, expectTransactionRolledBack } = require('../integration/test-harness/mock-db');

const mockDb = {
  getClient: jest.fn(),
  query: jest.fn(async () => ({ rows: [] })),
};
jest.mock('../../db', () => mockDb);

const mockProcessRefund = jest.fn();
jest.mock('../../services/refund-service', () => ({
  processRefund: (...args) => mockProcessRefund(...args),
}));

const mockTransitionOrderStatus = jest.fn();
jest.mock('../../services/order-status-machine', () => ({
  transitionOrderStatus: (...args) => mockTransitionOrderStatus(...args),
}));

const mockIssueReceipt = jest.fn();
jest.mock('../../services/documents/refund-receipt', () => ({
  issue: (...args) => mockIssueReceipt(...args),
}));

describe('P3-A.2 refundCancelledOrder → payment-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    mockDb.query = jest.fn(async () => ({ rows: [] }));
    mockProcessRefund.mockResolvedValue({ id: 'refund-1', method: 'stripe' });
    mockTransitionOrderStatus.mockResolvedValue({ success: true });
  });

  test('Stripe refund: markRefunded fires the same payment_status UPDATE, status untouched, commits', async () => {
    const order = {
      id: 'order-1',
      reference: 'KM-1',
      status: 'cancelled',
      payment_status: 'pending',
      payment_mode: 'stripe_eur',
      stripe_payment_id: 'pi_123',
      total_kmf: 12000,
      total_eur: 50,
    };

    const client = makeClient([
      { rows: [order] },   // SELECT order FOR UPDATE
      { rows: [] },        // SELECT existingRefunds (full/completed)
      { rows: [], rowCount: 1 }, // markRefunded → UPDATE orders SET payment_status='refunded'...
    ]);
    mockDb.getClient.mockResolvedValue(client);

    const { refundCancelledOrder } = require('../../services/admin-order-refund');

    const result = await refundCancelledOrder({
      orderId: 'order-1',
      user: { id: 'admin-1', role: 'admin' },
      dryRun: false,
      reason: 'Test',
    });

    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
    expect(result.body.payment_status).toBe('refunded');

    // Effet DB identique à l'ancien UPDATE inline.
    const updateCall = client.calls.find(c => /UPDATE orders SET payment_status/.test(String(c.sql)));
    expect(updateCall).toBeDefined();
    expect(updateCall.sql).toMatch(/payment_status\s*=\s*'refunded'/);
    expect(updateCall.sql).toMatch(/updated_at\s*=\s*NOW\(\)/);
    expect(updateCall.params).toEqual(['order-1']);

    // markRefunded ne doit jamais écrire orders.status (I3) : la seule
    // mutation de status passe par transitionOrderStatus, appelé une fois.
    expect(client.calls.some(c => /UPDATE orders SET.*status\s*=/i.test(String(c.sql)) && !/payment_status/.test(String(c.sql)))).toBe(false);
    expect(mockTransitionOrderStatus).toHaveBeenCalledWith(expect.objectContaining({
      orderId: 'order-1',
      newStatus: 'refunded',
      dbClient: client,
    }));

    expectTransactionCommitted(client);
  });

  test('already-refunded order: no markRefunded call, rolls back 409', async () => {
    const order = {
      id: 'order-2',
      reference: 'KM-2',
      status: 'cancelled',
      payment_status: 'refunded',
    };

    const client = makeClient([{ rows: [order] }]);
    mockDb.getClient.mockResolvedValue(client);

    const { refundCancelledOrder } = require('../../services/admin-order-refund');

    const result = await refundCancelledOrder({
      orderId: 'order-2',
      user: { id: 'admin-1', role: 'admin' },
      dryRun: false,
    });

    expect(result.status).toBe(409);
    expect(client.calls.some(c => /UPDATE orders SET payment_status/.test(String(c.sql)))).toBe(false);
    expectTransactionRolledBack(client);
  });
});
