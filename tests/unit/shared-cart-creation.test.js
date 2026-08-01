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
      expect(client.calls[5].params).toEqual([expect.any(String), 'user-001', 'Course groupe', 'Merci', null]);
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

    it('ignore shareMode : le statut initial est toujours open (ASSUMPTION documentée dans le service réel — plus de fenêtre de paiement propre à la liste)', async () => {
      const product = { id: 'p1', name: 'X', image_url: null, category: 'cat', price_kmf: 1000, is_active: true, is_promo: false };
      const sharedCart = { id: 'cart-003', status: 'open', closed_at: null };
      const item = { id: 'sci-003' };
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

      // shareMode n'est plus un paramètre reconnu par la fonction réelle :
      // il est silencieusement ignoré, aucune branche ne le lit.
      const result = await createSharedCartFromCartItems('user-001', [{ product_id: 'p1', quantity: 1 }], {
        shareMode: 'ready_to_pay',
      });

      expect(result.sharedCart.status).toBe('open');
      expect(client.calls[5].sql).toMatch(/'open'/);
      // Un seul événement d'audit (création) — pas de cart_closed automatique.
      const eventCalls = client.calls.filter(c => c.sql.includes('INSERT INTO shared_cart_events'));
      expect(eventCalls).toHaveLength(1);
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

    it('cree un panier partage depuis un basket DB (happy path)', async () => {
      const items = [
        { product_id: 'p1', quantity: 2, name: 'Riz', image_url: 'riz.jpg', category: 'maison', price_kmf: 1000 },
        { product_id: 'p2', quantity: 1, name: 'Huile', image_url: 'huile.jpg', category: 'maison', price_kmf: 1500 },
      ];
      const sharedCart = { id: 'cart-basket-001', status: 'open' };

      const client = makeClient([
        { rows: [{ n: 0 }] },                                  // assertLimit
        { rows: [{ id: 'user-001' }] },                        // SELECT users
        { rows: [{ id: 'basket-001', user_id: 'user-001' }] }, // SELECT baskets
        { rows: items },                                       // SELECT basket_items JOIN products
        { rows: [] },                                          // token collision check
        { rows: [sharedCart] },                                // INSERT shared_carts
        { rows: [{ id: 'sci-1' }] },                           // INSERT item 1
        { rows: [{ id: 'sci-2' }] },                           // INSERT item 2
        { rows: [], rowCount: 1 },                             // addEvent
      ]);
      db.getClient.mockResolvedValue(client);

      const result = await createSharedCartFromBasket('user-001', 'basket-001', { title: 'Groupe' });

      expect(result.sharedCart).toBe(sharedCart);
      expect(result.items).toHaveLength(2);
      expect(result.token).toEqual(expect.any(String));
      expect(client.calls[6].sql).toContain('INSERT INTO shared_carts');
      // params réels : [token, userId, basketId, title, message, deliveryRelayId] — pas de colonne total.
      expect(client.calls[6].params).toEqual([expect.any(String), 'user-001', 'basket-001', 'Groupe', null, null]);
      expectTransactionCommitted(client);
    });

    it('leve si total panier invalide (prix tous nuls)', async () => {
      const items = [{ product_id: 'p1', quantity: 1, name: 'Gratuit', image_url: null, category: 'x', price_kmf: 0 }];
      const sharedCart = { id: 'cart-invalid', status: 'open' };
      const client = makeClient([
        { rows: [{ n: 0 }] },                                  // assertLimit
        { rows: [{ id: 'user-001' }] },                        // SELECT users
        { rows: [{ id: 'basket-001', user_id: 'user-001' }] }, // SELECT baskets
        { rows: items },                                       // SELECT basket_items JOIN products
        { rows: [] },                                          // token collision check
        { rows: [sharedCart] },                                // INSERT shared_carts
        { rows: [{ id: 'sci-gratuit' }] },                     // INSERT item (prix 0, inséré quand même)
      ]);
      db.getClient.mockResolvedValue(client);

      // Le total est vérifié APRÈS la boucle d'insertion des items : la ligne
      // à prix 0 est bien insérée avant que la transaction ne soit rejetée.
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
