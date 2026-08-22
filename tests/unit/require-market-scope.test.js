'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

/**
 * tests/unit/require-market-scope.test.js
 *
 * Couvre middleware/require-market-scope.js avec db.query mocké — tourne
 * dans la suite unitaire standard (npm test), sans DATABASE_URL.
 *
 * Complémentaire à tests/integration/market-scope-isolation.test.js, qui
 * teste les MÊMES invariants contre un vrai Postgres (index unique partiel,
 * cycle grant/revoke/re-grant). Ce fichier-ci couvre les chemins purement
 * synchrones et la forme exacte des requêtes SQL envoyées à db.query,
 * jamais testable par une suite qui skip sans DB.
 */

const mockDbQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockDbQuery(...args) }));

const {
  resolveAuthorizedMarkets,
  attachAuthorizedMarkets,
  requireMarketScope,
} = require('../../middleware/require-market-scope');

function mockReqRes(user, extra = {}) {
  const req = { user: user ? { id: user } : null, ...extra };
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  const next = jest.fn();
  return { req, res, next };
}

beforeEach(() => {
  mockDbQuery.mockReset();
});

describe('resolveAuthorizedMarkets', () => {
  test('retourne un Set vide sans requête DB si userId est falsy', async () => {
    const scopes = await resolveAuthorizedMarkets(null);
    expect(scopes).toEqual(new Set());
    expect(mockDbQuery).not.toHaveBeenCalled();
  });

  test('filtre toujours sur revoked_at IS NULL — jamais un scope révoqué', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ market_id: 'm1' }] });
    await resolveAuthorizedMarkets('user-1');

    const [sql, params] = mockDbQuery.mock.calls[0];
    expect(sql).toMatch(/revoked_at IS NULL/);
    expect(sql).toMatch(/WHERE user_id = \$1/);
    expect(params).toEqual(['user-1']);
  });

  test('construit un Set à partir des lignes retournées', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ market_id: 'm1' }, { market_id: 'm2' }] });
    const scopes = await resolveAuthorizedMarkets('user-1');
    expect(scopes).toEqual(new Set(['m1', 'm2']));
  });
});

describe('attachAuthorizedMarkets', () => {
  test('peuple req.authorizedMarkets et appelle next, même si vide', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    const { req, next } = mockReqRes('user-1');
    await attachAuthorizedMarkets(req, {}, next);
    expect(req.authorizedMarkets).toEqual(new Set());
    expect(next).toHaveBeenCalledWith(); // pas d'erreur passée
  });

  test('propage une erreur DB à next(err), ne throw jamais', async () => {
    const dbError = new Error('connection lost');
    mockDbQuery.mockRejectedValueOnce(dbError);
    const { req, next } = mockReqRes('user-1');
    await attachAuthorizedMarkets(req, {}, next);
    expect(next).toHaveBeenCalledWith(dbError);
  });
});

describe('requireMarketScope', () => {
  test('401 immédiat si req.user absent — aucun appel DB', async () => {
    const { req, res, next } = mockReqRes(null);
    const mw = requireMarketScope(() => 'market-a');
    await mw(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
    expect(mockDbQuery).not.toHaveBeenCalled();
  });

  test('400 si getTargetMarketId ne résout aucun marché', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ market_id: 'market-a' }] });
    const { req, res, next } = mockReqRes('user-1');
    const mw = requireMarketScope(() => null);
    await mw(req, res, next);
    expect(res.statusCode).toBe(400);
    expect(next).not.toHaveBeenCalled();
  });

  test('403 si le marché cible n\'est pas dans authorizedMarkets', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ market_id: 'market-a' }] });
    const { req, res, next } = mockReqRes('user-1');
    const mw = requireMarketScope(() => 'market-b');
    await mw(req, res, next);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('market_scope_denied');
    expect(next).not.toHaveBeenCalled();
  });

  test('next() si le marché cible est autorisé', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ market_id: 'market-a' }] });
    const { req, res, next } = mockReqRes('user-1');
    const mw = requireMarketScope(() => 'market-a');
    await mw(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200); // jamais touché
  });

  test('réutilise req.authorizedMarkets si déjà peuplé — pas de 2e requête DB', async () => {
    const { req, res, next } = mockReqRes('user-1');
    req.authorizedMarkets = new Set(['market-a']);
    const mw = requireMarketScope(() => 'market-a');
    await mw(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(mockDbQuery).not.toHaveBeenCalled(); // résolu une seule fois en amont
  });

  test('ignore totalement req.body.market_id — getTargetMarketId est la seule source', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ market_id: 'market-a' }] });
    const { req, res, next } = mockReqRes('user-1', { body: { market_id: 'market-b' } });
    // getTargetMarketId ne lit QUE la ressource serveur (ici codée en dur à
    // market-a) — jamais req.body, même si un client tente de le fournir.
    const mw = requireMarketScope(() => 'market-a');
    await mw(req, res, next);
    expect(next).toHaveBeenCalledTimes(1); // autorisé via market-a, pas via req.body
  });

  test('propage une erreur DB à next(err)', async () => {
    const dbError = new Error('pool exhausted');
    mockDbQuery.mockRejectedValueOnce(dbError);
    const { req, res, next } = mockReqRes('user-1');
    const mw = requireMarketScope(() => 'market-a');
    await mw(req, res, next);
    expect(next).toHaveBeenCalledWith(dbError);
  });
});
