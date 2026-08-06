'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const request = require('supertest');
const express = require('express');

const mockDbQuery = jest.fn();
const mockGetClient = jest.fn();
jest.mock('../../db', () => ({
  query: (...args) => mockDbQuery(...args),
  getClient: (...args) => mockGetClient(...args),
}));

const mockState = { user: { id: 'adm1', role: 'admin' } };
jest.mock('../../middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = mockState.user;
    next();
  },
  requireAdmin: (req, res, next) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
    next();
  },
}));

const mockInvalidateCache = jest.fn();
jest.mock('../../utils/pricing-cache', () => ({
  invalidatePricingMatricesCache: (...args) => mockInvalidateCache(...args),
}));

jest.mock('../../utils/logger', () => ({ child: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() })) }));

const router = require('../../routes/admin-pricing-matrices');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/pricing-matrices', router);
  app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
  return app;
}

function makeClient() {
  return {
    query: jest.fn().mockResolvedValue({ rows: [] }),
    release: jest.fn(),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockState.user = { id: 'adm1', role: 'admin' };
});

describe('guard admin', () => {
  it('403 pour un non-admin sur PUT taxes', async () => {
    mockState.user = { id: 'hub1', role: 'agent_hub' };
    const res = await request(buildApp())
      .put('/api/admin/pricing-matrices/taxes/electronique')
      .send({ douane_pct: 0.1, tva_pct: 0.1, taxe_add_pct: 0, reason: 'ajustement marche' });
    expect(res.status).toBe(403);
  });
});

describe('PUT /taxes/:category', () => {
  it('400 sur une categorie hors liste blanche', async () => {
    const res = await request(buildApp())
      .put('/api/admin/pricing-matrices/taxes/inconnue')
      .send({ douane_pct: 0.1, tva_pct: 0.1, taxe_add_pct: 0, reason: 'ajustement marche' });
    expect(res.status).toBe(400);
  });

  it('400 si la justification (reason) est absente ou trop courte', async () => {
    const res = await request(buildApp())
      .put('/api/admin/pricing-matrices/taxes/electronique')
      .send({ douane_pct: 0.1, tva_pct: 0.1, taxe_add_pct: 0, reason: 'court' });
    expect(res.status).toBe(400);
  });

  it.each([-0.1, 1.5, 'abc'])('400 si une valeur de taxe est hors [0,1] ou non numerique (%p)', async (badVal) => {
    const res = await request(buildApp())
      .put('/api/admin/pricing-matrices/taxes/electronique')
      .send({ douane_pct: badVal, tva_pct: 0.1, taxe_add_pct: 0, reason: 'ajustement marche valide' });
    expect(res.status).toBe(400);
  });

  it('404 si la categorie n\'est pas initialisee en base (rollback)', async () => {
    const client = makeClient();
    client.query.mockImplementation((sql) => {
      if (sql.includes('SELECT * FROM pricing_category_taxes')) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });
    mockGetClient.mockResolvedValue(client);

    const res = await request(buildApp())
      .put('/api/admin/pricing-matrices/taxes/electronique')
      .send({ douane_pct: 0.1, tva_pct: 0.1, taxe_add_pct: 0, reason: 'ajustement marche valide' });

    expect(res.status).toBe(404);
    expect(client.query.mock.calls.map((c) => c[0])).toEqual(
      expect.arrayContaining(['BEGIN', 'ROLLBACK'])
    );
  });

  it('met a jour, journalise un audit et invalide le cache (transaction complete)', async () => {
    const client = makeClient();
    client.query.mockImplementation((sql) => {
      if (sql.includes('SELECT * FROM pricing_category_taxes')) {
        return Promise.resolve({ rows: [{ douane_pct: 0.05, tva_pct: 0.05, taxe_add_pct: 0 }] });
      }
      if (sql.includes('UPDATE pricing_category')) {
        return Promise.resolve({ rows: [{ category: 'electronique', douane_pct: 0.1 }] });
      }
      return Promise.resolve({ rows: [] });
    });
    mockGetClient.mockResolvedValue(client);

    const res = await request(buildApp())
      .put('/api/admin/pricing-matrices/taxes/electronique')
      .send({ douane_pct: 0.1, tva_pct: 0.1, taxe_add_pct: 0, reason: 'alignement marche 2026' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockInvalidateCache).toHaveBeenCalledTimes(1);

    const calledSql = client.query.mock.calls.map((c) => c[0]);
    expect(calledSql).toEqual(
      expect.arrayContaining(['BEGIN', 'COMMIT'])
    );
    expect(calledSql.some((s) => s.includes('INSERT INTO pricing_matrices_audit'))).toBe(true);
  });

  it('rollback + propagation si une erreur survient pendant la transaction', async () => {
    const client = makeClient();
    client.query.mockImplementation((sql) => {
      if (sql.includes('SELECT * FROM pricing_category_taxes')) {
        return Promise.resolve({ rows: [{ douane_pct: 0.05, tva_pct: 0.05, taxe_add_pct: 0 }] });
      }
      if (sql.includes('UPDATE pricing_category')) {
        return Promise.reject(new Error('db write failed'));
      }
      return Promise.resolve({ rows: [] });
    });
    mockGetClient.mockResolvedValue(client);

    const res = await request(buildApp())
      .put('/api/admin/pricing-matrices/taxes/electronique')
      .send({ douane_pct: 0.1, tva_pct: 0.1, taxe_add_pct: 0, reason: 'alignement marche 2026' });

    expect(res.status).toBe(500);
    expect(client.query.mock.calls.map((c) => c[0])).toEqual(
      expect.arrayContaining(['ROLLBACK'])
    );
    expect(client.release).toHaveBeenCalled();
  });
});

describe('PUT /dims/:category', () => {
  it('400 sur des dimensions hors [1,200] ou non entieres', async () => {
    const res = await request(buildApp())
      .put('/api/admin/pricing-matrices/dims/electronique')
      .send({ length_cm: 0, width_cm: 10, height_cm: 10, reason: 'ajustement dimensions colis' });
    expect(res.status).toBe(400);
  });

  it('met a jour les dimensions et invalide le cache', async () => {
    const client = makeClient();
    client.query.mockImplementation((sql) => {
      if (sql.includes('SELECT * FROM pricing_category_dims')) {
        return Promise.resolve({ rows: [{ length_cm: 10, width_cm: 10, height_cm: 10 }] });
      }
      if (sql.includes('UPDATE pricing_category')) {
        return Promise.resolve({ rows: [{ category: 'electronique', length_cm: 20 }] });
      }
      return Promise.resolve({ rows: [] });
    });
    mockGetClient.mockResolvedValue(client);

    const res = await request(buildApp())
      .put('/api/admin/pricing-matrices/dims/electronique')
      .send({ length_cm: 20, width_cm: 10, height_cm: 10, reason: 'ajustement dimensions colis' });

    expect(res.status).toBe(200);
    expect(mockInvalidateCache).toHaveBeenCalledTimes(1);
  });

  it("l'echec de l'audit (best-effort) ne bloque pas l'update des dims", async () => {
    const client = makeClient();
    client.query.mockImplementation((sql) => {
      if (sql.includes('SELECT * FROM pricing_category_dims')) {
        return Promise.resolve({ rows: [{ length_cm: 10, width_cm: 10, height_cm: 10 }] });
      }
      if (sql.includes('UPDATE pricing_category')) {
        return Promise.resolve({ rows: [{ category: 'electronique', length_cm: 20 }] });
      }
      if (sql.includes('INSERT INTO pricing_matrices_audit')) {
        return Promise.reject(new Error('table manquante'));
      }
      return Promise.resolve({ rows: [] });
    });
    mockGetClient.mockResolvedValue(client);

    const res = await request(buildApp())
      .put('/api/admin/pricing-matrices/dims/electronique')
      .send({ length_cm: 20, width_cm: 10, height_cm: 10, reason: 'ajustement dimensions colis' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('GET /taxes et GET /dims', () => {
  it('GET /taxes renvoie la liste', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ category: 'electronique' }] });
    const res = await request(buildApp()).get('/api/admin/pricing-matrices/taxes');
    expect(res.status).toBe(200);
    expect(res.body.taxes).toHaveLength(1);
  });

  it('GET /dims renvoie la liste', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ category: 'electronique' }] });
    const res = await request(buildApp()).get('/api/admin/pricing-matrices/dims');
    expect(res.status).toBe(200);
    expect(res.body.dims).toHaveLength(1);
  });
});
