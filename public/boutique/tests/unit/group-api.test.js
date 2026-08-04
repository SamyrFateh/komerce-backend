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
 * migration 124). Retrait d'article devient une route unitaire
 * (Contrat API §5 point 4) : removeItemFromSharedList.
 *
 * getSharedCartOwner, getSharedCartItems, addItemToSharedList,
 * cancelSharedCart : retirés (mandat correction liste partageable §5,
 * §3 point 8) — sans appelant réel dans le dépôt, confirmé par grep
 * exhaustif au moment de la suppression.
 */

const { mockWindowK } = require('./helpers/boutiqueTestKit');

const {
  getOwnerSharedCarts,
  removeItemFromSharedList,
  closeCart,
  getSharedCartPublic,
  updateSharedListItemQuantity,
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

  test('removeItemFromSharedList(cartId, itemId) -> DELETE /api/shared-carts/:id/items/:itemId', async () => {
    await removeItemFromSharedList(7, 'item-9');
    expect(K.request).toHaveBeenCalledWith('/api/shared-carts/7/items/item-9', 'DELETE', null, 0, {});
  });

  test('closeCart(cartId) -> POST /api/shared-carts/:id/close avec body vide', async () => {
    await closeCart(7);
    expect(K.request).toHaveBeenCalledWith('/api/shared-carts/7/close', 'POST', {}, 2, {});
  });

  test('propage le rejet si window.K.request échoue (pas de catch silencieux)', async () => {
    K.request.mockRejectedValueOnce(new Error('network down'));
    await expect(getOwnerSharedCarts()).rejects.toThrow('network down');
  });

  test('updateSharedListItemQuantity(cartId, itemId, quantity) -> PATCH /api/shared-carts/:id/items/:itemId', async () => {
    await updateSharedListItemQuantity(7, 'item-9', 3);
    expect(K.request).toHaveBeenCalledWith(
      '/api/shared-carts/7/items/item-9', 'PATCH', { quantity: 3 }, 0, {}
    );
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
