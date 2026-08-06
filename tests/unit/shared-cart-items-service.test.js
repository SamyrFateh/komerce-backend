'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
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

const {
  updateOpenSharedCartItems,
  addSharedCartItem,
  removeSharedCartItem,
  updateSharedCartItemQuantity,
} = require('../../services/shared-cart-items-service');

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

describe('addSharedCartItem (Contrat API §2/§5 point 4 — ajout unitaire, immédiat)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('refuse sans product_id, avant toute transaction', async () => {
    await expect(addSharedCartItem('cart-1', 'user-1', undefined)).rejects.toMatchObject({
      code: 'product_id_required', status: 400,
    });
    expect(db.getClient).not.toHaveBeenCalled();
  });

  it('refuse une quantité invalide, avant toute transaction', async () => {
    await expect(addSharedCartItem('cart-1', 'user-1', 'p1', 0)).rejects.toMatchObject({
      code: 'invalid_quantity', status: 400,
    });
    expect(db.getClient).not.toHaveBeenCalled();
  });

  it('panier introuvable ou non autorisé → 404', async () => {
    const client = makeClient([{ rows: [] }]);
    db.getClient.mockResolvedValue(client);

    await expect(addSharedCartItem('cart-1', 'user-1', 'p1', 1)).rejects.toMatchObject({
      code: 'shared_cart_not_found', status: 404,
    });
    expectTransactionRolledBack(client);
  });

  it('refuse si le panier n\'est plus open', async () => {
    const client = makeClient([{ rows: [{ id: 'cart-1', status: 'closed' }] }]);
    db.getClient.mockResolvedValue(client);

    await expect(addSharedCartItem('cart-1', 'user-1', 'p1', 1)).rejects.toMatchObject({
      code: 'cart_not_editable', status: 409,
    });
    expectTransactionRolledBack(client);
  });

  it('produit introuvable ou inactif → 400', async () => {
    const client = makeClient([
      { rows: [{ id: 'cart-1', status: 'open' }] },
      { rows: [] },
    ]);
    db.getClient.mockResolvedValue(client);

    await expect(addSharedCartItem('cart-1', 'user-1', 'p1', 1)).rejects.toMatchObject({
      code: 'product_not_found', status: 400,
    });
    expectTransactionRolledBack(client);
  });

  it('insère un article unique, applique la promo active, journalise l\'événement, commit', async () => {
    const cart = { id: 'cart-1', status: 'open' };
    const product = {
      id: 'p1', name: 'Riz', image_url: 'riz.jpg', category: 'food',
      price_kmf: 1000, is_active: true, is_promo: true, promo_pct: 10, promo_until: null,
    };
    const inserted = { id: 'item-1', product_id: 'p1', quantity: 2, unit_price_kmf_snapshot: 900 };
    const client = makeClient([
      { rows: [cart] },          // SELECT ... FOR UPDATE
      { rows: [product] },       // SELECT products
      { rows: [inserted] },      // INSERT shared_cart_items
      { rows: [], rowCount: 1 }, // UPDATE shared_carts
      { rows: [], rowCount: 1 }, // addEvent
    ]);
    db.getClient.mockResolvedValue(client);

    const result = await addSharedCartItem('cart-1', 'user-1', 'p1', 2);

    expect(result.item).toEqual(inserted);
    expect(result.cart).toEqual(cart);
    expectTransactionCommitted(client);
  });
});

describe('removeSharedCartItem (Contrat API §2/§5 point 4 — retrait unitaire, garde-fou item déjà acheté)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('refuse sans item_id, avant toute transaction', async () => {
    await expect(removeSharedCartItem('cart-1', 'user-1', undefined)).rejects.toMatchObject({
      code: 'item_id_required', status: 400,
    });
    expect(db.getClient).not.toHaveBeenCalled();
  });

  it('panier introuvable ou non autorisé → 404', async () => {
    const client = makeClient([{ rows: [] }]);
    db.getClient.mockResolvedValue(client);

    await expect(removeSharedCartItem('cart-1', 'user-1', 'item-1')).rejects.toMatchObject({
      code: 'shared_cart_not_found', status: 404,
    });
    expectTransactionRolledBack(client);
  });

  it('refuse si le panier n\'est plus open', async () => {
    const client = makeClient([{ rows: [{ id: 'cart-1', status: 'closed' }] }]);
    db.getClient.mockResolvedValue(client);

    await expect(removeSharedCartItem('cart-1', 'user-1', 'item-1')).rejects.toMatchObject({
      code: 'cart_not_editable', status: 409,
    });
    expectTransactionRolledBack(client);
  });

  it('article introuvable dans ce panier → 404', async () => {
    const client = makeClient([
      { rows: [{ id: 'cart-1', status: 'open' }] },
      { rows: [] },
    ]);
    db.getClient.mockResolvedValue(client);

    await expect(removeSharedCartItem('cart-1', 'user-1', 'item-1')).rejects.toMatchObject({
      code: 'item_not_found', status: 404,
    });
    expectTransactionRolledBack(client);
  });

  it('article déjà acheté (order_items.shared_cart_item_id non-NULL) → 409, jamais de détachement silencieux', async () => {
    const client = makeClient([
      { rows: [{ id: 'cart-1', status: 'open' }] },
      { rows: [{ id: 'item-1', claimed: true }] },
    ]);
    db.getClient.mockResolvedValue(client);

    await expect(removeSharedCartItem('cart-1', 'user-1', 'item-1')).rejects.toMatchObject({
      code: 'item_already_claimed', status: 409,
    });
    expectTransactionRolledBack(client);
  });

  it('retire un article non réclamé, journalise l\'événement, commit', async () => {
    const cart = { id: 'cart-1', status: 'open' };
    const client = makeClient([
      { rows: [cart] },                          // SELECT ... FOR UPDATE
      { rows: [{ id: 'item-1', claimed: false }] }, // SELECT item + claim check
      { rows: [], rowCount: 1 },                 // DELETE shared_cart_items
      { rows: [], rowCount: 1 },                 // UPDATE shared_carts
      { rows: [], rowCount: 1 },                 // addEvent
    ]);
    db.getClient.mockResolvedValue(client);

    const result = await removeSharedCartItem('cart-1', 'user-1', 'item-1');

    expect(result.cart).toEqual(cart);
    expectTransactionCommitted(client);
  });
});

describe('updateSharedCartItemQuantity (amendement V2 §B — modification unitaire de quantité)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('refuse sans item_id, avant toute transaction', async () => {
    await expect(updateSharedCartItemQuantity('cart-1', 'user-1', undefined, 2)).rejects.toMatchObject({
      code: 'item_id_required', status: 400,
    });
    expect(db.getClient).not.toHaveBeenCalled();
  });

  it('refuse une quantité invalide (<= 0), avant toute transaction', async () => {
    await expect(updateSharedCartItemQuantity('cart-1', 'user-1', 'item-1', 0)).rejects.toMatchObject({
      code: 'invalid_quantity', status: 400,
    });
    expect(db.getClient).not.toHaveBeenCalled();
  });

  it('refuse une quantité non numérique, avant toute transaction', async () => {
    await expect(updateSharedCartItemQuantity('cart-1', 'user-1', 'item-1', 'abc')).rejects.toMatchObject({
      code: 'invalid_quantity', status: 400,
    });
    expect(db.getClient).not.toHaveBeenCalled();
  });

  it('refuse une quantité non entière (ex. 2.5), avant toute transaction — correctif V2-B.1 §6', async () => {
    await expect(updateSharedCartItemQuantity('cart-1', 'user-1', 'item-1', 2.5)).rejects.toMatchObject({
      code: 'invalid_quantity', status: 400,
    });
    expect(db.getClient).not.toHaveBeenCalled();
  });

  it('panier introuvable ou non autorisé → 404', async () => {
    const client = makeClient([{ rows: [] }]);
    db.getClient.mockResolvedValue(client);

    await expect(updateSharedCartItemQuantity('cart-1', 'user-1', 'item-1', 2)).rejects.toMatchObject({
      code: 'shared_cart_not_found', status: 404,
    });
    expectTransactionRolledBack(client);
  });

  it('refuse si le panier n\'est plus open', async () => {
    const client = makeClient([{ rows: [{ id: 'cart-1', status: 'closed' }] }]);
    db.getClient.mockResolvedValue(client);

    await expect(updateSharedCartItemQuantity('cart-1', 'user-1', 'item-1', 2)).rejects.toMatchObject({
      code: 'cart_not_editable', status: 409,
    });
    expectTransactionRolledBack(client);
  });

  it('article introuvable dans ce panier → 404', async () => {
    const client = makeClient([
      { rows: [{ id: 'cart-1', status: 'open' }] },
      { rows: [] },
    ]);
    db.getClient.mockResolvedValue(client);

    await expect(updateSharedCartItemQuantity('cart-1', 'user-1', 'item-1', 2)).rejects.toMatchObject({
      code: 'item_not_found', status: 404,
    });
    expectTransactionRolledBack(client);
  });

  it('article déjà acheté → 409, quantité jamais modifiée', async () => {
    const client = makeClient([
      { rows: [{ id: 'cart-1', status: 'open' }] },
      { rows: [{ id: 'item-1', quantity: 1, unit_price_kmf_snapshot: 1000, claimed: true }] },
    ]);
    db.getClient.mockResolvedValue(client);

    await expect(updateSharedCartItemQuantity('cart-1', 'user-1', 'item-1', 3)).rejects.toMatchObject({
      code: 'item_already_claimed', status: 409,
    });
    expectTransactionRolledBack(client);
  });

  it('modifie la quantité, recalcule uniquement line_total_kmf_snapshot, journalise previous_quantity, commit', async () => {
    const cart = { id: 'cart-1', status: 'open' };
    const updatedItem = { id: 'item-1', quantity: 3, unit_price_kmf_snapshot: 1000, line_total_kmf_snapshot: 3000 };
    const client = makeClient([
      { rows: [cart] },                                                              // SELECT ... FOR UPDATE
      { rows: [{ id: 'item-1', quantity: 1, unit_price_kmf_snapshot: 1000, claimed: false }] }, // SELECT item FOR UPDATE OF sci
      { rows: [updatedItem] },                                                       // UPDATE shared_cart_items RETURNING *
      { rows: [], rowCount: 1 },                                                     // UPDATE shared_carts
      { rows: [], rowCount: 1 },                                                     // addEvent
    ]);
    db.getClient.mockResolvedValue(client);

    const result = await updateSharedCartItemQuantity('cart-1', 'user-1', 'item-1', 3);

    expect(result.cart).toEqual(cart);
    expect(result.item).toEqual(updatedItem);
    const updateCall = client.calls.find(c => String(c.sql).includes('UPDATE shared_cart_items'));
    expect(updateCall.params).toEqual([3, 3000, 'item-1']);
    expectTransactionCommitted(client);
  });
});
