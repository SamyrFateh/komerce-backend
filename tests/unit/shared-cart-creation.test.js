'use strict';

const { makeClient, expectTransactionCommitted, expectTransactionRolledBack } = require('../integration/test-harness/mock-db');

jest.mock('../../db', () => ({ getClient: jest.fn(), query: jest.fn() }));

const db = require('../../db');
const {
  createSharedCartFromCartItems,
  clearCreatorBasketInTx,
} = require('../../services/shared-cart-creation');

describe('shared-cart-creation', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('clearCreatorBasketInTx', () => {
    it('retourne 0 si aucun panier createur nettoyable', async () => {
      const client = makeClient([{ rows: [] }]);

      await expect(clearCreatorBasketInTx(client, 'user-001')).resolves.toBe(0);
      expect(client.query).toHaveBeenCalledTimes(1);
    });

    it('supprime les items des paniers non verrouilles puis met a jour les paniers', async () => {
      const client = makeClient([
        { rows: [{ id: 'basket-001' }, { id: 'basket-002' }] },
        { rows: [], rowCount: 3 },
        { rows: [], rowCount: 2 },
      ]);

      const deleted = await clearCreatorBasketInTx(client, 'user-001');

      expect(deleted).toBe(3);
      expect(client.calls[1].sql).toContain('DELETE FROM basket_items WHERE basket_id = ANY($1)');
      expect(client.calls[1].params).toEqual([['basket-001', 'basket-002']]);
      expect(client.calls[2].sql).toContain('UPDATE baskets SET updated_at = NOW() WHERE id = ANY($1)');
    });
  });

  describe('createSharedCartFromCartItems', () => {
    it('refuse un user_id absent avant de lire la DB', async () => {
      const client = makeClient([]);
      db.getClient.mockResolvedValue(client);

      await expect(createSharedCartFromCartItems(null, [{ product_id: 'p1', quantity: 1 }])).rejects.toThrow('user_id requis');
      expectTransactionRolledBack(client);
    });

    it('cree un panier partage depuis des items et snapshot les prix serveur', async () => {
      const product = {
        id: 'product-001', name: 'Riz', image_url: 'riz.jpg', category: 'maison',
        price_kmf: 1000, promo_pct: 10, is_promo: true,
        promo_until: new Date(Date.now() + 86_400_000).toISOString(), is_active: true,
      };
      const sharedCart = { id: 'cart-001', status: 'open', closed_at: null, payment_window_ends_at: null };
      const item = { id: 'sci-001', shared_cart_id: 'cart-001', product_id: 'product-001' };
      const client = makeClient([
        { rows: [{ n: 0 }] },
        { rows: [product] },
        { rows: [{ full_name: 'Creator', phone: '000000' }] },
        { rows: [] },
        { rows: [sharedCart] },
        { rows: [item] },
        { rows: [], rowCount: 1 },
      ]);
      db.getClient.mockResolvedValue(client);

      const result = await createSharedCartFromCartItems('user-001', [{ product_id: 'product-001', quantity: 2 }], {
        title: 'Course groupe',
        message: 'Merci',
      });

      expect(result.sharedCart).toBe(sharedCart);
      expect(result.items).toEqual([item]);
      expect(result.clearLocalCart).toBe(true);
      expect(result.token).toEqual(expect.any(String));
      expect(client.calls[4].sql).toContain('INSERT INTO shared_carts');
      expect(client.calls[4].params[6]).toBe(1800);
      expect(client.calls[5].params).toEqual(['cart-001', 'product-001', 'Riz', 'riz.jpg', 'maison', 2, 900, 1800]);
      expect(client.calls[6].sql).toContain('INSERT INTO shared_cart_events');
      expectTransactionCommitted(client);
    });
  });
});
