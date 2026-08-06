'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * Tests unitaires — dashboard-cache.js
 *
 * Invariants couverts :
 *   buildCacheKey   : clé déterministe, stable malgré l'ordre des filtres
 *   get / set       : hit valide, miss après expiration, miss si absent
 *   clear           : vide tout ou par préfixe
 *   invalidateAllDashboards : préfixe 'dashboard:'
 *   stats           : reflète l'état courant
 *   cacheMiddleware : bypass sur ?refresh=1, bypass sur Cache-Control: no-cache,
 *                     hit renvoie is_cached:true, miss intercepte res.json et stocke
 *
 * Aucun accès base — le module est 100 % en mémoire (Map JS).
 */

// Isoler le cache entre les tests : on reload le module à chaque describe via jest.isolateModules()
// pour que le Map interne soit vide.

function loadCache() {
  jest.resetModules();
  return require('../../services/dashboard-cache');
}

// ─── buildCacheKey ────────────────────────────────────────────────────────────
describe("buildCacheKey", () => {
  let cache;
  beforeEach(() => { cache = loadCache(); });

  test("inclut le nom d'endpoint", () => {
    const k = cache.buildCacheKey('control-tower', {});
    expect(k).toMatch(/dashboard:control-tower/);
  });

  test("produit la même clé quel que soit l'ordre des filtres", () => {
    const k1 = cache.buildCacheKey('finance', { from: '2026-01', to: '2026-06' });
    const k2 = cache.buildCacheKey('finance', { to: '2026-06', from: '2026-01' });
    expect(k1).toBe(k2);
  });

  test("exclut les valeurs null / vide des filtres", () => {
    const k1 = cache.buildCacheKey('ep', { from: null, to: '' });
    const k2 = cache.buildCacheKey('ep', {});
    expect(k1).toBe(k2);
  });

  test("clés différentes pour endpoints différents", () => {
    const k1 = cache.buildCacheKey('control-tower', {});
    const k2 = cache.buildCacheKey('logistics', {});
    expect(k1).not.toBe(k2);
  });
});

// ─── get / set / expiration ───────────────────────────────────────────────────
describe("get / set", () => {
  let cache;
  beforeEach(() => { cache = loadCache(); });

  test("get retourne null si clé absente", () => {
    expect(cache.get('absent')).toBeNull();
  });

  test("set + get retourne les données avec ageMs >= 0", () => {
    cache.set('k1', { value: 42 });
    const hit = cache.get('k1');
    expect(hit).not.toBeNull();
    expect(hit.data).toEqual({ value: 42 });
    expect(hit.ageMs).toBeGreaterThanOrEqual(0);
  });

  test("get retourne null après expiration TTL", () => {
    // TTL 1ms — immédiatement expiré
    cache.set('k-expired', { x: 1 }, 1);
    // Attente non nécessaire : Date.now() >= generatedAt + 1 ms est très probable
    // mais pour être déterministe on fixe le temps via jest.setSystemTime
    const now = Date.now();
    jest.useFakeTimers();
    jest.setSystemTime(now + 100); // +100 ms >> TTL 1 ms
    expect(cache.get('k-expired')).toBeNull();
    jest.useRealTimers();
  });

  test("le TTL par défaut est 30 000 ms", () => {
    expect(cache.DEFAULT_TTL_MS).toBe(30000);
  });
});

// ─── clear ────────────────────────────────────────────────────────────────────
describe("clear", () => {
  let cache;
  beforeEach(() => { cache = loadCache(); });

  test("clear() sans argument vide tout le cache", () => {
    cache.set('dashboard:a', 1);
    cache.set('dashboard:b', 2);
    const n = cache.clear();
    expect(n).toBe(2);
    expect(cache.stats().size).toBe(0);
  });

  test("clear(prefix) ne supprime que les entrées correspondantes", () => {
    cache.set('dashboard:control-tower:{}', 1);
    cache.set('dashboard:finance:{}', 2);
    cache.set('other:key', 3);
    const n = cache.clear('dashboard:control-tower');
    expect(n).toBe(1);
    expect(cache.stats().size).toBe(2); // finance + other restent
  });

  test("clear(prefix) avec préfixe inconnu retourne 0", () => {
    cache.set('dashboard:x', 1);
    expect(cache.clear('noop')).toBe(0);
  });
});

// ─── invalidateAllDashboards ──────────────────────────────────────────────────
describe("invalidateAllDashboards", () => {
  let cache;
  beforeEach(() => { cache = loadCache(); });

  test("supprime toutes les entrées \"dashboard:\"", () => {
    cache.set('dashboard:control-tower:{}', 'a');
    cache.set('dashboard:logistics:{}', 'b');
    cache.set('other:key', 'c');
    const n = cache.invalidateAllDashboards();
    expect(n).toBe(2);
    expect(cache.stats().size).toBe(1); // 'other:key' reste
  });
});

// ─── stats ────────────────────────────────────────────────────────────────────
describe("stats", () => {
  let cache;
  beforeEach(() => { cache = loadCache(); });

  test("size reflète le nombre d'entrées actuelles", () => {
    expect(cache.stats().size).toBe(0);
    cache.set('k', 1);
    expect(cache.stats().size).toBe(1);
  });

  test("keys contient la clé insérée", () => {
    cache.set('dashboard:test:{}', {});
    expect(cache.stats().keys).toContain('dashboard:test:{}');
  });
});

// ─── cacheMiddleware ─────────────────────────────────────────────────────────
describe("cacheMiddleware", () => {
  let cache;

  function makeReq(overrides = {}) {
    return {
      query: {},
      headers: {},
      ...overrides,
    };
  }

  function makeRes() {
    const res = {
      statusCode: 200,
      locals: {},
      _sentData: null,
    };
    res.json = jest.fn((data) => { res._sentData = data; return res; });
    return res;
  }

  beforeEach(() => { cache = loadCache(); });

  test("bypass si ?refresh=1 — next() appelé, pas de stockage", async () => {
    const mw = cache.cacheMiddleware('ep');
    const req = makeReq({ query: { refresh: '1' } });
    const res = makeRes();
    const next = jest.fn();
    await mw(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.locals._cacheBypass).toBe(true);
  });

  test("bypass si Cache-Control: no-cache — next() appelé", async () => {
    const mw = cache.cacheMiddleware('ep');
    const req = makeReq({ headers: { 'cache-control': 'no-cache' } });
    const res = makeRes();
    const next = jest.fn();
    await mw(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.locals._cacheBypass).toBe(true);
  });

  test("cache miss → next() appelé, res.json intercepté et stocke", async () => {
    const mw = cache.cacheMiddleware('control-tower');
    const req = makeReq();
    const res = makeRes();
    const next = jest.fn(() => {
      // Simule le handler qui appelle res.json
      res.json({ orders: 5 });
    });
    await mw(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res._sentData).toBeDefined();
    expect(res._sentData.data_quality.is_cached).toBe(false);
    // Vérifier que la donnée est maintenant en cache
    expect(cache.stats().size).toBe(1);
  });

  test("cache hit → res.json renvoyé directement avec is_cached:true, next non appelé", async () => {
    // Pré-remplir le cache
    const mw = cache.cacheMiddleware('logistics');
    const req = makeReq();
    const res1 = makeRes();
    const next1 = jest.fn(() => { res1.json({ kpis: [] }); });
    await mw(req, res1, next1); // miss — stocke

    // Second appel → hit
    const res2 = makeRes();
    const next2 = jest.fn();
    await mw(req, res2, next2);
    expect(next2).not.toHaveBeenCalled();
    expect(res2.json).toHaveBeenCalled();
    const sent = res2.json.mock.calls[0][0];
    expect(sent.data_quality.is_cached).toBe(true);
    expect(sent.data_quality.cache_age_seconds).toBeGreaterThanOrEqual(0);
  });

  test("réponse avec statusCode >= 400 non stockée", async () => {
    const mw = cache.cacheMiddleware('error-ep');
    const req = makeReq();
    const res = makeRes();
    res.statusCode = 500;
    const next = jest.fn(() => { res.json({ error: 'fail' }); });
    await mw(req, res, next);
    expect(cache.stats().size).toBe(0);
  });
});
