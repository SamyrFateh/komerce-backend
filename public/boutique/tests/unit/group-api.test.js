'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
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
 * getSharedCartOwner, getSharedCartItems, cancelSharedCart : retirés
 * (mandat correction liste partageable §5, §3 point 8) — sans appelant
 * réel dans le dépôt, confirmé par grep exhaustif au moment de la
 * suppression. addItemToSharedList a été retiré pour la même raison
 * (V2-F) puis réintroduit (Lot 3 GAP-07) avec un appelant réel :
 * b-modal-buybox-shared.js::wireAddToListButton.
 */

const { mockWindowK } = require('./helpers/boutiqueTestKit');

const {
  getOwnerSharedCarts,
  closeCart,
  getSharedCartPublic,
} = require('../../js/group/group-api.js');

describe('group-api — liste publiée immuable', () => {
  let K;

  beforeEach(() => {
    K = mockWindowK();
  });

  test('getOwnerSharedCarts() -> GET /api/shared-carts/mine', async () => {
    await getOwnerSharedCarts();
    expect(K.request).toHaveBeenCalledWith(
      '/api/shared-carts/mine', 'GET', null, 2, { timeoutMs: 10_000 }
    );
  });

  test('closeCart(cartId) -> POST /api/shared-carts/:id/close', async () => {
    await closeCart(7);
    expect(K.request).toHaveBeenCalledWith(
      '/api/shared-carts/7/close', 'POST', {}, 2, {}
    );
  });

  test('propage les erreurs réseau', async () => {
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
