'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/carriers.test.js
 *
 * Tests du router routes/carriers.js
 *
 * Couverture :
 *   ✓ GET / : accessible admin + agent_hub, filtre is_active=TRUE
 *   ✓ POST / : 400 si le nom est manquant/vide (espace inclus)
 *   ✓ POST / : trim du nom, defaults (type='maritime'), 201
 *   ✓ POST / : réservé admin (403 pour agent_hub)
 *   ✓ PATCH /:id : 400 si aucun champ à mettre à jour
 *   ✓ PATCH /:id : seuls les champs de l'allowlist sont écrits dans le SET
 *   ✓ PATCH /:id : 404 si transporteur introuvable
 *   ✓ DELETE /:id : soft-delete (is_active=FALSE), 404 si introuvable
 *   ✓ PATCH /customs/:parcel_id : 404 si colis introuvable (avant toute écriture)
 *   ✓ PATCH /customs/:parcel_id : 400 si aucun champ douane fourni
 *   ✓ PATCH /customs/:parcel_id : met à jour uniquement les champs douane fournis
 */

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => { req.user = req.user || { id: 'admin-1', role: 'admin' }; next(); },
  requireRole: (roles) => (req, res, next) => {
    if (!roles.includes(req.user?.role)) return res.status(403).json({ error: 'Accès refusé' });
    next();
  },
}));

const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));

const express = require('express');
const request = require('supertest');

let app;
let currentUser;

beforeEach(() => {
  jest.clearAllMocks();
  currentUser = { id: 'admin-1', role: 'admin' };

  app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = currentUser; next(); });

  jest.isolateModules(() => {
    const router = require('../../routes/carriers');
    app.use('/api/carriers', router);
  });
});

describe('carriers — GET /', () => {
  it('accessible à agent_hub, filtre is_active=TRUE', async () => {
    currentUser = { id: 'hub-1', role: 'agent_hub' };
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'c1', name: 'CMA CGM' }] });

    const res = await request(app).get('/api/carriers');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [{ id: 'c1', name: 'CMA CGM' }], count: 1 });
    expect(mockQuery.mock.calls[0][0]).toMatch(/WHERE is_active = TRUE/);
  });

  it('erreur DB → transmise au middleware d\'erreur (500)', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'));
    app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

    const res = await request(app).get('/api/carriers');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('db down');
  });
});

describe('carriers — POST /', () => {
  it('réservé admin (403 pour agent_hub)', async () => {
    currentUser = { id: 'hub-1', role: 'agent_hub' };
    const res = await request(app).post('/api/carriers').send({ name: 'X' });
    expect(res.status).toBe(403);
  });

  it('400 si le nom est manquant', async () => {
    const res = await request(app).post('/api/carriers').send({});
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('400 si le nom est uniquement des espaces', async () => {
    const res = await request(app).post('/api/carriers').send({ name: '   ' });
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('trim le nom et applique le type par défaut "maritime"', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'c1', name: 'CMA CGM', type: 'maritime' }] });

    const res = await request(app).post('/api/carriers').send({ name: '  CMA CGM  ' });

    expect(res.status).toBe(201);
    const params = mockQuery.mock.calls[0][1];
    expect(params[0]).toBe('CMA CGM');
    expect(params[1]).toBe('maritime');
  });

  it('erreur DB → transmise au middleware d\'erreur (500)', async () => {
    mockQuery.mockRejectedValueOnce(new Error('insert failed'));
    app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

    const res = await request(app).post('/api/carriers').send({ name: 'CMA CGM' });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('insert failed');
  });
});

describe('carriers — PATCH /:id', () => {
  it('400 si aucun champ à mettre à jour', async () => {
    const res = await request(app).patch('/api/carriers/c1').send({});
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('ignore les champs hors allowlist (ex: id, created_at)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'c1', name: 'Nouveau nom' }] });

    const res = await request(app)
      .patch('/api/carriers/c1')
      .send({ name: 'Nouveau nom', id: 'hacked-id', created_at: '2020-01-01' });

    expect(res.status).toBe(200);
    const updateSql = mockQuery.mock.calls[0][0];
    expect(updateSql).toMatch(/name = \$1/);
    expect(updateSql).not.toMatch(/created_at = \$/);
  });

  it('404 si le transporteur est introuvable', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).patch('/api/carriers/c-404').send({ name: 'X' });
    expect(res.status).toBe(404);
  });

  it('erreur DB → transmise au middleware d\'erreur (500)', async () => {
    mockQuery.mockRejectedValueOnce(new Error('update failed'));
    app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

    const res = await request(app).patch('/api/carriers/c1').send({ name: 'X' });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('update failed');
  });
});

describe('carriers — DELETE /:id', () => {
  it('soft-delete : is_active=FALSE', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'c1', name: 'CMA CGM' }] });

    const res = await request(app).delete('/api/carriers/c1');

    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[0][0]).toMatch(/SET is_active = FALSE/);
    expect(res.body.message).toMatch(/désactivé/);
  });

  it('404 si introuvable', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).delete('/api/carriers/c-404');
    expect(res.status).toBe(404);
  });

  it('erreur DB → transmise au middleware d\'erreur (500)', async () => {
    mockQuery.mockRejectedValueOnce(new Error('delete failed'));
    app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

    const res = await request(app).delete('/api/carriers/c1');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('delete failed');
  });
});

describe('carriers — PATCH /customs/:parcel_id', () => {
  it('404 si le colis est introuvable, avant toute écriture', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .patch('/api/carriers/customs/p-404')
      .send({ customs_hs_code: '1234.56' });

    expect(res.status).toBe(404);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('400 si aucun champ douane fourni', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'p1', reference: 'KOM-P-1' }] });

    const res = await request(app).patch('/api/carriers/customs/p1').send({});

    expect(res.status).toBe(400);
    expect(mockQuery).toHaveBeenCalledTimes(1); // pas d'UPDATE déclenché
  });

  it('met à jour uniquement les champs douane fournis', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'p1', reference: 'KOM-P-1' }] }) // SELECT check
      .mockResolvedValueOnce({ rows: [{ id: 'p1', customs_hs_code: '1234.56' }] }); // UPDATE

    const res = await request(app)
      .patch('/api/carriers/customs/p1')
      .send({ customs_hs_code: '1234.56' });

    expect(res.status).toBe(200);
    const updateSql = mockQuery.mock.calls[1][0];
    expect(updateSql).toMatch(/customs_hs_code = \$1/);
    expect(updateSql).not.toMatch(/customs_value_kmf/);
    expect(res.body.message).toMatch(/KOM-P-1/);
  });

  it('accepte tous les champs douane simultanément (value, weight, hs_code, cleared_at, notes)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'p1', reference: 'KOM-P-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'p1' }] });

    const res = await request(app)
      .patch('/api/carriers/customs/p1')
      .send({
        customs_value_kmf: 10000,
        customs_weight_kg: 5.5,
        customs_hs_code: '1234.56',
        customs_cleared_at: '2026-07-01',
        customs_notes: 'RAS',
      });

    expect(res.status).toBe(200);
    const updateSql = mockQuery.mock.calls[1][0];
    const values = mockQuery.mock.calls[1][1];
    expect(updateSql).toMatch(/customs_value_kmf = \$1/);
    expect(updateSql).toMatch(/customs_weight_kg = \$2/);
    expect(updateSql).toMatch(/customs_hs_code = \$3/);
    expect(updateSql).toMatch(/customs_cleared_at = \$4/);
    expect(updateSql).toMatch(/customs_notes = \$5/);
    expect(values).toEqual([10000, 5.5, '1234.56', '2026-07-01', 'RAS', 'p1']);
  });

  it('erreur DB → transmise au middleware d\'erreur (500)', async () => {
    mockQuery.mockRejectedValueOnce(new Error('parcel lookup failed'));
    app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

    const res = await request(app)
      .patch('/api/carriers/customs/p1')
      .send({ customs_hs_code: '1234.56' });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('parcel lookup failed');
  });
});
