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
 */

const mockDbQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockDbQuery(...args) }));

const {
  resolveAuthorizedMarketScopes,
  resolveAuthorizedMarkets,
  attachAuthorizedMarkets,
  requireMarketScope,
  requireMarketScopeRole,
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

describe('resolveAuthorizedMarketScopes', () => {
  test('retourne une Map vide sans DB si userId est falsy', async () => {
    expect(await resolveAuthorizedMarketScopes(null)).toEqual(new Map());
    expect(mockDbQuery).not.toHaveBeenCalled();
  });

  test('charge market_id + role et ignore un rôle hors contrat', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [
      { market_id: 'm1', role: 'viewer' },
      { market_id: 'm2', role: 'manager' },
      { market_id: 'm3', role: 'admin' },
    ] });
    const scopes = await resolveAuthorizedMarketScopes('user-1');
    expect(scopes).toEqual(new Map([['m1', 'viewer'], ['m2', 'manager']]));
    const [sql] = mockDbQuery.mock.calls[0];
    expect(sql).toMatch(/SELECT market_id, role/);
    expect(sql).toMatch(/revoked_at IS NULL/);
  });
});

describe('resolveAuthorizedMarkets', () => {
  test('retourne un Set vide sans requête DB si userId est falsy', async () => {
    const scopes = await resolveAuthorizedMarkets(null);
    expect(scopes).toEqual(new Set());
    expect(mockDbQuery).not.toHaveBeenCalled();
  });

  test('filtre toujours sur revoked_at IS NULL — jamais un scope révoqué', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ market_id: 'm1', role: 'viewer' }] });
    await resolveAuthorizedMarkets('user-1');

    const [sql, params] = mockDbQuery.mock.calls[0];
    expect(sql).toMatch(/revoked_at IS NULL/);
    expect(sql).toMatch(/WHERE user_id = \$1/);
    expect(params).toEqual(['user-1']);
  });

  test('construit un Set à partir des grants valides retournés', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [
      { market_id: 'm1', role: 'viewer' },
      { market_id: 'm2', role: 'manager' },
    ] });
    const scopes = await resolveAuthorizedMarkets('user-1');
    expect(scopes).toEqual(new Set(['m1', 'm2']));
  });
});

describe('attachAuthorizedMarkets', () => {
  test('peuple Set + Map et appelle next, même si vide', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    const { req, next } = mockReqRes('user-1');
    await attachAuthorizedMarkets(req, {}, next);
    expect(req.authorizedMarkets).toEqual(new Set());
    expect(req.authorizedMarketScopes).toEqual(new Map());
    expect(next).toHaveBeenCalledWith();
  });

  test('peuple le rôle de chaque grant dans authorizedMarketScopes', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ market_id: 'm1', role: 'manager' }] });
    const { req, next } = mockReqRes('user-1');
    await attachAuthorizedMarkets(req, {}, next);
    expect(req.authorizedMarkets).toEqual(new Set(['m1']));
    expect(req.authorizedMarketScopes.get('m1')).toBe('manager');
    expect(next).toHaveBeenCalled();
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
    await requireMarketScope(() => 'market-a')(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
    expect(mockDbQuery).not.toHaveBeenCalled();
  });

  test('400 si getTargetMarketId ne résout aucun marché', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ market_id: 'market-a', role: 'viewer' }] });
    const { req, res, next } = mockReqRes('user-1');
    await requireMarketScope(() => null)(req, res, next);
    expect(res.statusCode).toBe(400);
    expect(next).not.toHaveBeenCalled();
  });

  test('403 si le marché cible nest pas dans les scopes', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ market_id: 'market-a', role: 'viewer' }] });
    const { req, res, next } = mockReqRes('user-1');
    await requireMarketScope(() => 'market-b')(req, res, next);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('market_scope_denied');
    expect(next).not.toHaveBeenCalled();
  });

  test('next() pour viewer ou manager sur le marché cible', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ market_id: 'market-a', role: 'viewer' }] });
    const { req, res, next } = mockReqRes('user-1');
    await requireMarketScope(() => 'market-a')(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.marketScopeRole).toBe('viewer');
    expect(res.statusCode).toBe(200);
  });

  test('réutilise authorizedMarketScopes déjà attaché — pas de 2e DB', async () => {
    const { req, res, next } = mockReqRes('user-1');
    req.authorizedMarketScopes = new Map([['market-a', 'viewer']]);
    req.authorizedMarkets = new Set(['market-a']);
    await requireMarketScope(() => 'market-a')(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(mockDbQuery).not.toHaveBeenCalled();
  });

  test('ignore totalement req.body.market_id', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ market_id: 'market-a', role: 'viewer' }] });
    const { req, res, next } = mockReqRes('user-1', { body: { market_id: 'market-b' } });
    await requireMarketScope(() => 'market-a')(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('propage une erreur DB à next(err)', async () => {
    const dbError = new Error('pool exhausted');
    mockDbQuery.mockRejectedValueOnce(dbError);
    const { req, res, next } = mockReqRes('user-1');
    await requireMarketScope(() => 'market-a')(req, res, next);
    expect(next).toHaveBeenCalledWith(dbError);
  });
});

describe('requireMarketScopeRole', () => {
  test('viewer peut lire quand viewer et manager sont admis', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ market_id: 'market-a', role: 'viewer' }] });
    const { req, res, next } = mockReqRes('user-1');
    await requireMarketScopeRole(() => 'market-a', ['viewer', 'manager'])(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.marketScopeRole).toBe('viewer');
  });

  test('viewer ne peut pas passer une mutation manager', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ market_id: 'market-a', role: 'viewer' }] });
    const { req, res, next } = mockReqRes('user-1');
    await requireMarketScopeRole(() => 'market-a', ['manager'])(req, res, next);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('market_scope_role_denied');
    expect(res.body.market_role).toBe('viewer');
    expect(next).not.toHaveBeenCalled();
  });

  test('manager passe une mutation manager', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ market_id: 'market-a', role: 'manager' }] });
    const { req, res, next } = mockReqRes('user-1');
    await requireMarketScopeRole(() => 'market-a', ['manager'])(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.marketScopeRole).toBe('manager');
  });

  test('rôle demandé hors contrat échoue fort au câblage', () => {
    expect(() => requireMarketScopeRole(() => 'market-a', ['admin'])).toThrow(/Rôle de scope marché invalide/);
  });
});
