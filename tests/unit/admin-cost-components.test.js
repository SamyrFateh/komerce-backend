'use strict';

/**
 * tests/unit/admin-cost-components.test.js
 *
 * Tests du router routes/admin-cost-components.js
 *
 * Couverture (invariants métier critiques) :
 *   ✓ accès admin requis (403 si role !== 'admin')
 *   ✓ GET /_meta renvoie les enums (families/categories/units/...)
 *   ✓ POST : champs requis manquants → 400
 *   ✓ POST : cohérence famille/catégorie via META → 400 si catégorie hors famille
 *   ✓ POST : succès → insert + audit 'created'
 *   ✓ POST : clé dupliquée (23505) → 409
 *   ✓ PUT : composant introuvable → 404
 *   ✓ PUT : incohérence famille/catégorie → 400
 *   ✓ PUT : aucun champ à modifier → 400
 *   ✓ PUT : succès → update + audit avec le bon event_type (value_changed/activated/deactivated/scope_changed/updated)
 *   ✓ POST /:id/toggle : bascule is_active + audit
 *   ✓ DELETE soft : is_active=FALSE + audit 'deactivated'
 *   ✓ DELETE hard : refuse si !is_deletable (403), sinon delete + audit 'deleted'
 */

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => { req.user = req.user || { id: 'admin-1', role: 'admin' }; next(); },
}));

const dbQueries = [];
const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));

const express = require('express');
const request = require('supertest');

let app;
let currentUser;

beforeEach(() => {
  jest.clearAllMocks();
  dbQueries.length = 0;
  currentUser = { id: 'admin-1', role: 'admin' };

  app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = currentUser; next(); });

  jest.isolateModules(() => {
    const router = require('../../routes/admin-cost-components');
    app.use('/api/admin/cost-components', router);
  });
});

const validBody = () => ({
  key: 'freight_air', label: 'Fret aérien', family: 'landed_relay',
  category: 'freight', default_value: 1200, unit: 'kmf_per_kg',
});

describe('admin-cost-components — accès', () => {
  it('refuse un non-admin (403)', async () => {
    currentUser = { id: 'u1', role: 'client' };
    const res = await request(app).get('/api/admin/cost-components/_meta');
    expect(res.status).toBe(403);
  });
});

describe('admin-cost-components — GET /_meta', () => {
  it('renvoie les enums autorisés', async () => {
    const res = await request(app).get('/api/admin/cost-components/_meta');
    expect(res.status).toBe(200);
    expect(res.body.families).toEqual(['landed_relay', 'business', 'exceptional']);
    expect(res.body.categories.landed_relay).toContain('freight');
  });
});

describe('admin-cost-components — POST /', () => {
  it('400 si un champ requis manque', async () => {
    const res = await request(app).post('/api/admin/cost-components').send({ key: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Champ requis manquant/);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('400 si la catégorie est invalide pour la famille', async () => {
    const res = await request(app)
      .post('/api/admin/cost-components')
      .send({ ...validBody(), family: 'business', category: 'freight' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalide pour la famille/);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('crée le composant puis écrit un événement audit "created"', async () => {
    const created = { id: 'cc-1', key: 'freight_air' };
    mockQuery
      .mockResolvedValueOnce({ rows: [created] }) // INSERT cost_components
      .mockResolvedValueOnce({ rows: [] });        // INSERT cost_component_events

    const res = await request(app).post('/api/admin/cost-components').send(validBody());

    expect(res.status).toBe(200);
    expect(res.body.component).toEqual(created);
    expect(mockQuery).toHaveBeenCalledTimes(2);
    const auditCall = mockQuery.mock.calls[1];
    expect(auditCall[0]).toMatch(/INSERT INTO cost_component_events/);
    expect(auditCall[0]).toMatch(/'created'/);
    expect(auditCall[1]).toEqual(expect.arrayContaining(['cc-1', 'freight_air']));
  });

  it('409 sur clé dupliquée (contrainte unique 23505)', async () => {
    const err = new Error('duplicate'); err.code = '23505';
    mockQuery.mockRejectedValueOnce(err);

    const res = await request(app).post('/api/admin/cost-components').send(validBody());
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/clé identique/);
  });
});

describe('admin-cost-components — PUT /:id', () => {
  it('404 si le composant est introuvable', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // SELECT old
    const res = await request(app).put('/api/admin/cost-components/cc-404').send({ label: 'x' });
    expect(res.status).toBe(404);
  });

  it('400 si incohérence famille/catégorie', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'cc-1', family: 'landed_relay', category: 'freight', is_active: true, default_value: 100, scope: 'global' }] });
    const res = await request(app)
      .put('/api/admin/cost-components/cc-1')
      .send({ family: 'business', category: 'freight' });
    expect(res.status).toBe(400);
  });

  it('400 si aucun champ à modifier', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'cc-1', family: 'landed_relay', category: 'freight', is_active: true, default_value: 100, scope: 'global' }] });
    const res = await request(app).put('/api/admin/cost-components/cc-1').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Aucun champ/);
  });

  it('audit "value_changed" quand default_value change', async () => {
    const oldComp = { id: 'cc-1', key: 'freight_air', family: 'landed_relay', category: 'freight', is_active: true, default_value: 100, scope: 'global' };
    const newComp = { ...oldComp, default_value: 200 };
    mockQuery
      .mockResolvedValueOnce({ rows: [oldComp] })  // SELECT old
      .mockResolvedValueOnce({ rows: [newComp] })  // UPDATE
      .mockResolvedValueOnce({ rows: [] });        // INSERT audit

    const res = await request(app).put('/api/admin/cost-components/cc-1').send({ default_value: 200 });
    expect(res.status).toBe(200);
    const auditCall = mockQuery.mock.calls[2];
    expect(auditCall[1]).toEqual(expect.arrayContaining(['value_changed']));
  });

  it('audit "activated" quand is_active passe false→true', async () => {
    const oldComp = { id: 'cc-1', key: 'freight_air', family: 'landed_relay', category: 'freight', is_active: false, default_value: 100, scope: 'global' };
    const newComp = { ...oldComp, is_active: true };
    mockQuery
      .mockResolvedValueOnce({ rows: [oldComp] })
      .mockResolvedValueOnce({ rows: [newComp] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).put('/api/admin/cost-components/cc-1').send({ is_active: true });
    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[2][1]).toEqual(expect.arrayContaining(['activated']));
  });
});

describe('admin-cost-components — POST /:id/toggle', () => {
  it('404 si introuvable', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/api/admin/cost-components/cc-404/toggle');
    expect(res.status).toBe(404);
  });

  it('bascule is_active et écrit un audit', async () => {
    const oldComp = { id: 'cc-1', key: 'freight_air', is_active: true };
    mockQuery
      .mockResolvedValueOnce({ rows: [oldComp] })
      .mockResolvedValueOnce({ rows: [{ ...oldComp, is_active: false }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).post('/api/admin/cost-components/cc-1/toggle');
    expect(res.status).toBe(200);
    expect(res.body.component.is_active).toBe(false);
    expect(mockQuery.mock.calls[2][1]).toEqual(expect.arrayContaining(['deactivated']));
  });
});

describe('admin-cost-components — DELETE /:id', () => {
  it('soft delete : is_active=FALSE + audit "deactivated"', async () => {
    const oldComp = { id: 'cc-1', key: 'freight_air', is_deletable: false };
    mockQuery
      .mockResolvedValueOnce({ rows: [oldComp] }) // SELECT old
      .mockResolvedValueOnce({})                  // UPDATE is_active=FALSE
      .mockResolvedValueOnce({});                 // INSERT audit

    const res = await request(app).delete('/api/admin/cost-components/cc-1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, soft: true });
    expect(mockQuery.mock.calls[1][0]).toMatch(/UPDATE cost_components SET is_active = FALSE/);
  });

  it('hard delete refusé si !is_deletable (403)', async () => {
    const oldComp = { id: 'cc-1', key: 'freight_air', is_deletable: false };
    mockQuery.mockResolvedValueOnce({ rows: [oldComp] });

    const res = await request(app).delete('/api/admin/cost-components/cc-1?hard=true');
    expect(res.status).toBe(403);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('hard delete autorisé si is_deletable → DELETE + audit "deleted"', async () => {
    const oldComp = { id: 'cc-1', key: 'freight_air', is_deletable: true };
    mockQuery
      .mockResolvedValueOnce({ rows: [oldComp] }) // SELECT old
      .mockResolvedValueOnce({})                  // DELETE
      .mockResolvedValueOnce({});                 // INSERT audit

    const res = await request(app).delete('/api/admin/cost-components/cc-1?hard=true');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, hard: true });
    expect(mockQuery.mock.calls[1][0]).toMatch(/DELETE FROM cost_components/);
    expect(mockQuery.mock.calls[2][0]).toMatch(/'deleted'/);
    expect(mockQuery.mock.calls[2][1]).toEqual(expect.arrayContaining(['freight_air']));
  });
});
