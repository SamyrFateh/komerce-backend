'use strict';

/**
 * tests/unit/group-api.test.js
 *
 * Module js/group/group-api.js — Boutique First, domaine minimal.
 *
 * Deux familles d'endpoints, deux stratégies de mock :
 *   - Créateur (apiGet/apiPost/apiDelete -> window.K.request) : mockWindowK()
 *     du kit partagé, on vérifie les arguments exacts passés à request().
 *   - Public (fetch direct, credentials:'include') : global.fetch mocké
 *     par test.
 *
 * Estimations, contributions, extend-window, finalize, openSettlement :
 * retirés avec leurs tests (Boutique First — concepts supprimés,
 * migration 124). Ajout/retrait d'article deviennent des routes unitaires
 * (Contrat API §5 point 4) : addItemToSharedList, removeItemFromSharedList.
 */

const { mockWindowK } = require('./helpers/boutiqueTestKit');

const {
  getOwnerSharedCarts,
  getSharedCartOwner,
  getSharedCartItems,
  addItemToSharedList,
  removeItemFromSharedList,
  closeCart,
  cancelSharedCart,
  getSharedCartPublic,
} = require('../../js/group/group-api.js');

describe('group-api — endpoints créateur (window.K.request)', () => {
  let K;

  beforeEach(() => {
    K = mockWindowK();
  });

  test('getOwnerSharedCarts() -> GET /api/shared-carts/mine, timeoutMs transmis', async () => {
    await getOwnerSharedCarts();
    expect(K.request).toHaveBeenCalledWith(
      '/api/shared-carts/mine', 'GET', null, 2, { timeoutMs: 10_000 }
    );
  });

  test('getSharedCartOwner(cartId) -> GET /api/shared-carts/:id', async () => {
    await getSharedCartOwner(42);
    expect(K.request).toHaveBeenCalledWith('/api/shared-carts/42', 'GET', null, 2, {});
  });

  test('getSharedCartItems(cartId) -> GET /api/shared-carts/:id/as-cart-items', async () => {
    await getSharedCartItems(42);
    expect(K.request).toHaveBeenCalledWith('/api/shared-carts/42/as-cart-items', 'GET', null, 2, {});
  });

  test('addItemToSharedList(cartId, productId) -> POST .../items { product_id, quantity: 1 } par défaut', async () => {
    await addItemToSharedList(7, 'prod-1');
    expect(K.request).toHaveBeenCalledWith(
      '/api/shared-carts/7/items', 'POST', { product_id: 'prod-1', quantity: 1 }, 2, {}
    );
  });

  test('addItemToSharedList(cartId, productId, quantity) -> quantité transmise', async () => {
    await addItemToSharedList(7, 'prod-1', 3);
    expect(K.request).toHaveBeenCalledWith(
      '/api/shared-carts/7/items', 'POST', { product_id: 'prod-1', quantity: 3 }, 2, {}
    );
  });

  test('removeItemFromSharedList(cartId, itemId) -> DELETE /api/shared-carts/:id/items/:itemId', async () => {
    await removeItemFromSharedList(7, 'item-9');
    expect(K.request).toHaveBeenCalledWith('/api/shared-carts/7/items/item-9', 'DELETE', null, 0, {});
  });

  test('closeCart(cartId) -> POST /api/shared-carts/:id/close avec body vide', async () => {
    await closeCart(7);
    expect(K.request).toHaveBeenCalledWith('/api/shared-carts/7/close', 'POST', {}, 2, {});
  });

  test('cancelSharedCart(cartId, payload) -> POST .../cancel avec le payload', async () => {
    await cancelSharedCart(7, { reason: 'test' });
    expect(K.request).toHaveBeenCalledWith(
      '/api/shared-carts/7/cancel', 'POST', { reason: 'test' }, 2, {}
    );
  });

  test('propage le rejet si window.K.request échoue (pas de catch silencieux)', async () => {
    K.request.mockRejectedValueOnce(new Error('network down'));
    await expect(getOwnerSharedCarts()).rejects.toThrow('network down');
  });
});

describe('group-api — endpoint public (fetch direct)', () => {
  afterEach(() => { delete global.fetch; });

  test('getSharedCartPublic(token) : ok -> retourne le JSON, is_creator inclus', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ cart: { id: 1 }, items: [], is_creator: false }) })
    );
    const result = await getSharedCartPublic('tok-1');
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/shared-carts/public/tok-1',
      expect.objectContaining({ credentials: 'include' })
    );
    expect(result).toEqual({ cart: { id: 1 }, items: [], is_creator: false });
  });

  test('getSharedCartPublic(token) : réponse non-ok -> retourne null (jamais throw)', async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: false }));
    const result = await getSharedCartPublic('tok-bad');
    expect(result).toBeNull();
  });
});
