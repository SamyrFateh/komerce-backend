'use strict';

/**
 * tests/unit/group-api.test.js
 *
 * Module js/group/group-api.js (199L) — @role shared-cart-front-api,
 * @criticality high. Couche réseau exclusive du panier partagé côté
 * boutique (créateur ET participant public) : centralise TOUS les appels
 * vers routes/shared-cart.js.
 *
 * 0% de couverture réelle avant cette session : le seul point d'entrée
 * (b-group-view.test.js) le mocke intégralement (`jest.mock('../../js/
 * group/group-api.js', () => mockGroupApi)`) — jamais importé pour de
 * vrai nulle part. Aucun bug de transport (mauvais verb, mauvais body,
 * mauvaise gestion d'erreur serveur) sur ce fichier ne serait détecté par
 * la suite existante.
 *
 * Deux familles d'endpoints, deux stratégies de mock :
 *   - Créateur (apiGet/apiPost -> window.K.request) : mockWindowK() du kit
 *     partagé, on vérifie les arguments exacts passés à request().
 *   - Public (fetch direct, credentials:'include') : global.fetch mocké
 *     par test, on vérifie l'URL/verb/body ET le parsing de la réponse
 *     (cas ok, cas erreur avec message serveur, cas erreur sans JSON
 *     valide -> message générique de fallback).
 *
 * Pas de DOM, pas d'état b-store impliqué : module pur "transport".
 */

const { mockWindowK } = require('./helpers/boutiqueTestKit');

const {
  getOwnerSharedCarts,
  getSharedCartOwner,
  getSharedCartItems,
  closeCart,
  openSettlement,
  extendPaymentWindow,
  finalizeSharedCart,
  cancelSharedCart,
  getSharedCartPublic,
  getEstimationAggregate,
  upsertEstimation,
  deleteEstimation,
  getEstimationByPhone,
  createContribution,
} = require('../../js/group/group-api.js');

describe('group-api — endpoints créateur (window.K.request)', () => {
  let K;

  beforeEach(() => {
    K = mockWindowK();
  });

  test('getOwnerSharedCarts() -> GET /api/shared-carts/mine', async () => {
    await getOwnerSharedCarts();
    expect(K.request).toHaveBeenCalledWith('/api/shared-carts/mine', 'GET', null, 2, {});
  });

  test('getSharedCartOwner(cartId) -> GET /api/shared-carts/:id', async () => {
    await getSharedCartOwner(42);
    expect(K.request).toHaveBeenCalledWith('/api/shared-carts/42', 'GET', null, 2, {});
  });

  test('getSharedCartItems(cartId) -> GET /api/shared-carts/:id/as-cart-items', async () => {
    await getSharedCartItems(42);
    expect(K.request).toHaveBeenCalledWith('/api/shared-carts/42/as-cart-items', 'GET', null, 2, {});
  });

  test('closeCart(cartId) -> POST /api/shared-carts/:id/close avec body vide', async () => {
    await closeCart(7);
    expect(K.request).toHaveBeenCalledWith('/api/shared-carts/7/close', 'POST', {}, 2, {});
  });

  test('openSettlement() est un alias strict de closeCart()', async () => {
    await openSettlement(7);
    expect(K.request).toHaveBeenCalledWith('/api/shared-carts/7/close', 'POST', {}, 2, {});
  });

  test('extendPaymentWindow(cartId) -> POST .../extend-window', async () => {
    await extendPaymentWindow(7);
    expect(K.request).toHaveBeenCalledWith('/api/shared-carts/7/extend-window', 'POST', {}, 2, {});
  });

  test('finalizeSharedCart(cartId, payload) -> POST .../finalize avec le payload', async () => {
    await finalizeSharedCart(7, { accept_partial: true });
    expect(K.request).toHaveBeenCalledWith(
      '/api/shared-carts/7/finalize', 'POST', { accept_partial: true }, 2, {}
    );
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

describe('group-api — endpoints publics (fetch direct)', () => {
  afterEach(() => { delete global.fetch; });

  test('getSharedCartPublic(token) : ok -> retourne le JSON', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ cart: { id: 1 }, items: [] }) })
    );
    const result = await getSharedCartPublic('tok-1');
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/shared-carts/public/tok-1',
      { credentials: 'include', signal: expect.any(AbortSignal) }
    );
    expect(result).toEqual({ cart: { id: 1 }, items: [] });
  });

  test('getSharedCartPublic(token) : réponse non-ok -> retourne null (jamais throw)', async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: false }));
    const result = await getSharedCartPublic('tok-bad');
    expect(result).toBeNull();
  });

  test('getEstimationAggregate(token) : ok -> coerce les champs en Number', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ total_estimated_kmf: '1500', count: '3' }) })
    );
    const result = await getEstimationAggregate('tok-1');
    expect(result).toEqual({ total_estimated_kmf: 1500, count: 3 });
  });

  test('getEstimationAggregate(token) : ok mais champs absents -> 0 par défaut', async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));
    const result = await getEstimationAggregate('tok-1');
    expect(result).toEqual({ total_estimated_kmf: 0, count: 0 });
  });

  test('getEstimationAggregate(token) : non-ok -> valeurs neutres sans throw', async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: false }));
    const result = await getEstimationAggregate('tok-1');
    expect(result).toEqual({ total_estimated_kmf: 0, count: 0 });
  });

  test('upsertEstimation(token, payload) : succès -> POST JSON + retourne le body', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 5 }) })
    );
    const payload = { amount_kmf: 1000, participant_phone: '+269123' };
    const result = await upsertEstimation('tok-1', payload);
    expect(global.fetch).toHaveBeenCalledWith('/api/shared-carts/public/tok-1/estimations', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: expect.any(AbortSignal),
    });
    expect(result).toEqual({ id: 5 });
  });

  test('upsertEstimation() : échec avec message serveur -> throw ce message', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: false, json: () => Promise.resolve({ message: 'Montant invalide' }) })
    );
    await expect(upsertEstimation('tok-1', {})).rejects.toThrow('Montant invalide');
  });

  test('upsertEstimation() : échec avec champ error (pas message) -> throw error', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: false, json: () => Promise.resolve({ error: 'Token expiré' }) })
    );
    await expect(upsertEstimation('tok-1', {})).rejects.toThrow('Token expiré');
  });

  test('upsertEstimation() : échec sans JSON parsable -> message générique de fallback', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: false, json: () => Promise.reject(new Error('not json')) })
    );
    await expect(upsertEstimation('tok-1', {})).rejects.toThrow('Erreur lors de l\'enregistrement.');
  });

  test('deleteEstimation(token, id) sans phone -> body {}', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ deleted: true }) })
    );
    await deleteEstimation('tok-1', 99);
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/shared-carts/public/tok-1/estimations/99',
      expect.objectContaining({ method: 'DELETE', body: JSON.stringify({}) })
    );
  });

  test('deleteEstimation(token, id, phone) avec phone -> body { participant_phone }', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ deleted: true }) })
    );
    await deleteEstimation('tok-1', 99, '+269123');
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/shared-carts/public/tok-1/estimations/99',
      expect.objectContaining({ body: JSON.stringify({ participant_phone: '+269123' }) })
    );
  });

  test('deleteEstimation() : échec -> throw le message serveur, sinon message générique', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: false, json: () => Promise.resolve({}) })
    );
    await expect(deleteEstimation('tok-1', 99)).rejects.toThrow('Retrait impossible.');
  });

  test('getEstimationByPhone() : ok -> retourne estimation, absent -> null', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ estimation: { amount_kmf: 500 } }) })
    );
    const result = await getEstimationByPhone('tok-1', '+269123');
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/shared-carts/public/tok-1/estimations/by-phone?phone=%2B269123',
      { credentials: 'include', signal: expect.any(AbortSignal) }
    );
    expect(result).toEqual({ amount_kmf: 500 });
  });

  test('getEstimationByPhone() : réponse non-ok -> null (pas de throw)', async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: false }));
    const result = await getEstimationByPhone('tok-1', '+269123');
    expect(result).toBeNull();
  });

  test('getEstimationByPhone() : fetch qui throw -> catch silencieux -> null', async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('network down')));
    const result = await getEstimationByPhone('tok-1', '+269123');
    expect(result).toBeNull();
  });

  test('createContribution(token, payload) : succès -> retourne checkout_url', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ checkout_url: 'https://stripe/x' }) })
    );
    const payload = { amount_kmf: 2000, contributor_name: 'Ali', contributor_email: 'a@b.com', contributor_phone: '+269' };
    const result = await createContribution('tok-1', payload);
    expect(global.fetch).toHaveBeenCalledWith('/api/shared-carts/public/tok-1/contributions', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: expect.any(AbortSignal),
    });
    expect(result).toEqual({ checkout_url: 'https://stripe/x' });
  });

  test('createContribution() : échec avec message serveur -> throw ce message', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: false, json: () => Promise.resolve({ message: 'Carte refusée' }) })
    );
    await expect(createContribution('tok-1', {})).rejects.toThrow('Carte refusée');
  });

  test('createContribution() : échec sans JSON parsable -> message générique de fallback', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: false, json: () => Promise.reject(new Error('not json')) })
    );
    await expect(createContribution('tok-1', {})).rejects.toThrow('Erreur lors de la contribution.');
  });
});
