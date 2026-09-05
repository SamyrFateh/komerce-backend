'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../services/order-status-machine', () => ({ appendOrderHistoryNote: jest.fn() }));
jest.mock('../../services/pickup-secret-service', () => ({ ensureSecretGenerated: jest.fn() }));
jest.mock('../../services/wallet-service', () => ({ debit: jest.fn() }));
jest.mock('../../services/local-stock-service', () => ({
  FULFILLMENT_SOURCE: { LOCAL_STOCK: 'LOCAL_STOCK', IMPORT: 'IMPORT' },
  allocateForOrderItem: jest.fn(),
}));
jest.mock('../../utils/logger', () => ({ child: () => ({ error: jest.fn() }) }));

const walletService = require('../../services/wallet-service');
const {
  applyWalletDebit,
  insertOrderItemsWithStock,
} = require('../../services/order-checkout-persistence');

beforeEach(() => jest.clearAllMocks());

describe('order-checkout-persistence', () => {
  test('refuse une ligne sans fulfillment_source canonique avant toute écriture', async () => {
    const client = { query: jest.fn() };

    await expect(insertOrderItemsWithStock(client, {
      items: [{ product_id: 'p1', quantity: 1, _effective_unit_price_kmf: 1000 }],
      productMap: { p1: { id: 'p1', category: 'beauty' } },
      order: { id: 'o1' },
      relais: { id: 'r1', market_id: 'm1' },
    })).rejects.toMatchObject({ code: 'fulfillment_source_invalid' });

    expect(client.query).not.toHaveBeenCalled();
  });

  test('applyWalletDebit délègue au wallet puis persiste seulement le montant appliqué sur orders', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    walletService.debit.mockResolvedValue({ transaction_id: 'wtx1' });

    await applyWalletDebit(client, {
      userId: 'u1', amountKmf: 2500, orderId: 'o1', orderReference: 'ORD-1',
    });

    expect(walletService.debit).toHaveBeenCalledWith(client, {
      userId: 'u1',
      amountKmf: 2500,
      reason: 'checkout',
      referenceId: 'o1',
      idempotencyKey: 'checkout_o1',
      note: 'Wallet appliqué à commande ORD-1',
    });
    expect(client.query).toHaveBeenCalledWith(
      'UPDATE orders SET wallet_applied_kmf = $1 WHERE id = $2',
      [2500, 'o1']
    );
  });
});
