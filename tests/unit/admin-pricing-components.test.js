'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const request = require('supertest');
const express = require('express');

const mockDbQuery = jest.fn();
jest.mock('../../db', () => ({
  query: (...args) => mockDbQuery(...args),
}));

const mockState = { user: { id: 'adm1', role: 'admin' } };
jest.mock('../../middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = mockState.user;
    next();
  },
  requireRole: (roles) => (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'forbidden' });
    next();
  },
}));

const router = require('../../routes/admin-pricing-components');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/pricing-components', router);
  app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockState.user = { id: 'adm1', role: 'admin' };
});

describe('guard de role', () => {
  it('403 pour un non-admin', async () => {
    mockState.user = { id: 'hub1', role: 'agent_hub' };
    const res = await request(buildApp()).get('/api/admin/pricing-components');
    expect(res.status).toBe(403);
  });
});

describe('GET /', () => {
  it('400 sur une categorie invalide', async () => {
    const res = await request(buildApp()).get('/api/admin/pricing-components?category=bogus');
    expect(res.status).toBe(400);
  });

  it('fallback liste vide si la table est absente (catch silencieux)', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('relation "pricing_components" does not exist'));
    const res = await request(buildApp()).get('/api/admin/pricing-components');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe('POST /', () => {
  it('400 si champs requis manquants', async () => {
    const res = await request(buildApp()).post('/api/admin/pricing-components').send({ key: 'x' });
    expect(res.status).toBe(400);
  });

  it('400 sur unite invalide', async () => {
    const res = await request(buildApp()).post('/api/admin/pricing-components').send({
      key: 'k1', label: 'L', category: 'sourcing', default_value: 10, unit: 'invalid_unit',
    });
    expect(res.status).toBe(400);
  });

  it('409 si la cle existe deja', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{}] }); // dup check
    const res = await request(buildApp()).post('/api/admin/pricing-components').send({
      key: 'existing', label: 'L', category: 'sourcing', default_value: 10, unit: 'kmf',
    });
    expect(res.status).toBe(409);
  });

  it('cree un composant utilisateur, toujours editable et supprimable', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [] }) // dup check
      .mockResolvedValueOnce({ rows: [{ id: 'c1', key: 'k1', is_editable: true, is_deletable: true }] });

    const res = await request(buildApp()).post('/api/admin/pricing-components').send({
      key: 'k1', label: 'L', category: 'sourcing', default_value: 10, unit: 'kmf',
    });
    expect(res.status).toBe(201);

    const insertParams = mockDbQuery.mock.calls[1][1];
    // is_editable et is_deletable forces a true (positions 9 et 10 dans la liste de params)
    expect(insertParams[8]).toBe(true);
    expect(insertParams[9]).toBe(true);
  });
});

describe('PUT /:id — verrouillage champs systeme', () => {
  it('404 si le composant est introuvable', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp()).put('/api/admin/pricing-components/c1').send({ default_value: 5 });
    expect(res.status).toBe(404);
  });

  it("403 si on tente de modifier 'label'/'key'/'category'/'unit' sur un composant systeme (is_editable=false)", async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'c1', is_editable: false }] });
    const res = await request(buildApp()).put('/api/admin/pricing-components/c1').send({ label: 'Nouveau nom' });
    expect(res.status).toBe(403);
    expect(res.body.locked_fields).toEqual(['label']);
  });

  it('autorise default_value/applies_to/is_active/notes sur un composant systeme', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'c1', is_editable: false }] })
      .mockResolvedValueOnce({ rows: [{ id: 'c1', default_value: 42 }] });

    const res = await request(buildApp()).put('/api/admin/pricing-components/c1').send({ default_value: 42 });
    expect(res.status).toBe(200);
  });

  it('autorise tous les champs sur un composant utilisateur (is_editable=true)', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'c1', is_editable: true }] })
      .mockResolvedValueOnce({ rows: [{ id: 'c1', label: 'Nouveau' }] });

    const res = await request(buildApp()).put('/api/admin/pricing-components/c1').send({ label: 'Nouveau' });
    expect(res.status).toBe(200);
  });

  it('400 si aucun champ a mettre a jour', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'c1', is_editable: true }] });
    const res = await request(buildApp()).put('/api/admin/pricing-components/c1').send({});
    expect(res.status).toBe(400);
  });
});

describe('PUT /:id/toggle', () => {
  it('404 si introuvable', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp()).put('/api/admin/pricing-components/c1/toggle');
    expect(res.status).toBe(404);
  });

  it('bascule is_active en une seule requete', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'c1', is_active: false }] });
    const res = await request(buildApp()).put('/api/admin/pricing-components/c1/toggle');
    expect(res.status).toBe(200);
    expect(mockDbQuery.mock.calls[0][0]).toContain('NOT is_active');
  });
});

describe('DELETE /:id', () => {
  it('404 si introuvable', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp()).delete('/api/admin/pricing-components/c1');
    expect(res.status).toBe(404);
  });

  it('soft delete par defaut (is_active=false), conserve la ligne', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'c1', is_deletable: false }] })
      .mockResolvedValueOnce({ rows: [{ id: 'c1', is_active: false }] });

    const res = await request(buildApp()).delete('/api/admin/pricing-components/c1');
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('soft');
  });

  it("403 sur hard delete (?force=true) si is_deletable=false (composant systeme protege)", async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'c1', is_deletable: false }] });
    const res = await request(buildApp()).delete('/api/admin/pricing-components/c1?force=true');
    expect(res.status).toBe(403);
  });

  it('hard delete autorise si is_deletable=true et force=true', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'c1', is_deletable: true }] })
      .mockResolvedValueOnce({ rows: [] }); // DELETE

    const res = await request(buildApp()).delete('/api/admin/pricing-components/c1?force=true');
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('hard');
  });
});
