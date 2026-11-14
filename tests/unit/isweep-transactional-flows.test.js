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

describe('TEST-1B cash pickup transactional flows (legacy G2 writer removed)', () => {
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
      // market_id fait désormais partie de la vérité commande exigée par
      // cash-confirmation-control-service.validateContext.
      market_id: 'market-1',
    };

    const client = makeClient([
      { rows: [order] },
      { rows: [{ relais_id: 'relais-1' }] },
      { rows: [] }, // prepareCashConfirmation: resolveCurrentPolicy (aucune assignment -> policy par défaut)
      { rows: [] }, // prepareCashConfirmation: getControlForUpdate (pas de contrôle existant)
      { rows: [{ id: 'control-1', required_approvals: 1, state: 'APPROVED' }] }, // INSERT cash_confirmation_controls
      { rows: [], rowCount: 1 }, // INSERT cash_collections
      { rows: [{ id: 'control-1', state: 'CONFIRMED' }] }, // finalizeCashConfirmation
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
      market_id: 'market-1',
    };

    const client = makeClient([
      { rows: [order] },
      { rows: [{ relais_id: 'relais-1' }] },
      { rows: [] }, // prepareCashConfirmation: resolveCurrentPolicy
      { rows: [] }, // prepareCashConfirmation: getControlForUpdate
      { rows: [{ id: 'control-2', required_approvals: 1, state: 'APPROVED' }] }, // INSERT cash_confirmation_controls
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

});
