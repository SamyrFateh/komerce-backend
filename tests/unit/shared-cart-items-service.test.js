'use strict';

const { makeClient, expectTransactionCommitted, expectTransactionRolledBack } = require('../integration/test-harness/mock-db');

jest.mock('../../db', () => ({ getClient: jest.fn() }));

const db = require('../../db');
const {
  updateOpenSharedCartItems,
  adjustAwaitingCartItems,
} = require('../../services/shared-cart-items-service');

describe('shared-cart-items-service', () => {
  beforeEach(() => jest.clearAllMocks());

  it('refuse un panier vide avant transaction', async () => {
    await expect(updateOpenSharedCartItems('cart-001', 'user-001', [])).rejects.toMatchObject({
      code: 'cart_items_required',
      status: 400,
    });
    expect(db.getClient).not.toHaveBeenCalled();
  });

  it('updateOpenSharedCartItems remplace le snapshot tant que le panier est open et sans paiement', async () => {
    const cart = { id: 'cart-001', status: 'open', total_kmf_snapshot: 9000, contributed_kmf: 0 };
    const product = {
      id: 'prod-001', name: 'Riz', image_url: 'riz.jpg', category: 'food',
      price_kmf: 1000, is_active: true, is_promo: false, promo_pct: 0, promo_until: null,
    };
    const inserted = { id: 'item-001', product_id: 'prod-001', quantity: 3, line_total_kmf_snapshot: 3000 };
    const updatedCart = { ...cart, total_kmf_snapshot: 3000, remaining_kmf: 3000 };
    const client = makeClient([
      { rows: [cart] },
      { rows: [{ n: 0 }] },
      { rows: [product] },
      { rows: [], rowCount: 1 },
      { rows: [inserted] },
      { rows: [updatedCart] },
      { rows: [], rowCount: 1 },
    ]);
    db.getClient.mockResolvedValue(client);

    const result = await updateOpenSharedCartItems('cart-001', 'user-001', [
      { product_id: 'prod-001', quantity: 1 },
      { product_id: 'prod-001', quantity: 2 },
    ]);

    expect(result).toEqual({ cart: updatedCart, items: [inserted] });
    expect(client.calls.find(c => String(c.sql).includes('DELETE FROM shared_cart_items'))).toBeDefined();
    expect(client.calls.find(c => String(c.sql).includes('INSERT INTO shared_cart_items')).params)
      .toEqual(['cart-001', 'prod-001', 'Riz', 'riz.jpg', 'food', 3, 1000, 3000]);
    expect(client.calls.find(c => String(c.sql).includes('shared_cart_items_updated')).params[4])
      .toMatchObject({ previous_total_kmf: 9000, new_total_kmf: 3000, items_count: 1 });
    expectTransactionCommitted(client);
  });

  it('updateOpenSharedCartItems refuse un panier deja paye', async () => {
    const client = makeClient([{ rows: [{ id: 'cart-001', status: 'open', contributed_kmf: 1 }] }]);
    db.getClient.mockResolvedValue(client);

    await expect(updateOpenSharedCartItems('cart-001', 'user-001', [{ product_id: 'p1', quantity: 1 }]))
      .rejects.toMatchObject({ code: 'paid_contributions_exist', status: 409 });
    expectTransactionRolledBack(client);
  });

  it('adjustAwaitingCartItems reduit le panier et relance une fenetre de paiement', async () => {
    const cart = { id: 'cart-001', status: 'awaiting_choice', total_kmf_snapshot: 10000, contributed_kmf: 3000 };
    const product = {
      id: 'prod-001', name: 'Riz', image_url: 'riz.jpg', category: 'food',
      price_kmf: 4000, is_active: true, is_promo: false, promo_pct: 0, promo_until: null,
    };
    const inserted = { id: 'item-001', product_id: 'prod-001', quantity: 1 };
    const updatedCart = { ...cart, status: 'closed', total_kmf_snapshot: 4000, remaining_kmf: 1000 };
    const client = makeClient([
      { rows: [cart] },
      { rows: [product] },
      { rows: [], rowCount: 1 },
      { rows: [inserted] },
      { rows: [updatedCart] },
      { rows: [], rowCount: 1 },
    ]);
    db.getClient.mockResolvedValue(client);

    await expect(adjustAwaitingCartItems('cart-001', 'user-001', [{ product_id: 'prod-001', quantity: 1 }]))
      .resolves.toEqual({ cart: updatedCart, items: [inserted] });
    expect(client.calls.find(c => String(c.sql).includes("status = 'closed'"))).toBeDefined();
    expect(client.calls.find(c => String(c.sql).includes('cart_adjusted_reopened')).params[4])
      .toMatchObject({ previous_total_kmf: 10000, new_total_kmf: 4000, contributed_kmf: 3000, new_remaining_kmf: 1000 });
    expectTransactionCommitted(client);
  });

  it('adjustAwaitingCartItems refuse daugmenter le total', async () => {
    const cart = { id: 'cart-001', status: 'awaiting_choice', total_kmf_snapshot: 5000, contributed_kmf: 1000 };
    const product = { id: 'prod-001', name: 'Riz', image_url: null, category: 'food', price_kmf: 6000, is_active: true };
    const client = makeClient([{ rows: [cart] }, { rows: [product] }]);
    db.getClient.mockResolvedValue(client);

    await expect(adjustAwaitingCartItems('cart-001', 'user-001', [{ product_id: 'prod-001', quantity: 1 }]))
      .rejects.toMatchObject({ code: 'adjustment_must_reduce', status: 400 });
    expectTransactionRolledBack(client);
  });

  it('adjustAwaitingCartItems refuse un total inferieur aux paiements recus', async () => {
    const cart = { id: 'cart-001', status: 'awaiting_choice', total_kmf_snapshot: 10000, contributed_kmf: 7000 };
    const product = { id: 'prod-001', name: 'Riz', image_url: null, category: 'food', price_kmf: 6000, is_active: true };
    const client = makeClient([{ rows: [cart] }, { rows: [product] }]);
    db.getClient.mockResolvedValue(client);

    await expect(adjustAwaitingCartItems('cart-001', 'user-001', [{ product_id: 'prod-001', quantity: 1 }]))
      .rejects.toMatchObject({ code: 'adjustment_below_contributed', status: 400 });
    expectTransactionRolledBack(client);
  });
});
