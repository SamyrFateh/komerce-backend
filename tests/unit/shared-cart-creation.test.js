'use strict';

const { makeClient, expectTransactionCommitted, expectTransactionRolledBack } = require('../integration/test-harness/mock-db');

jest.mock('../../db', () => {
  const getClient = jest.fn();
  return {
    getClient,
    query: jest.fn(),
    // P5-N3 : primitive partagée, calquée sur l'implémentation réelle (db.js).
    withTransaction: async (callback) => {
      const client = await getClient();
      try {
        await client.query('BEGIN');
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
  };
});

const db = require('../../db');
const {
  createSharedCartFromBasket,
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
      expect(client.calls[5].sql).toContain('INSERT INTO shared_carts');
      expect(client.calls[5].params[6]).toBe(1800);
      expect(client.calls[6].params).toEqual(['cart-001', 'product-001', 'Riz', 'riz.jpg', 'maison', 2, 900, 1800]);
      expect(client.calls[7].sql).toContain('INSERT INTO shared_cart_events');
      expectTransactionCommitted(client);
    });

    it('leve si la limite de paniers actifs est atteinte', async () => {
      const client = makeClient([{ rows: [{ n: 5 }] }]);
      db.getClient.mockResolvedValue(client);

      await expect(
        createSharedCartFromCartItems('user-001', [{ product_id: 'p1', quantity: 1 }])
      ).rejects.toThrow('Limite atteinte');
      expectTransactionRolledBack(client);
    });

    it('leve si cartItems vide', async () => {
      const client = makeClient([{ rows: [{ n: 0 }] }]);
      db.getClient.mockResolvedValue(client);

      await expect(createSharedCartFromCartItems('user-001', [])).rejects.toThrow('Le panier est vide');
      expectTransactionRolledBack(client);
    });

    it('leve si aucun product_id valide dans cartItems', async () => {
      const client = makeClient([{ rows: [{ n: 0 }] }]);
      db.getClient.mockResolvedValue(client);

      await expect(
        createSharedCartFromCartItems('user-001', [{ product_id: null, quantity: 1 }])
      ).rejects.toThrow('Aucun produit valide dans le panier');
      expectTransactionRolledBack(client);
    });

    it('leve si tous les produits sont inactifs/quantite nulle/prix nul (aucun item enrichi)', async () => {
      const client = makeClient([
        { rows: [{ n: 0 }] },
        { rows: [{ id: 'p1', name: 'X', price_kmf: 1000, is_active: false }] },
      ]);
      db.getClient.mockResolvedValue(client);

      await expect(
        createSharedCartFromCartItems('user-001', [{ product_id: 'p1', quantity: 1 }])
      ).rejects.toThrow('Aucun produit valide après vérification serveur');
      expectTransactionRolledBack(client);
    });

    it('leve si utilisateur introuvable', async () => {
      const product = { id: 'p1', name: 'X', price_kmf: 1000, is_active: true, is_promo: false };
      const client = makeClient([
        { rows: [{ n: 0 }] },
        { rows: [product] },
        { rows: [] }, // user introuvable
      ]);
      db.getClient.mockResolvedValue(client);

      await expect(
        createSharedCartFromCartItems('user-001', [{ product_id: 'p1', quantity: 1 }])
      ).rejects.toThrow('Utilisateur introuvable');
      expectTransactionRolledBack(client);
    });

    it('promo expirée (promo_until dans le passe) → prix plein, pas de reduction', async () => {
      const product = {
        id: 'p1', name: 'Prod', image_url: 'x.jpg', category: 'cat',
        price_kmf: 2000, promo_pct: 20, is_promo: true,
        promo_until: new Date(Date.now() - 86_400_000).toISOString(), is_active: true,
      };
      const sharedCart = { id: 'cart-002', status: 'open', closed_at: null, payment_window_ends_at: null };
      const item = { id: 'sci-002' };
      const client = makeClient([
        { rows: [{ n: 0 }] },
        { rows: [product] },
        { rows: [{ full_name: 'Creator', phone: '000' }] },
        { rows: [] },
        { rows: [sharedCart] },
        { rows: [item] },
        { rows: [], rowCount: 1 },
      ]);
      db.getClient.mockResolvedValue(client);

      const result = await createSharedCartFromCartItems('user-001', [{ product_id: 'p1', quantity: 1 }]);

      expect(result.items).toEqual([item]);
      // ligne items insérée avec prix plein 2000 (pas de reduction promo expirée)
      expect(client.calls[6].params).toEqual(['cart-002', 'p1', 'Prod', 'x.jpg', 'cat', 1, 2000, 2000]);
    });

    it('shareMode=ready_to_pay : statut closed + fenêtre paiement + evenement cart_closed', async () => {
      const product = { id: 'p1', name: 'X', image_url: null, category: 'cat', price_kmf: 1000, is_active: true, is_promo: false };
      const sharedCart = {
        id: 'cart-003', status: 'closed',
        closed_at: '2026-07-01T00:00:00Z', payment_window_ends_at: '2026-07-03T00:00:00Z',
      };
      const item = { id: 'sci-003' };
      const client = makeClient([
        { rows: [{ n: 0 }] },
        { rows: [product] },
        { rows: [{ full_name: 'Creator', phone: '000' }] },
        { rows: [] },
        { rows: [sharedCart] },
        { rows: [item] },
        { rows: [], rowCount: 1 }, // shared_cart_created event
        { rows: [], rowCount: 1 }, // cart_closed event
      ]);
      db.getClient.mockResolvedValue(client);

      const result = await createSharedCartFromCartItems('user-001', [{ product_id: 'p1', quantity: 1 }], {
        shareMode: 'ready_to_pay',
      });

      expect(result.sharedCart.status).toBe('closed');
      // 2 evenements audit (creation + cart_closed)
      const eventCalls = client.calls.filter(c => c.sql.includes('INSERT INTO shared_cart_events'));
      expect(eventCalls).toHaveLength(2);
    });

    it('shareMode=ready_to_pay avec targetDate : fenêtre paiement bornée par le plafond 14j', async () => {
      const farTargetDate = new Date(Date.now() + 60 * 86_400_000).toISOString(); // bien au-dela du plafond
      const product = { id: 'p1', name: 'X', image_url: null, category: 'cat', price_kmf: 1000, is_active: true, is_promo: false };
      const sharedCart = { id: 'cart-004', status: 'closed', closed_at: null, payment_window_ends_at: null };
      const item = { id: 'sci-004' };
      const client = makeClient([
        { rows: [{ n: 0 }] },
        { rows: [product] },
        { rows: [{ full_name: 'Creator', phone: '000' }] },
        { rows: [] },
        { rows: [sharedCart] },
        { rows: [item] },
        { rows: [], rowCount: 1 },
        { rows: [], rowCount: 1 },
      ]);
      db.getClient.mockResolvedValue(client);

      await createSharedCartFromCartItems('user-001', [{ product_id: 'p1', quantity: 1 }], {
        shareMode: 'ready_to_pay', targetDate: farTargetDate,
      });

      // params INSERT shared_carts : payment_window_ends_at est le 13e param (index 12)
      const insertParams = client.calls[5].params;
      const paymentWindowEndsAt = new Date(insertParams[12]).getTime();
      const capMs = Date.now() + 14 * 86_400_000;
      expect(paymentWindowEndsAt).toBeLessThanOrEqual(capMs + 5000);
    });

    it('genere un token unique en retentant si collision (attempt < 4)', async () => {
      const product = { id: 'p1', name: 'X', image_url: null, category: 'cat', price_kmf: 1000, is_active: true, is_promo: false };
      const sharedCart = { id: 'cart-005', status: 'open', closed_at: null, payment_window_ends_at: null };
      const item = { id: 'sci-005' };
      const client = makeClient([
        { rows: [{ n: 0 }] },
        { rows: [product] },
        { rows: [{ full_name: 'Creator', phone: '000' }] },
        { rows: [{ exists: 1 }] }, // collision sur 1ère tentative
        { rows: [] },              // pas de collision sur 2eme
        { rows: [sharedCart] },
        { rows: [item] },
        { rows: [], rowCount: 1 },
      ]);
      db.getClient.mockResolvedValue(client);

      const result = await createSharedCartFromCartItems('user-001', [{ product_id: 'p1', quantity: 1 }]);

      expect(result.token).toEqual(expect.any(String));
    });
  });

  describe('createSharedCartFromBasket', () => {
    it('leve si limite de paniers actifs atteinte', async () => {
      const client = makeClient([{ rows: [{ n: 5 }] }]);
      db.getClient.mockResolvedValue(client);

      await expect(createSharedCartFromBasket('user-001', 'basket-001')).rejects.toThrow('Limite atteinte');
      expectTransactionRolledBack(client);
    });

    it('leve si utilisateur introuvable', async () => {
      const client = makeClient([
        { rows: [{ n: 0 }] },
        { rows: [] },
      ]);
      db.getClient.mockResolvedValue(client);

      await expect(createSharedCartFromBasket('user-001', 'basket-001')).rejects.toThrow('Utilisateur introuvable');
      expectTransactionRolledBack(client);
    });

    it('leve si panier introuvable ou non autorise', async () => {
      const client = makeClient([
        { rows: [{ n: 0 }] },
        { rows: [{ id: 'user-001', full_name: 'X', phone: '000' }] },
        { rows: [] },
      ]);
      db.getClient.mockResolvedValue(client);

      await expect(createSharedCartFromBasket('user-001', 'basket-001')).rejects.toThrow('Panier introuvable ou non autorisé');
      expectTransactionRolledBack(client);
    });

    it('leve si panier vide', async () => {
      const client = makeClient([
        { rows: [{ n: 0 }] },
        { rows: [{ id: 'user-001', full_name: 'X', phone: '000' }] },
        { rows: [{ id: 'basket-001', user_id: 'user-001' }] },
        { rows: [] },
      ]);
      db.getClient.mockResolvedValue(client);

      await expect(createSharedCartFromBasket('user-001', 'basket-001')).rejects.toThrow('Le panier est vide, impossible de partager');
      expectTransactionRolledBack(client);
    });

    it('cree un panier partage depuis un basket DB (happy path, avec targetDate)', async () => {
      const items = [
        { product_id: 'p1', quantity: 2, name: 'Riz', image_url: 'riz.jpg', category: 'maison', price_kmf: 1000 },
        { product_id: 'p2', quantity: 1, name: 'Huile', image_url: 'huile.jpg', category: 'maison', price_kmf: 1500 },
      ];
      const sharedCart = { id: 'cart-basket-001', status: 'open' };
      const targetDate = new Date(Date.now() + 5 * 86_400_000).toISOString();

      const client = makeClient([
        { rows: [{ n: 0 }] },
        { rows: [{ id: 'user-001', full_name: 'Creator', phone: '000000' }] },
        { rows: [{ id: 'basket-001', user_id: 'user-001' }] },
        { rows: items },
        { rows: [] }, // token collision check
        { rows: [sharedCart] },
        { rows: [{ id: 'sci-1' }] },
        { rows: [{ id: 'sci-2' }] },
        { rows: [], rowCount: 1 }, // audit event
      ]);
      db.getClient.mockResolvedValue(client);

      const result = await createSharedCartFromBasket('user-001', 'basket-001', { targetDate, title: 'Groupe' });

      expect(result.sharedCart).toBe(sharedCart);
      expect(result.items).toHaveLength(2);
      expect(result.token).toEqual(expect.any(String));
      expect(client.calls[6].sql).toContain('INSERT INTO shared_carts');
      // total = 2*1000 + 1*1500 = 3500
      expect(client.calls[6].params[7]).toBe(3500);
      expectTransactionCommitted(client);
    });

    it('leve si total panier invalide (prix tous nuls)', async () => {
      const items = [{ product_id: 'p1', quantity: 1, name: 'Gratuit', image_url: null, category: 'x', price_kmf: 0 }];
      const client = makeClient([
        { rows: [{ n: 0 }] },
        { rows: [{ id: 'user-001', full_name: 'X', phone: '000' }] },
        { rows: [{ id: 'basket-001', user_id: 'user-001' }] },
        { rows: items },
      ]);
      db.getClient.mockResolvedValue(client);

      await expect(createSharedCartFromBasket('user-001', 'basket-001')).rejects.toThrow('Total panier invalide');
      expectTransactionRolledBack(client);
    });

    it('genere un token unique en retentant si collision (attempt < 4)', async () => {
      const items = [{ product_id: 'p1', quantity: 1, name: 'X', image_url: null, category: 'x', price_kmf: 1000 }];
      const sharedCart = { id: 'cart-basket-002', status: 'open' };
      const client = makeClient([
        { rows: [{ n: 0 }] },
        { rows: [{ id: 'user-001', full_name: 'X', phone: '000' }] },
        { rows: [{ id: 'basket-001', user_id: 'user-001' }] },
        { rows: items },
        { rows: [{ exists: 1 }] }, // collision
        { rows: [] },              // ok
        { rows: [sharedCart] },
        { rows: [{ id: 'sci-1' }] },
        { rows: [], rowCount: 1 },
      ]);
      db.getClient.mockResolvedValue(client);

      const result = await createSharedCartFromBasket('user-001', 'basket-001');

      expect(result.token).toEqual(expect.any(String));
    });
  });
});
