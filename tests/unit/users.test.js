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

let app;

function setAuth(user) { mockUser = user; }
const ADMIN = { id: 'admin-1', email: 'admin@komerce.km', role: 'admin', ip: '1.2.3.4' };

beforeEach(() => {
  jest.clearAllMocks();
  bcrypt.hash.mockResolvedValue('hashed-pw');
  bcrypt.compare.mockResolvedValue(true);
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

  it('nominal (admin) → 200 + liste + total', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'u1', full_name: 'Jean', email: 'jean@x.km', role: 'client' }] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });

    const res = await request(app).get('/api/admin/users');
    expect(res.status).toBe(200);
    expect(res.body.users).toHaveLength(1);
    expect(res.body.total).toBe(1);
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

  it('email deja existant → 409', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'existing' }] });
    const res = await request(app).post('/api/admin/users').send({ full_name: 'X', email: 'x@x.km', password: 'Abcdefg1' });
    expect(res.status).toBe(409);
  });

  it('nominal → 201 + utilisateur cree', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [] }) // pas d'email existant
      .mockResolvedValueOnce({ rows: [{ id: 'new-1', full_name: 'X', email: 'x@x.km', phone: null, role: 'client', currency_pref: 'KMF', created_at: '2026-01-01' }] });

    const res = await request(app).post('/api/admin/users').send({ full_name: 'X', email: 'X@X.km', password: 'Abcdefg1' });
    expect(res.status).toBe(201);
    expect(res.body.email).toBe('x@x.km');
    expect(bcrypt.hash).toHaveBeenCalledWith('Abcdefg1', 10);
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

  it('nominal → 200 + user mis a jour', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'u1', full_name: 'Jean', email: 'jean@x.km', role: 'agent_relais' }] });
    const res = await request(app).put('/api/admin/users/u1/role').send({ role: 'agent_relais' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.user.role).toBe('agent_relais');
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
    bcrypt.compare.mockResolvedValueOnce(false); // current_password check fails
    db.query.mockResolvedValueOnce({ rows: [{ id: ADMIN.id, full_name: 'Admin', email: ADMIN.email, password_hash: 'old-hash' }] });
    const res = await request(app).put(`/api/admin/users/${ADMIN.id}/password`).send({ password: 'Newpass1', current_password: 'wrong' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('INVALID_CURRENT_PASSWORD');
  });

  it('nouveau mot de passe identique a l\'ancien → 400 SAME_PASSWORD', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'other-user', full_name: 'X', email: 'x@x.km', password_hash: 'old-hash' }] });
    // bcrypt.compare default mock => true => isSame true (admin resetting someone else's password)
    const res = await request(app).put('/api/admin/users/other-user/password').send({ password: 'Newpass1' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('SAME_PASSWORD');
  });

  it('admin reinitialise le mot de passe d\'un autre utilisateur (nominal) → 200', async () => {
    bcrypt.compare.mockResolvedValueOnce(false); // isSame=false → passe le check
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'other-user', full_name: 'Autre', email: 'autre@x.km', password_hash: 'old-hash' }] })
      .mockResolvedValueOnce({ rows: [] }); // UPDATE
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
      .mockResolvedValueOnce({ rows: [{ count: '3' }] });

    const res = await request(app).delete('/api/admin/users/u1');
    expect(res.status).toBe(200);
    expect(res.body.type).toBe('soft_delete');
  });

  it('utilisateur sans commandes → hard delete, 200', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'u1', full_name: 'Jean', email: 'jean@x.km', role: 'client' }] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValue({ rows: [] }); // cleanup queries + delete final

    const res = await request(app).delete('/api/admin/users/u1');
    expect(res.status).toBe(200);
    expect(res.body.type).toBe('hard_delete');
  });
});
