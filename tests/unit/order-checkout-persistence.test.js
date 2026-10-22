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
  insertOrderRow,
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

function params(extra = {}) {
  return {
    reference: 'KOM-1', userId: 'u', recipientId: 'r', relaisId: 'rel', trackingPhone: '+269',
    totalKmf: 1000, totalEur: 2.03, paymentMode: 'stripe_eur', stripePaymentIntent: null, cashRefCode: null,
    confectionType: null, confectionDelayDays: 0, moduleRetouche: false,
    costEstimatedKmf: 500, marginEstimatedPct: 10, discountPct: 0, discountKmf: 0, loyaltyLabel: null,
    destinationIsland: 'GC', routingMode: 'direct', transitHub: null, transportPriceKmf: 90,
    pickupCodeRecipient: null, pickupCodeRecipientUserId: null,
    displayAmount: null, displayCurrency: null, displayMeta: null, marketId: 'm1',
    ...extra,
  };
}

describe('insertOrderRow — snapshot de tarif transport', () => {
  test('persiste le snapshot en JSON dans la colonne dédiée (40e paramètre)', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [{ id: 'o1' }] }) };
    const snap = { version: 1, pivot_currency: 'EUR', tariff_lines: [{ rate_id: 'x' }] };
    await insertOrderRow(client, params({ transportPricingSnapshot: snap }));
    const [sql, values] = client.query.mock.calls[0];
    expect(sql).toMatch(/transport_pricing_snapshot/);
    expect(values).toHaveLength(40);
    expect(JSON.parse(values[39])).toEqual(snap);
    expect(values[38]).toBe('m1');
  });

  test('sans snapshot (pas de ligne import) : NULL, jamais un objet vide inventé', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [{ id: 'o1' }] }) };
    await insertOrderRow(client, params());
    expect(client.query.mock.calls[0][1][39]).toBeNull();
  });
});
