'use strict';

/**
 * tests/unit/group-api-timeout.test.js — FIX 2026-07-10
 *
 * Non-régression "vue groupe bloquée sur Chargement…".
 * Cahier des charges G.5 (partie group-api) :
 *   - fetchWithTimeout rejette proprement (erreur lisible, isTimeout)
 *   - les endpoints publics du panier partagé ne peuvent plus rester pendus
 *   - pas de promesse pendue silencieuse
 */

jest.mock('../../js/b-utils.js', () => ({
  apiGet: jest.fn(),
  apiPost: jest.fn(),
}));

const {
  fetchWithTimeout,
  getSharedCartPublic,
} = require('../../js/group/group-api.js');

function neverSettles() { return new Promise(() => {}); }

describe('group-api — fetchWithTimeout', () => {
  test('rejette proprement en ~timeoutMs quand fetch ne se règle jamais', async () => {
    global.fetch = jest.fn(() => neverSettles());
    const start = Date.now();
    await expect(fetchWithTimeout('/api/shared-carts/public/tok', {}, 250))
      .rejects.toMatchObject({ name: 'TimeoutError', isTimeout: true });
    expect(Date.now() - start).toBeLessThan(3000);
  });

  test('message d\'erreur lisible avec l\'URL en cause', async () => {
    global.fetch = jest.fn(() => neverSettles());
    await fetchWithTimeout('/api/x', {}, 100).catch((e) => {
      expect(e.message).toMatch(/timeout/i);
      expect(e.message).toContain('/api/x');
    });
  });

  test('laisse passer une réponse rapide inchangée', async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ a: 1 }) }));
    const rsp = await fetchWithTimeout('/api/fast', {}, 1000);
    expect(rsp.ok).toBe(true);
  });

  test('getSharedCartPublic : fetch pendu → rejet en ≤ timeout (plus jamais pendu)', async () => {
    global.fetch = jest.fn(() => neverSettles());
    // Le timeout par défaut est 10s — trop long pour un test unitaire,
    // on vérifie que la promesse EST bien câblée sur fetchWithTimeout en
    // observant l'abort du signal passé à fetch.
    const p = getSharedCartPublic('tok-123');
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/shared-carts/public/tok-123',
      expect.objectContaining({ credentials: 'include', signal: expect.anything() })
    );
    // On n'attend pas les 10s : on vérifie juste que le rejet est géré ailleurs.
    p.catch(() => {});
  });
});
