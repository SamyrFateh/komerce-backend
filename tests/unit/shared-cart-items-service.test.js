'use strict';

const { makeClient, expectTransactionCommitted, expectTransactionRolledBack } = require('../integration/test-harness/mock-db');

jest.mock('../../db', () => ({ getClient: jest.fn() }));

const db = require('../../db');

jest.mock('../../services/shared-cart-internals', () => {
  const actual = jest.requireActual('../../services/shared-cart-internals');
  return {
    ...actual,
    withTransaction: async (callback) => {
      const dbMod = require('../../db');
      const client = await dbMod.getClient();
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

const { updateOpenSharedCartItems } = require('../../services/shared-cart-items-service');

describe('shared-cart-items-service (Boutique First, domaine minimal)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('refuse cart_items vide avant transaction', async () => {
    await expect(updateOpenSharedCartItems('cart-1', 'user-1', [])).rejects.toMatchObject({
      code: 'cart_items_required', status: 400,
    });
    expect(db.getClient).not.toHaveBeenCalled();
  });

  it('met à jour les items d\'un panier open, calcule le total, ne vérifie aucun paiement', async () => {
    const cart = { id: 'cart-1', status: 'open' };
    const product = { id: 'p1', name: 'Riz', image_url: 'riz.jpg', category: 'food', price_kmf: 1000, is_active: true, is_promo: false, promo_pct: 0, promo_until: null };
    const inserted = { id: 'item-1', product_id: 'p1', quantity: 3 };
    const updatedCart = { id: 'cart-1', status: 'open', updated_at: '2026-08-01' };
    const client = makeClient([
      { rows: [cart] },          // SELECT ... FOR UPDATE
      { rows: [product] },       // SELECT products
      { rows: [], rowCount: 1 }, // DELETE shared_cart_items
      { rows: [inserted] },      // INSERT shared_cart_items
      { rows: [updatedCart] },   // UPDATE shared_carts RETURNING *
      { rows: [], rowCount: 1 }, // addEvent
    ]);
    db.getClient.mockResolvedValue(client);

    const result = await updateOpenSharedCartItems('cart-1', 'user-1', [
      { product_id: 'p1', quantity: 1 }, { product_id: 'p1', quantity: 2 },
    ]);

    expect(result.cart.total_kmf).toBe(3000);
    expect(result.items).toEqual([inserted]);
    expect(client.calls.some(c => String(c.sql).includes('shared_cart_contributions'))).toBe(false);
    expectTransactionCommitted(client);
  });

  it('refuse si le panier n\'est plus open', async () => {
    const client = makeClient([{ rows: [{ id: 'cart-1', status: 'closed' }] }]);
    db.getClient.mockResolvedValue(client);

    await expect(updateOpenSharedCartItems('cart-1', 'user-1', [{ product_id: 'p1', quantity: 1 }]))
      .rejects.toMatchObject({ code: 'cart_not_editable', status: 409 });
    expectTransactionRolledBack(client);
  });

  it('panier introuvable ou non autorisé → 404', async () => {
    const client = makeClient([{ rows: [] }]);
    db.getClient.mockResolvedValue(client);

    await expect(updateOpenSharedCartItems('cart-1', 'user-1', [{ product_id: 'p1', quantity: 1 }]))
      .rejects.toMatchObject({ code: 'shared_cart_not_found', status: 404 });
  });

  it('aucun produit actif valide → 400 no_active_items', async () => {
    const client = makeClient([
      { rows: [{ id: 'cart-1', status: 'open' }] },
      { rows: [{ id: 'p1', name: 'X', price_kmf: 1000, is_active: false }] },
    ]);
    db.getClient.mockResolvedValue(client);

    await expect(updateOpenSharedCartItems('cart-1', 'user-1', [{ product_id: 'p1', quantity: 1 }]))
      .rejects.toMatchObject({ code: 'no_active_items', status: 400 });
  });
});
