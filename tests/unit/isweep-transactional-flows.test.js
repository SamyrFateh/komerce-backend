/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const { makeClient, expectTransactionCommitted, expectTransactionRolledBack } = require('../integration/test-harness/mock-db');

const mockDb = {
  connect: jest.fn(),
  getClient: jest.fn(),
  query: jest.fn(async () => ({ rows: [], rowCount: 0 })),
};

jest.mock('../../db', () => mockDb);

const mockConfirmPaymentCycle = jest.fn();
jest.mock('../../services/order-payment-confirmation', () => ({
  confirmPaymentCycle: (...args) => mockConfirmPaymentCycle(...args),
}));

const mockTransitionOrderStatus = jest.fn();
jest.mock('../../services/order-status-machine', () => ({
  transitionOrderStatus: (...args) => mockTransitionOrderStatus(...args),
}));

describe('TEST-1B transactional flows', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    mockDb.query = jest.fn(async () => ({ rows: [], rowCount: 0 }));
    mockConfirmPaymentCycle.mockReset();
    mockTransitionOrderStatus.mockReset();
  });

  test('G1 cash pickup commits payment cycle, secret generation and cash collection in one transaction', async () => {
    const order = {
      id: 'order-1',
      reference: 'KM-1',
      total_kmf: 12000,
      payment_mode: 'cash_relais',
      payment_status: 'pending',
      status: 'pending',
      pickup_secret_hash: null,
      tracking_phone: '+269000000',
      tracking_phone_secondary: null,
      relais_id: 'relais-1',
    };

    const client = makeClient([
      { rows: [order] },
      { rows: [{ relais_id: 'relais-1' }] },
      { rows: [], rowCount: 1 },
    ]);
    mockDb.connect.mockResolvedValue(client);
    mockConfirmPaymentCycle.mockResolvedValue({ success: true, noop: false, stockBlocked: false });

    const { confirmPickupCashPayment } = require('../../services/confirm-pickup-cash-payment');
    const generateAndStoreSecret = jest.fn(async () => ({ code: 'ABC123' }));

    const result = await confirmPickupCashPayment({
      orderId: order.id,
      user: { id: 'agent-1', role: 'agent_relais' },
      payload: { payer_name: 'Client Test' },
      generateAndStoreSecret,
    });

    expect(result.status).toBe(200);
    expect(mockConfirmPaymentCycle).toHaveBeenCalledWith(expect.objectContaining({
      orderId: order.id,
      source: 'cash_confirm',
      dbClient: client,
    }));
    expect(generateAndStoreSecret).toHaveBeenCalledWith(expect.objectContaining({
      orderId: order.id,
      dbClient: client,
      channel: 'cash_relais',
    }));
    expect(client.calls.some(c => String(c.sql).includes('INSERT INTO cash_collections'))).toBe(true);
    expectTransactionCommitted(client);
  });

  test('G1 cash pickup rolls back when payment cycle reports stockBlocked', async () => {
    const order = {
      id: 'order-2',
      reference: 'KM-2',
      total_kmf: 12000,
      payment_mode: 'cash_relais',
      payment_status: 'pending',
      status: 'pending',
      pickup_secret_hash: null,
      tracking_phone: null,
      tracking_phone_secondary: null,
      relais_id: 'relais-1',
    };

    const client = makeClient([
      { rows: [order] },
      { rows: [{ relais_id: 'relais-1' }] },
    ]);
    mockDb.connect.mockResolvedValue(client);
    mockConfirmPaymentCycle.mockResolvedValue({
      success: true,
      noop: false,
      stockBlocked: true,
      insufficientItems: [{ product_name: 'Produit', available: 0 }],
    });

    const { confirmPickupCashPayment } = require('../../services/confirm-pickup-cash-payment');
    const generateAndStoreSecret = jest.fn(async () => ({ code: 'ABC123' }));

    const result = await confirmPickupCashPayment({
      orderId: order.id,
      user: { id: 'agent-1', role: 'agent_relais' },
      payload: { payer_name: 'Client Test' },
      generateAndStoreSecret,
    });

    expect(result.status).toBe(409);
    expect(generateAndStoreSecret).not.toHaveBeenCalled();
    expect(client.calls.some(c => String(c.sql).includes('INSERT INTO cash_collections'))).toBe(false);
    expectTransactionRolledBack(client);
  });

  test('G2 receivePurchaseOrder commits PO update and order transition atomically when order is complete', async () => {
    const po = { id: 'po-1', order_id: 'order-3', qty: 2, received_qty: 1, status: 'confirmed', hub_received_at: null };
    const updatedPo = { ...po, received_qty: 2, status: 'received' };
    const client = makeClient([
      { rows: [po] },
      { rows: [updatedPo] },
      { rows: [{ total: '1', recus: '1', qty_totale: '2', qty_recue: '2' }] },
    ]);
    mockDb.getClient.mockResolvedValue(client);
    mockTransitionOrderStatus.mockResolvedValue({ success: true, noop: false });

    const { receivePurchaseOrder } = require('../../services/receive-purchase-order');
    const triggerScan3 = jest.fn(() => Promise.resolve());

    const result = await receivePurchaseOrder({
      poId: po.id,
      qtyReceived: 1,
      actor: { id: 'admin-1', role: 'admin' },
      triggerScan3,
    });

    expect(result.status).toBe(200);
    expect(result.body.ready_to_prepare).toBe(true);
    expect(mockTransitionOrderStatus).toHaveBeenCalledWith(expect.objectContaining({
      orderId: po.order_id,
      newStatus: 'preparation',
      source: 'system',
      dbClient: client,
    }));
    expectTransactionCommitted(client);
    expect(triggerScan3).toHaveBeenCalledWith(po.order_id, 'admin-1');
  });

  test('G2 receivePurchaseOrder rolls back when status transition fails', async () => {
    const po = { id: 'po-2', order_id: 'order-4', qty: 1, received_qty: 0, status: 'confirmed', hub_received_at: null };
    const updatedPo = { ...po, received_qty: 1, status: 'received' };
    const client = makeClient([
      { rows: [po] },
      { rows: [updatedPo] },
      { rows: [{ total: '1', recus: '1', qty_totale: '1', qty_recue: '1' }] },
    ]);
    mockDb.getClient.mockResolvedValue(client);
    mockTransitionOrderStatus.mockResolvedValue({ success: false, error: 'transition impossible' });

    const { receivePurchaseOrder } = require('../../services/receive-purchase-order');
    const triggerScan3 = jest.fn(() => Promise.resolve());

    const result = await receivePurchaseOrder({
      poId: po.id,
      qtyReceived: 1,
      actor: { id: 'admin-1', role: 'admin' },
      triggerScan3,
    });

    expect(result.status).toBe(409);
    expect(triggerScan3).not.toHaveBeenCalled();
    expectTransactionRolledBack(client);
  });
});
