'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/auth-route.test.js
 *
 * Tests du router routes/auth.js (Lot B1 — Auth/identité).
 *
 * Couverture :
 *   POST /register      : validations (phone, password), email/phone déjà
 *                          utilisés → 409, succès → cookie + 201, erreur DB → next
 *   POST /login          : password manquant, email/phone manquant, user
 *                          introuvable, sans password_hash, password invalide,
 *                          succès (email / phone)
 *   GET  /me              : succès, 404 si introuvable, erreur → next
 *   PUT  /me              : succès
 *   POST /guest-checkout  : 410 (route retirée)
 *   POST /auto-register   : 503 sans clé interne configurée, 401 clé absente/
 *                          invalide, 400 sans phone, réutilise compte existant,
 *                          crée un nouveau compte
 *   POST /orders-by-phone : 400 téléphone invalide, rate-limit → 429,
 *                          aucun user → liste vide, succès → token
 *   POST /logout          : sans token → cookie cleared, avec token décodable
 *                          → INSERT revoked_tokens, erreur DB non-fatale
 *   POST /admin-reset     : 503 sans clé configurée, 503 clé trop faible,
 *                          403 en production sans ALLOW_ADMIN_RESET, 403 clé
 *                          invalide, 400 password trop court, succès (update),
 *                          succès (insert si aucune ligne mise à jour)
 */

// middleware/auth.js / routes/auth.js capturent JWT_SECRET au chargement du
// module → il faut le fixer AVANT le premier require.
process.env.JWT_SECRET = 'test-secret-stable-32-characters-minimum';

jest.mock('../../db', () => ({ query: jest.fn() }));

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = req.user || { id: 'user-1' }; next(); },
}));

jest.mock('../../middleware/validate', () => ({
  validate: () => (req, _res, next) => next(),
}));

jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

// Lot 5 — /me/pickup-authorization délègue à pickup-authorization-service,
// qui écrit dans `alerts` via createAlert(). Mocké ici pour ne pas dépendre
// du schéma réel de la table dans ces tests de routeur.
const mockCreateAlert = jest.fn(() => Promise.resolve());
jest.mock('../../utils/alerts', () => ({
  createAlert: (...args) => mockCreateAlert(...args),
}));

const bcrypt = require('bcryptjs');
jest.mock('bcryptjs', () => ({
  hash: jest.fn(async () => 'hashed-pw'),
  compare: jest.fn(async () => true),
}));

const express = require('express');
const request = require('supertest');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const db = require('../../db');

let app;

function buildApp() {
  const a = express();
  a.use(express.json());
  a.use(cookieParser());
  jest.isolateModules(() => {
    const router = require('../../routes/auth');
    a.use('/api/auth', router);
  });
  a.use((err, req, res, _next) => res.status(500).json({ error: err.message }));
  return a;
}

beforeEach(() => {
  jest.clearAllMocks();
  bcrypt.hash.mockResolvedValue('hashed-pw');
  bcrypt.compare.mockResolvedValue(true);
  delete process.env.INTERNAL_API_KEY;
  delete process.env.ADMIN_RESET_KEY;
  delete process.env.ALLOW_ADMIN_RESET;
  process.env.NODE_ENV = 'test';
  app = buildApp();
});

// ═══════════════════════════════════════════════════════════════════════
describe('POST /api/auth/register', () => {
  it('400 si téléphone manquant', async () => {
    const res = await request(app).post('/api/auth/register').send({ password: 'azertyui' });
    expect(res.status).toBe(400);
  });

  it('400 si password < 6 caractères', async () => {
    const res = await request(app).post('/api/auth/register').send({ phone: '+269111', password: '123' });
    expect(res.status).toBe(400);
  });

  it('409 si email déjà utilisé', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'u1' }] }); // SELECT email
    const res = await request(app).post('/api/auth/register').send({
      phone: '+269111', password: 'azertyui', email: 'a@a.com',
    });
    expect(res.status).toBe(409);
  });

  it('409 si téléphone déjà utilisé', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [] })       // SELECT email (absent)
      .mockResolvedValueOnce({ rows: [{ id: 'u1' }] }); // SELECT phone
    const res = await request(app).post('/api/auth/register').send({
      phone: '+269111', password: 'azertyui', email: 'a@a.com',
    });
    expect(res.status).toBe(409);
  });

  it('succès → 201 + cookie kmrc_jwt', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [] }) // email check
      .mockResolvedValueOnce({ rows: [] }) // phone check
      .mockResolvedValueOnce({ rows: [{ id: 'u1', full_name: 'Ali', phone: '+269111', password_hash: 'x', role: 'client' }] });

    const res = await request(app).post('/api/auth/register').send({
      phone: '+269111', password: 'azertyui', email: 'a@a.com', full_name: 'Ali',
    });
    expect(res.status).toBe(201);
    expect(res.body.user.password_hash).toBeUndefined();
    expect(res.headers['set-cookie'][0]).toMatch(/kmrc_jwt=/);
  });

  it('erreur DB inattendue → next(err) → 500', async () => {
    db.query.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).post('/api/auth/register').send({
      phone: '+269111', password: 'azertyui', email: 'a@a.com',
    });
    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('POST /api/auth/login', () => {
  it('400 si password manquant', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'a@a.com' });
    expect(res.status).toBe(400);
  });

  it('400 si ni email ni phone', async () => {
    const res = await request(app).post('/api/auth/login').send({ password: 'azertyui' });
    expect(res.status).toBe(400);
  });

  it('401 si utilisateur introuvable (email)', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/api/auth/login').send({ email: 'a@a.com', password: 'azertyui' });
    expect(res.status).toBe(401);
  });

  it('401 si pas de password_hash (compte social/léger)', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'u1', password_hash: null }] });
    const res = await request(app).post('/api/auth/login').send({ email: 'a@a.com', password: 'azertyui' });
    expect(res.status).toBe(401);
  });

  it('401 si password invalide', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'u1', password_hash: 'x' }] });
    bcrypt.compare.mockResolvedValueOnce(false);
    const res = await request(app).post('/api/auth/login').send({ email: 'a@a.com', password: 'wrong' });
    expect(res.status).toBe(401);
  });

  it('succès via email → cookie + user', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'u1', full_name: 'Ali', password_hash: 'x', role: 'client' }] });
    const res = await request(app).post('/api/auth/login').send({ email: 'a@a.com', password: 'azertyui' });
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe('u1');
  });

  it('succès via phone', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'u1', password_hash: 'x', role: 'client' }] });
    const res = await request(app).post('/api/auth/login').send({ phone: '+269111', password: 'azertyui' });
    expect(res.status).toBe(200);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('WHERE phone'), ['+269111']);
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('GET /api/auth/me', () => {
  it('succès', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'user-1', full_name: 'Ali' }] });
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('user-1');
  });

  it('404 si introuvable', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(404);
  });

  it('erreur DB → next(err) → 500', async () => {
    db.query.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('PUT /api/auth/me', () => {
  it('succès', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'user-1', full_name: 'Nouveau nom' }] });
    const res = await request(app).put('/api/auth/me').send({ full_name: 'Nouveau nom' });
    expect(res.status).toBe(200);
    expect(res.body.full_name).toBe('Nouveau nom');
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('GET /api/auth/me/pickup-authorization', () => {
  it('NONE si aucune autorisation', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/auth/me/pickup-authorization');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'NONE' });
  });

  it('ACTIVE avec les champs du propriétaire authentifié', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{
        is_active: true,
        authorized_given_names: 'Fatima',
        authorized_family_name: 'Said',
        version: 1,
        updated_at: '2026-07-01T00:00:00Z',
      }],
    });
    const res = await request(app).get('/api/auth/me/pickup-authorization');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'ACTIVE',
      given_names: 'Fatima',
      family_name: 'Said',
      version: 1,
      updated_at: '2026-07-01T00:00:00Z',
    });
  });

  it('erreur DB → next(err) → 500', async () => {
    db.query.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).get('/api/auth/me/pickup-authorization');
    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('PUT /api/auth/me/pickup-authorization', () => {
  it('création → 200, ACTIVE, audit émis', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ version: 1, updated_at: 't1' }] });
    const res = await request(app)
      .put('/api/auth/me/pickup-authorization')
      .send({ given_names: 'Fatima', family_name: 'Said' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'ACTIVE', given_names: 'Fatima', family_name: 'Said', version: 1, updated_at: 't1',
    });
    expect(mockCreateAlert).toHaveBeenCalled();
  });

  it('400 si given_names manquant (validation défensive du service)', async () => {
    // `validate` est mocké no-op dans ce fichier — la garde du service
    // (pickup-authorization-service._validateNamePair) doit rattraper.
    const res = await request(app)
      .put('/api/auth/me/pickup-authorization')
      .send({ given_names: '', family_name: 'Said' });
    expect(res.status).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('erreur DB → next(err) → 500', async () => {
    db.query.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app)
      .put('/api/auth/me/pickup-authorization')
      .send({ given_names: 'Fatima', family_name: 'Said' });
    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('DELETE /api/auth/me/pickup-authorization', () => {
  it('supprime et audite quand une autorisation existait', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ version: 2 }] });
    const res = await request(app).delete('/api/auth/me/pickup-authorization');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'NONE' });
    expect(mockCreateAlert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      type: 'PICKUP_AUTHORIZATION_REVOKED',
      entityId: 'user-1',
    }));
  });

  it('idempotent : aucune autorisation existante → 200 NONE sans erreur', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).delete('/api/auth/me/pickup-authorization');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'NONE' });
  });

  it('erreur DB → next(err) → 500', async () => {
    db.query.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).delete('/api/auth/me/pickup-authorization');
    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('POST /api/auth/guest-checkout', () => {
  it('410 — route retirée', async () => {
    const res = await request(app).post('/api/auth/guest-checkout').send();
    expect(res.status).toBe(410);
    expect(res.body.code).toBe('guest_checkout_removed');
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('POST /api/auth/auto-register', () => {
  it('503 si INTERNAL_API_KEY non configurée', async () => {
    const res = await request(app).post('/api/auth/auto-register').send({ phone: '+269111' });
    expect(res.status).toBe(503);
  });

  it('401 si clé interne absente', async () => {
    process.env.INTERNAL_API_KEY = 'secret-key';
    app = buildApp();
    const res = await request(app).post('/api/auth/auto-register').send({ phone: '+269111' });
    expect(res.status).toBe(401);
  });

  it('401 si clé interne invalide', async () => {
    process.env.INTERNAL_API_KEY = 'secret-key';
    app = buildApp();
    const res = await request(app).post('/api/auth/auto-register')
      .set('x-internal-key', 'wrong-key').send({ phone: '+269111' });
    expect(res.status).toBe(401);
  });

  it('400 si phone manquant', async () => {
    process.env.INTERNAL_API_KEY = 'secret-key';
    app = buildApp();
    const res = await request(app).post('/api/auth/auto-register')
      .set('x-internal-key', 'secret-key').send({});
    expect(res.status).toBe(400);
  });

  it('réutilise un compte existant → created: false', async () => {
    process.env.INTERNAL_API_KEY = 'secret-key';
    app = buildApp();
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'u1' }] }) // existing lookup
      .mockResolvedValueOnce({ rows: [{ id: 'u1', full_name: 'Ali', password_hash: 'x', role: 'client' }] });

    const res = await request(app).post('/api/auth/auto-register')
      .set('x-internal-key', 'secret-key').send({ phone: '+269111' });
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(false);
  });

  it('crée un nouveau compte → created: true', async () => {
    process.env.INTERNAL_API_KEY = 'secret-key';
    app = buildApp();
    db.query
      .mockResolvedValueOnce({ rows: [] }) // existing lookup → aucun
      .mockResolvedValueOnce({ rows: [{ id: 'u2', full_name: 'Client Komerce', password_hash: 'x', role: 'client' }] });

    const res = await request(app).post('/api/auth/auto-register')
      .set('x-internal-key', 'secret-key').send({ phone: '+269222' });
    expect(res.status).toBe(201);
    expect(res.body.created).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('POST /api/auth/orders-by-phone', () => {
  it('400 si numéro invalide (trop court)', async () => {
    const res = await request(app).post('/api/auth/orders-by-phone').send({ phone: '123' });
    expect(res.status).toBe(400);
  });

  it('429 si trop de tentatives (rate-limit IP)', async () => {
    for (let i = 0; i < 5; i++) {
      db.query.mockResolvedValueOnce({ rows: [] });
      await request(app).post('/api/auth/orders-by-phone').send({ phone: '+269111111' });
    }
    const res = await request(app).post('/api/auth/orders-by-phone').send({ phone: '+269111111' });
    expect(res.status).toBe(429);
  });

  it('succès → aucun user trouvé → liste vide', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/api/auth/orders-by-phone').send({ phone: '+269999999' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ orders: [], name: null });
  });

  it('succès → user trouvé → token scope orders_read', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'u1', full_name: 'Ali', role: 'client' }] });
    const res = await request(app).post('/api/auth/orders-by-phone').send({ phone: '+269888888' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Ali');
    const decoded = jwt.verify(res.body.token, process.env.JWT_SECRET);
    expect(decoded.scope).toBe('orders_read');
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('POST /api/auth/logout', () => {
  it('sans token → cookie supprimé, pas d\'appel DB', async () => {
    const res = await request(app).post('/api/auth/logout').send();
    expect(res.status).toBe(200);
    expect(db.query).not.toHaveBeenCalled();
    expect(res.headers['set-cookie'][0]).toMatch(/kmrc_jwt=;/);
  });

  it('avec cookie token décodable → INSERT revoked_tokens', async () => {
    const token = jwt.sign({ id: 'u1', role: 'client', jti: 'jti-123' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    db.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/api/auth/logout').set('Cookie', [`kmrc_jwt=${token}`]).send();
    expect(res.status).toBe(200);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('revoked_tokens'), ['jti-123', expect.any(Number)]);
  });

  it('avec Bearer token décodable → INSERT revoked_tokens', async () => {
    const token = jwt.sign({ id: 'u1', role: 'client', jti: 'jti-456' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    db.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${token}`).send();
    expect(res.status).toBe(200);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('revoked_tokens'), ['jti-456', expect.any(Number)]);
  });

  it('échec DB non-fatal → cookie quand même supprimé', async () => {
    const token = jwt.sign({ id: 'u1', role: 'client', jti: 'jti-789' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    db.query.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).post('/api/auth/logout').set('Cookie', [`kmrc_jwt=${token}`]).send();
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie'][0]).toMatch(/kmrc_jwt=;/);
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('POST /api/auth/admin-reset', () => {
  it('503 si ADMIN_RESET_KEY non configurée', async () => {
    const res = await request(app).post('/api/auth/admin-reset').send({ key: 'x', new_password: 'azertyuiopaz' });
    expect(res.status).toBe(503);
  });

  it('503 si clé trop faible (< 32 chars)', async () => {
    process.env.ADMIN_RESET_KEY = 'too-short';
    app = buildApp();
    const res = await request(app).post('/api/auth/admin-reset').send({ key: 'too-short', new_password: 'azertyuiopaz' });
    expect(res.status).toBe(503);
  });

  it('403 en production sans ALLOW_ADMIN_RESET=true', async () => {
    process.env.ADMIN_RESET_KEY = 'a'.repeat(32);
    process.env.NODE_ENV = 'production';
    app = buildApp();
    const res = await request(app).post('/api/auth/admin-reset').send({ key: 'a'.repeat(32), new_password: 'azertyuiopaz' });
    expect(res.status).toBe(403);
  });

  it('403 si clé fournie invalide', async () => {
    process.env.ADMIN_RESET_KEY = 'a'.repeat(32);
    app = buildApp();
    const res = await request(app).post('/api/auth/admin-reset').send({ key: 'wrong-key-totally-different-len', new_password: 'azertyuiopaz' });
    expect(res.status).toBe(403);
  });

  it('400 si nouveau mot de passe trop court', async () => {
    process.env.ADMIN_RESET_KEY = 'a'.repeat(32);
    app = buildApp();
    const res = await request(app).post('/api/auth/admin-reset').send({ key: 'a'.repeat(32), new_password: 'short' });
    expect(res.status).toBe(400);
  });

  it('succès → UPDATE existant', async () => {
    process.env.ADMIN_RESET_KEY = 'a'.repeat(32);
    app = buildApp();
    db.query.mockResolvedValueOnce({ rowCount: 1 });
    const res = await request(app).post('/api/auth/admin-reset').send({ key: 'a'.repeat(32), new_password: 'azertyuiopaz' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('succès → INSERT si aucune ligne admin existante', async () => {
    process.env.ADMIN_RESET_KEY = 'a'.repeat(32);
    app = buildApp();
    db.query
      .mockResolvedValueOnce({ rowCount: 0 })  // UPDATE → 0 ligne
      .mockResolvedValueOnce({ rows: [] });     // INSERT ... ON CONFLICT
    const res = await request(app).post('/api/auth/admin-reset').send({ key: 'a'.repeat(32), new_password: 'azertyuiopaz' });
    expect(res.status).toBe(200);
    expect(db.query).toHaveBeenCalledTimes(2);
  });
});
