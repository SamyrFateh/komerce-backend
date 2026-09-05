'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../services/pickup-secret-service', () => ({ cacheCodeForReveal: jest.fn() }));
jest.mock('../../services/notification-service', () => ({ notifyOrderCreated: jest.fn() }));
jest.mock('../../services/cart-share-service', () => ({ markShareConvertedToOrder: jest.fn() }));
jest.mock('../../services/loyalty-service', () => ({ handleOrderConfirmed: jest.fn() }));
jest.mock('../../utils/logger', () => ({
  child: () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }),
}));

const { cacheCodeForReveal } = require('../../services/pickup-secret-service');
const { notifyOrderCreated } = require('../../services/notification-service');
const { markShareConvertedToOrder } = require('../../services/cart-share-service');
const loyaltyService = require('../../services/loyalty-service');
const { runOrderPostCommitHooks } = require('../../services/order-post-commit-hooks');

beforeEach(() => {
  jest.clearAllMocks();
  cacheCodeForReveal.mockResolvedValue();
  notifyOrderCreated.mockResolvedValue();
  markShareConvertedToOrder.mockResolvedValue();
  loyaltyService.handleOrderConfirmed.mockResolvedValue({ skipped: true });
});

describe('order-post-commit-hooks', () => {
  test('déclenche les side-effects post-commit sans réécrire la commande', () => {
    const order = { id: 'o1', total_kmf: 5000 };
    const items = [{ product_id: 'p1', quantity: 2, _effective_unit_price_kmf: 1200 }];
    const productMap = { p1: { name: 'Produit', price_kmf: 9999 } };

    runOrderPostCommitHooks({
      order,
      relais: { name: 'Relais A' },
      items,
      productMap,
      payment_mode: 'cash_relais',
      cash_ref_code: 'CASH-1',
      reference: 'ORD-1',
      cashTimeout: 24,
      tracking_phone: '+269111',
      rPhone: '+269222',
      user: { phone: '+269111', email: 'u@example.com' },
      bodyEmail: null,
      creditApplied: 0,
      total_kmf: 5000,
      walletPickupCode: 'ABC-DEF-GH',
      share_token: 'share-1',
    });

    expect(cacheCodeForReveal).toHaveBeenCalledWith('o1', 'ABC-DEF-GH');
    expect(markShareConvertedToOrder).toHaveBeenCalledWith('share-1', 'o1');
    expect(notifyOrderCreated).toHaveBeenCalledWith(
      order,
      ['+269222', '+269111'],
      'u@example.com',
      [{ name: 'Produit', qty: 2, price_kmf: 2400 }],
      { name: 'Relais A' },
      expect.stringContaining('CASH-1')
    );
  });

  test('wallet intégral déclenche le hook fidélité sans l’attendre', () => {
    runOrderPostCommitHooks({
      order: { id: 'o2', total_kmf: 0 },
      relais: null,
      items: [],
      productMap: {},
      payment_mode: 'stripe_eur',
      reference: 'ORD-2',
      tracking_phone: null,
      rPhone: null,
      user: {},
      creditApplied: 5000,
      total_kmf: 0,
    });

    expect(loyaltyService.handleOrderConfirmed).toHaveBeenCalledWith({ orderId: 'o2' });
  });
});
