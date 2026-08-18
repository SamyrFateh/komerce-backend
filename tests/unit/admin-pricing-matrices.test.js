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
  requireAdmin: (req, res, next) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
    next();
  },
}));

const router = require('../../routes/admin-pricing-matrices');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/pricing-matrices', router);
  app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockState.user = { id: 'adm1', role: 'admin' };
});

describe('LOT 1A — éditeurs pricing fantômes', () => {
  it('conserve le guard admin avant le verdict 410', async () => {
    mockState.user = { id: 'hub1', role: 'agent_hub' };
    const res = await request(buildApp())
      .put('/api/admin/pricing-matrices/taxes/electronique')
      .send({ douane_pct: 0.1 });

    expect(res.status).toBe(403);
    expect(mockDbQuery).not.toHaveBeenCalled();
  });

  it('PUT taxes échoue explicitement en 410 sans toucher la DB', async () => {
    const res = await request(buildApp())
      .put('/api/admin/pricing-matrices/taxes/electronique')
      .send({ douane_pct: 0.1, tva_pct: 0.1, taxe_add_pct: 0 });

    expect(res.status).toBe(410);
    expect(res.body).toEqual(expect.objectContaining({
      error: 'pricing_matrix_editor_retired',
      matrix: 'taxes',
      source_of_truth: 'customs_categories.{douane_pct,tva_pct,taxe_add_pct}',
    }));
    expect(mockDbQuery).not.toHaveBeenCalled();
  });

  it('PUT dims échoue explicitement en 410 sans toucher la DB', async () => {
    const res = await request(buildApp())
      .put('/api/admin/pricing-matrices/dims/electronique')
      .send({ length_cm: 20, width_cm: 10, height_cm: 10 });

    expect(res.status).toBe(410);
    expect(res.body).toEqual(expect.objectContaining({
      error: 'pricing_matrix_editor_retired',
      matrix: 'dims',
      source_of_truth: 'customs_categories.{default_dim_l_cm,default_dim_w_cm,default_dim_h_cm}',
    }));
    expect(mockDbQuery).not.toHaveBeenCalled();
  });

  it('renvoie 410 même pour une ancienne catégorie non canonique : aucune validation legacy ne survit', async () => {
    const res = await request(buildApp())
      .put('/api/admin/pricing-matrices/taxes/inconnue')
      .send({});

    expect(res.status).toBe(410);
    expect(mockDbQuery).not.toHaveBeenCalled();
  });
});

describe('lecture legacy temporaire', () => {
  it('GET /taxes conserve la forme historique', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ category: 'electronique' }] });
    const res = await request(buildApp()).get('/api/admin/pricing-matrices/taxes');

    expect(res.status).toBe(200);
    expect(res.body.taxes).toEqual([{ category: 'electronique' }]);
  });

  it('GET /dims conserve la forme historique', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ category: 'electronique' }] });
    const res = await request(buildApp()).get('/api/admin/pricing-matrices/dims');

    expect(res.status).toBe(200);
    expect(res.body.dims).toEqual([{ category: 'electronique' }]);
  });
});
