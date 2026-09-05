'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/users.test.js
 * Couvre routes/admin/users.js
 */

jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

jest.mock('../../db', () => ({ query: jest.fn(), getClient: jest.fn() }));

jest.mock('../../services/market-scope-admin-service', () => ({
  normalizeMarketCode: jest.fn((value) => {
    const code = String(value || '').trim().toUpperCase();
    return /^[A-Z]{2}$/.test(code) ? code : null;
  }),
  normalizeScopeRole: jest.fn((value) => {
    const role = String(value || '').trim().toLowerCase();
    return ['viewer', 'manager'].includes(role) ? role : null;
  }),
  listActiveMarkets: jest.fn(),
  listActiveScopesForUsers: jest.fn(),
  listUserMarketScopeHistory: jest.fn(),
  hasUserMarketScopeHistory: jest.fn(),
  grantOrReplaceMarketScope: jest.fn(),
  revokeMarketScope: jest.fn(),
  revokeAllUserMarketScopes: jest.fn(),
}));

let mockUser = null;
jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => {
    if (!mockUser) return res.status(401).json({ error: 'Non authentifié' });
    req.user = mockUser;
    next();
  },
  requireRole: (roles) => (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Non authentifié' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Accès refusé — rôle requis : ${roles.join(' ou ')}`, your_role: req.user.role });
    }
    next();
  },
}));

const bcrypt = require('bcryptjs');
jest.mock('bcryptjs', () => ({
  hash: jest.fn(async () => 'hashed-pw'),
  compare: jest.fn(async () => true),
}));

const express = require('express');
const request = require('supertest');
const db = require('../../db');
const marketScopes = require('../../services/market-scope-admin-service');

let app;

function setAuth(user) { mockUser = user; }
const ADMIN = { id: 'admin-1', email: 'admin@komerce.km', role: 'admin', ip: '1.2.3.4' };

function makeClient() {
  return {
    query: jest.fn(async (sql, params) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      return db.query(sql, params);
    }),
    release: jest.fn(),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  bcrypt.hash.mockResolvedValue('hashed-pw');
  bcrypt.compare.mockResolvedValue(true);
  marketScopes.listActiveMarkets.mockResolvedValue([]);
  marketScopes.listActiveScopesForUsers.mockResolvedValue([]);
  marketScopes.listUserMarketScopeHistory.mockResolvedValue([]);
  marketScopes.hasUserMarketScopeHistory.mockResolvedValue(false);
  marketScopes.grantOrReplaceMarketScope.mockResolvedValue({ status: 'granted', scope: null });
  marketScopes.revokeMarketScope.mockResolvedValue({ status: 'revoked', revoked: null });
  marketScopes.revokeAllUserMarketScopes.mockResolvedValue([]);
  db.getClient.mockImplementation(async () => makeClient());
  setAuth(ADMIN);
  app = express();
  app.use(express.json());
  jest.isolateModules(() => {
    const router = require('../../routes/admin/users');
    app.use('/api/admin', router);
  });
});

describe('GET /api/admin/users', () => {
  it('sans authentification → 401', async () => {
    setAuth(null);
    const res = await request(app).get('/api/admin/users');
    expect(res.status).toBe(401);
  });

  it('authentifie non-admin → 403', async () => {
    setAuth({ id: 'u1', role: 'client' });
    const res = await request(app).get('/api/admin/users');
    expect(res.status).toBe(403);
  });

  it('nominal (admin) → 200 + liste + total + scopes actifs', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'u1', full_name: 'Jean', email: 'jean@x.km', role: 'market_operator' }] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });
    marketScopes.listActiveScopesForUsers.mockResolvedValueOnce([
      { id: 'g1', user_id: 'u1', market_code: 'CM', market_name: 'Cameroun', scope_role: 'manager' },
    ]);

    const res = await request(app).get('/api/admin/users');
    expect(res.status).toBe(200);
    expect(res.body.users).toHaveLength(1);
    expect(res.body.users[0].market_scopes[0].market_code).toBe('CM');
    expect(res.body.total).toBe(1);
  });

  it('filtre market_operator est reconnu', async () => {
    db.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ count: '0' }] });
    await request(app).get('/api/admin/users?role=market_operator');
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/u\.role = \$/);
    expect(params).toContain('market_operator');
  });

  it('filtre role invalide → ignore silencieusement (pas de clause WHERE additionnelle)', async () => {
    db.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ count: '0' }] });
    await request(app).get('/api/admin/users?role=superadmin');
    const [sql] = db.query.mock.calls[0];
    expect(sql).not.toMatch(/u\.role = \$/);
  });

  it('filtre search → ajoute la clause ILIKE et le param wildcard', async () => {
    db.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ count: '0' }] });
    await request(app).get('/api/admin/users?search=jean');
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/ILIKE/);
    expect(params).toContain('%jean%');
  });
});

describe('GET /api/admin/users/markets', () => {
  it('retourne le référentiel actif utilisable par le provisioning', async () => {
    marketScopes.listActiveMarkets.mockResolvedValueOnce([
      { id: 'm-cm', code: 'CM', name: 'Cameroun', currency: 'XAF' },
    ]);
    const res = await request(app).get('/api/admin/users/markets');
    expect(res.status).toBe(200);
    expect(res.body.markets[0].code).toBe('CM');
  });
});

describe('GET /api/admin/users/:id/market-scopes', () => {
  it('retourne scopes actifs et historique', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'u1', full_name: 'Ibrahim', email: 'i@x.km', role: 'market_operator' }] });
    marketScopes.listUserMarketScopeHistory.mockResolvedValueOnce([
      { id: 'g2', market_code: 'CM', scope_role: 'manager', revoked_at: null },
      { id: 'g1', market_code: 'CM', scope_role: 'viewer', revoked_at: '2026-09-01' },
    ]);
    const res = await request(app).get('/api/admin/users/u1/market-scopes');
    expect(res.status).toBe(200);
    expect(res.body.active).toHaveLength(1);
    expect(res.body.history).toHaveLength(2);
  });
});

describe('POST /api/admin/users', () => {
  it('sans authentification → 401', async () => {
    setAuth(null);
    const res = await request(app).post('/api/admin/users').send({ full_name: 'X', email: 'x@x.km', password: 'Abcdefg1' });
    expect(res.status).toBe(401);
  });

  it('authentifie non-admin → 403', async () => {
    setAuth({ id: 'u1', role: 'agent_relais' });
    const res = await request(app).post('/api/admin/users').send({ full_name: 'X', email: 'x@x.km', password: 'Abcdefg1' });
    expect(res.status).toBe(403);
  });

  it('champs obligatoires manquants → 400', async () => {
    const res = await request(app).post('/api/admin/users').send({ email: 'x@x.km' });
    expect(res.status).toBe(400);
  });

  it('role invalide → 400', async () => {
    const res = await request(app).post('/api/admin/users').send({ full_name: 'X', email: 'x@x.km', password: 'Abcdefg1', role: 'superadmin' });
    expect(res.status).toBe(400);
  });

  it('market_operator sans scope → 400 MARKET_SCOPE_REQUIRED', async () => {
    const res = await request(app).post('/api/admin/users').send({
      full_name: 'Ibrahim', email: 'ibrahim@x.km', password: 'Abcdefg1', role: 'market_operator',
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MARKET_SCOPE_REQUIRED');
  });

  it('market_id est refusé comme autorité client', async () => {
    const res = await request(app).post('/api/admin/users').send({
      full_name: 'Ibrahim', email: 'ibrahim@x.km', password: 'Abcdefg1', role: 'market_operator',
      market_scope: { market_id: 'm-cm', market_code: 'CM', scope_role: 'manager' },
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MARKET_ID_FORBIDDEN');
  });

  it('email deja existant → 409', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'existing' }] });
    const res = await request(app).post('/api/admin/users').send({ full_name: 'X', email: 'x@x.km', password: 'Abcdefg1' });
    expect(res.status).toBe(409);
  });

  it('nominal client → 201 + utilisateur cree', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'new-1', full_name: 'X', email: 'x@x.km', phone: null, role: 'client', currency_pref: 'KMF', created_at: '2026-01-01' }] });

    const res = await request(app).post('/api/admin/users').send({ full_name: 'X', email: 'X@X.km', password: 'Abcdefg1' });
    expect(res.status).toBe(201);
    expect(res.body.email).toBe('x@x.km');
    expect(res.body.market_scopes).toEqual([]);
    expect(bcrypt.hash).toHaveBeenCalledWith('Abcdefg1', 10);
  });

  it('crée atomiquement un market_operator manager CM', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'op-1', full_name: 'Ibrahim', email: 'ibrahim@x.km', role: 'market_operator', currency_pref: 'KMF' }] });
    marketScopes.grantOrReplaceMarketScope.mockResolvedValueOnce({
      status: 'granted',
      scope: { id: 'g1', user_id: 'op-1', market_code: 'CM', scope_role: 'manager' },
    });

    const res = await request(app).post('/api/admin/users').send({
      full_name: 'Ibrahim',
      email: 'IBRAHIM@X.KM',
      password: 'Abcdefg1',
      role: 'market_operator',
      market_scope: { market_code: 'cm', scope_role: 'manager' },
    });

    expect(res.status).toBe(201);
    expect(res.body.role).toBe('market_operator');
    expect(res.body.market_scopes[0]).toMatchObject({ market_code: 'CM', scope_role: 'manager' });
    expect(marketScopes.grantOrReplaceMarketScope).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      userId: 'op-1', marketCode: 'CM', scopeRole: 'manager', grantedBy: ADMIN.id,
    }));
  });

  it('marché inconnu annule le provisioning', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'op-1', full_name: 'Ibrahim', email: 'ibrahim@x.km', role: 'market_operator' }] });
    marketScopes.grantOrReplaceMarketScope.mockResolvedValueOnce({ status: 'market_not_found', scope: null });

    const res = await request(app).post('/api/admin/users').send({
      full_name: 'Ibrahim', email: 'ibrahim@x.km', password: 'Abcdefg1', role: 'market_operator',
      market_scope: { market_code: 'ZZ', scope_role: 'manager' },
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MARKET_NOT_FOUND');
  });
});

describe('PUT /api/admin/users/:id/role', () => {
  it('sans authentification → 401', async () => {
    setAuth(null);
    const res = await request(app).put('/api/admin/users/u1/role').send({ role: 'agent_relais' });
    expect(res.status).toBe(401);
  });

  it('authentifie non-admin → 403', async () => {
    setAuth({ id: 'u1', role: 'client' });
    const res = await request(app).put('/api/admin/users/u1/role').send({ role: 'agent_relais' });
    expect(res.status).toBe(403);
  });

  it('role invalide ou manquant → 400', async () => {
    const res = await request(app).put('/api/admin/users/u1/role').send({ role: 'superadmin' });
    expect(res.status).toBe(400);
  });

  it('admin tente de changer son propre role vers autre chose que admin → 400', async () => {
    const res = await request(app).put(`/api/admin/users/${ADMIN.id}/role`).send({ role: 'client' });
    expect(res.status).toBe(400);
  });

  it('utilisateur introuvable → 404', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).put('/api/admin/users/unknown/role').send({ role: 'agent_relais' });
    expect(res.status).toBe(404);
  });

  it('nominal non-market → 200 et révocation des éventuels scopes actifs', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'u1', full_name: 'Jean', email: 'jean@x.km', role: 'market_operator' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'u1', full_name: 'Jean', email: 'jean@x.km', role: 'agent_relais' }] });
    const res = await request(app).put('/api/admin/users/u1/role').send({ role: 'agent_relais' });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('agent_relais');
    expect(marketScopes.revokeAllUserMarketScopes).toHaveBeenCalledWith(expect.anything(), {
      userId: 'u1', revokedBy: ADMIN.id,
    });
  });

  it('promotion market_operator exige un scope', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'u1', full_name: 'Jean', email: 'jean@x.km', role: 'client' }] });
    const res = await request(app).put('/api/admin/users/u1/role').send({ role: 'market_operator' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MARKET_SCOPE_REQUIRED');
  });

  it('promotion market_operator + manager CM est atomique', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'u1', full_name: 'Jean', email: 'jean@x.km', role: 'client' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'u1', full_name: 'Jean', email: 'jean@x.km', role: 'market_operator' }] });
    marketScopes.grantOrReplaceMarketScope.mockResolvedValueOnce({
      status: 'granted', scope: { id: 'g1', market_code: 'CM', scope_role: 'manager' },
    });

    const res = await request(app).put('/api/admin/users/u1/role').send({
      role: 'market_operator', market_scope: { market_code: 'CM', scope_role: 'manager' },
    });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('market_operator');
    expect(res.body.market_scope.scope_role).toBe('manager');
  });
});

describe('POST /api/admin/users/:id/market-scopes', () => {
  it('refuse un utilisateur qui n’est pas market_operator', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'u1', role: 'client' }] });
    const res = await request(app).post('/api/admin/users/u1/market-scopes').send({
      market_code: 'CM', scope_role: 'viewer',
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('NOT_MARKET_OPERATOR');
  });

  it('ajoute ou change un scope avec historique géré par la boundary market', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'u1', role: 'market_operator' }] });
    marketScopes.grantOrReplaceMarketScope.mockResolvedValueOnce({
      status: 'replaced', scope: { id: 'g2', market_code: 'CM', scope_role: 'manager' },
    });
    const res = await request(app).post('/api/admin/users/u1/market-scopes').send({
      market_code: 'CM', scope_role: 'manager',
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('replaced');
    expect(res.body.scope.scope_role).toBe('manager');
  });
});

describe('DELETE /api/admin/users/:id/market-scopes/:marketCode', () => {
  it('révoque le scope sans supprimer son historique', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'u1', role: 'market_operator' }] });
    marketScopes.revokeMarketScope.mockResolvedValueOnce({
      status: 'revoked', revoked: { id: 'g1', market_code: 'CM', scope_role: 'manager' },
    });
    const res = await request(app).delete('/api/admin/users/u1/market-scopes/cm');
    expect(res.status).toBe(200);
    expect(res.body.revoked.market_code).toBe('CM');
  });
});

describe('PUT /api/admin/users/:id/password', () => {
  it('sans authentification → 401', async () => {
    setAuth(null);
    const res = await request(app).put('/api/admin/users/u1/password').send({ password: 'Abcdefg1' });
    expect(res.status).toBe(401);
  });

  it('mot de passe trop court → 400 WEAK_PASSWORD', async () => {
    const res = await request(app).put('/api/admin/users/u1/password').send({ password: 'short1A' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('WEAK_PASSWORD');
  });

  it('mot de passe sans majuscule/chiffre → 400 WEAK_PASSWORD', async () => {
    const res = await request(app).put('/api/admin/users/u1/password').send({ password: 'alllowercase' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('WEAK_PASSWORD');
  });

  it('utilisateur introuvable → 404', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).put('/api/admin/users/unknown/password').send({ password: 'Abcdefg1' });
    expect(res.status).toBe(404);
  });

  it('admin change son propre mot de passe sans current_password → 400 CURRENT_PASSWORD_REQUIRED', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: ADMIN.id, full_name: 'Admin', email: ADMIN.email, password_hash: 'old-hash' }] });
    const res = await request(app).put(`/api/admin/users/${ADMIN.id}/password`).send({ password: 'Newpass1' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('CURRENT_PASSWORD_REQUIRED');
  });

  it('admin change son propre mot de passe avec current_password incorrect → 403 INVALID_CURRENT_PASSWORD', async () => {
    bcrypt.compare.mockResolvedValueOnce(false);
    db.query.mockResolvedValueOnce({ rows: [{ id: ADMIN.id, full_name: 'Admin', email: ADMIN.email, password_hash: 'old-hash' }] });
    const res = await request(app).put(`/api/admin/users/${ADMIN.id}/password`).send({ password: 'Newpass1', current_password: 'wrong' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('INVALID_CURRENT_PASSWORD');
  });

  it('nouveau mot de passe identique a l’ancien → 400 SAME_PASSWORD', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'other-user', full_name: 'X', email: 'x@x.km', password_hash: 'old-hash' }] });
    const res = await request(app).put('/api/admin/users/other-user/password').send({ password: 'Newpass1' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('SAME_PASSWORD');
  });

  it('admin reinitialise le mot de passe d’un autre utilisateur (nominal) → 200', async () => {
    bcrypt.compare.mockResolvedValueOnce(false);
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'other-user', full_name: 'Autre', email: 'autre@x.km', password_hash: 'old-hash' }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app).put('/api/admin/users/other-user/password').send({ password: 'Newpass1' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(bcrypt.hash).toHaveBeenCalledWith('Newpass1', 12);
  });
});

describe('DELETE /api/admin/users/:id', () => {
  it('sans authentification → 401', async () => {
    setAuth(null);
    const res = await request(app).delete('/api/admin/users/u1');
    expect(res.status).toBe(401);
  });

  it('admin tente de supprimer son propre compte → 400', async () => {
    const res = await request(app).delete(`/api/admin/users/${ADMIN.id}`);
    expect(res.status).toBe(400);
  });

  it('utilisateur introuvable → 404', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).delete('/api/admin/users/unknown');
    expect(res.status).toBe(404);
  });

  it('utilisateur avec commandes → soft delete (anonymisation), 200', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'u1', full_name: 'Jean', email: 'jean@x.km', role: 'client' }] })
      .mockResolvedValueOnce({ rows: [{ count: '3' }] })
      .mockResolvedValue({ rows: [] });

    const res = await request(app).delete('/api/admin/users/u1');
    expect(res.status).toBe(200);
    expect(res.body.type).toBe('soft_delete');
  });

  it('historique de scope → soft delete même sans commande, pour préserver l’audit', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'u1', full_name: 'Ibrahim', email: 'i@x.km', role: 'market_operator' }] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValue({ rows: [] });
    marketScopes.hasUserMarketScopeHistory.mockResolvedValueOnce(true);

    const res = await request(app).delete('/api/admin/users/u1');
    expect(res.status).toBe(200);
    expect(res.body.type).toBe('soft_delete');
    expect(res.body.message).toMatch(/historique de droits marché/);
    expect(marketScopes.revokeAllUserMarketScopes).toHaveBeenCalled();
  });

  it('utilisateur sans commandes ni historique de scope → hard delete, 200', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'u1', full_name: 'Jean', email: 'jean@x.km', role: 'client' }] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValue({ rows: [] });

    const res = await request(app).delete('/api/admin/users/u1');
    expect(res.status).toBe(200);
    expect(res.body.type).toBe('hard_delete');
  });
});
