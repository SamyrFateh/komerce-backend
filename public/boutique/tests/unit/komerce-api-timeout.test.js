'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/komerce-api-timeout.test.js — FIX 2026-07-10
 *
 * Non-régression de l'incident "chargement infini boutique" :
 * la couche centrale K.request a désormais un timeout global par requête
 * (deadline couvrant retries + backoffs) et garantit la libération de la
 * queue (_rl, MAX_CONC=2) même quand fetch ne se règle jamais.
 *
 * Couvre exactement le cahier des charges G.1 :
 *   - une requête pending → timeout (erreur lisible, isTimeout=true)
 *   - la queue est libérée après timeout
 *   - deux requêtes pendues ne bloquent pas définitivement une troisième
 *   - le timeout borne aussi les retries (503 en boucle)
 */

jest.setTimeout(20000);

require('../../js/komerce-api.js');

const K = window.K;

function okResponse(body = {}) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
}

/** fetch qui ne se règle JAMAIS (simule un pool DB saturé côté backend). */
function neverSettles() {
  return new Promise(() => {});
}

describe('K.request — timeout central', () => {
  beforeEach(() => {
    K.auth.setUrl(window.location.origin);
  });

  test('une requête pendue rejette en ~timeoutMs avec une erreur timeout lisible', async () => {
    global.fetch = jest.fn(() => neverSettles());
    const start = Date.now();
    await expect(
      K.request('/api/relais', 'GET', null, 2, { timeoutMs: 300 })
    ).rejects.toMatchObject({ name: 'TimeoutError', isTimeout: true });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(250);
    expect(elapsed).toBeLessThan(5000);
    // Message explicite pour les logs/UI
    await K.request('/api/relais', 'GET', null, 0, { timeoutMs: 200 }).catch((e) => {
      expect(e.message).toMatch(/timeout/i);
      expect(e.message).toContain('/api/relais');
    });
  });

  test('la queue est libérée après timeout : une requête suivante aboutit', async () => {
    let call = 0;
    global.fetch = jest.fn(() => {
      call++;
      return call === 1 ? neverSettles() : okResponse({ ok: true, n: call });
    });

    await expect(
      K.request('/api/wallet', 'GET', null, 0, { timeoutMs: 250 })
    ).rejects.toMatchObject({ isTimeout: true });

    // Si le slot n'était pas rendu, cette requête resterait en queue pour toujours.
    const result = await K.request('/api/products', 'GET', null, 0, { timeoutMs: 3000 });
    expect(result.ok).toBe(true);
  });

  test('deux requêtes pendues (MAX_CONC=2 saturé) ne bloquent pas définitivement une troisième', async () => {
    let call = 0;
    global.fetch = jest.fn(() => {
      call++;
      // Les 2 premières pendent (occupent les 2 slots), la 3e répond.
      return call <= 2 ? neverSettles() : okResponse({ ok: true });
    });

    const p1 = K.request('/api/a', 'GET', null, 0, { timeoutMs: 300 });
    const p2 = K.request('/api/b', 'GET', null, 0, { timeoutMs: 300 });
    const p3 = K.request('/api/c', 'GET', null, 0, { timeoutMs: 5000 });

    await expect(p1).rejects.toMatchObject({ isTimeout: true });
    await expect(p2).rejects.toMatchObject({ isTimeout: true });
    const r3 = await p3; // débloquée dès qu'un slot est libéré par le timeout
    expect(r3.ok).toBe(true);
  });

  test('les retries (503 en boucle) sont bornés par la deadline globale', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({ error: 'DB indisponible' }) })
    );
    const start = Date.now();
    await expect(
      K.request('/api/categories', 'GET', null, 5, { timeoutMs: 800 })
    ).rejects.toBeTruthy();
    // Sans deadline, 5 retries à backoff exponentiel ≈ 24s. Avec : ≤ ~timeout.
    expect(Date.now() - start).toBeLessThan(3000);
  });

  test('les erreurs HTTP portent un status exploitable par les vues (401)', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({ error: 'Non authentifié' }) })
    );
    await expect(
      K.request('/api/wallet', 'GET', null, 0, { timeoutMs: 2000 })
    ).rejects.toMatchObject({ status: 401 });
  });
});
