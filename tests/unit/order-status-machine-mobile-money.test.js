/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

'use strict';

jest.mock('../../utils/logger', () => {
  const child = () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() });
  return { child, forModule: child };
});

jest.mock('../../services/product-admin-service', () => ({
  adjustStock: jest.fn(),
}));

jest.mock('../../services/client-notification-service', () => ({
  emitOrderMilestone: jest.fn(),
  resolveOrderMilestones: jest.fn(),
}));

const mockConsumeAllocationsForOrder = jest.fn().mockResolvedValue({ consumed: 0 });
const mockReleaseAllocationsForOrder = jest.fn().mockResolvedValue({ released: 0 });
jest.mock('../../services/local-stock-service', () => ({
  consumeAllocationsForOrder: (...args) => mockConsumeAllocationsForOrder(...args),
  releaseAllocationsForOrder: (...args) => mockReleaseAllocationsForOrder(...args),
}));

const {
  transitionOrderStatus,
  PAYMENT_CONFIRMATION_SOURCES,
} = require('../../services/order-status-machine');

const ORDER_ID = '00000000-0000-0000-0000-000000000001';

function makeDbClient() {
  const query = jest.fn()
    .mockResolvedValueOnce({
      rows: [{
        id: ORDER_ID,
        status: 'pending',
        payment_mode: 'mobile_money',
        relais_id: null,
        pickup_secret_hash: null,
        user_id: '00000000-0000-0000-0000-000000000002',
        reference: 'KMMTEST',
        relais_name: null,
      }],
    })
    .mockResolvedValue({ rows: [], rowCount: 1 });
  return { query };
}

beforeEach(() => {
  mockConsumeAllocationsForOrder.mockClear();
  mockReleaseAllocationsForOrder.mockClear();
});

describe('order-status-machine — Mobile Money payment confirmation', () => {
  test.each([
    'mobile_money_orange_money',
    'mobile_money_mtn_momo',
    'mobile_money_kartapay',
  ])('%s pending → confirmed marque payment_status=paid atomiquement', async (source) => {
    const dbClient = makeDbClient();

    const result = await transitionOrderStatus({
      orderId: ORDER_ID,
      newStatus: 'confirmed',
      actor: { id: null, role: 'system' },
      source,
      dbClient,
      note: 'Paiement provider relu et confirmé',
    });

    expect(result.success).toBe(true);
    expect(result.noop).toBeUndefined();
    expect(dbClient.query).toHaveBeenNthCalledWith(
      3,
      "UPDATE orders SET payment_status = 'paid' WHERE id = $1 AND payment_status = 'pending'",
      [ORDER_ID]
    );
    expect(mockConsumeAllocationsForOrder).toHaveBeenCalledWith(dbClient, ORDER_ID);
  });

  test('les trois sources Mobile Money sont explicitement allowlistées', () => {
    expect(PAYMENT_CONFIRMATION_SOURCES.has('mobile_money_orange_money')).toBe(true);
    expect(PAYMENT_CONFIRMATION_SOURCES.has('mobile_money_mtn_momo')).toBe(true);
    expect(PAYMENT_CONFIRMATION_SOURCES.has('mobile_money_kartapay')).toBe(true);
  });

  test('une source mobile_money inconnue échoue fermée et ne marque jamais paid', async () => {
    const dbClient = makeDbClient();

    const result = await transitionOrderStatus({
      orderId: ORDER_ID,
      newStatus: 'confirmed',
      actor: { id: null, role: 'system' },
      source: 'mobile_money_unknown_provider',
      dbClient,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Source Mobile Money non reconnue');
    expect(dbClient.query).toHaveBeenCalledTimes(1);
    expect(mockConsumeAllocationsForOrder).not.toHaveBeenCalled();
  });
});
