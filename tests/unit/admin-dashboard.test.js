'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/admin-dashboard.test.js
 *
 * Couvre routes/admin-dashboard.js
 * Route volumineuse (4 endpoints agrégateurs + cache/clear) — tout le détail
 * métier vit dans services/dashboard-metrics — on teste ici :
 *   - la garde auth admin (401/403)
 *   - le câblage nominal des endpoints principaux (control-tower, costing,
 *     logistics, unified)
 *   - parseFilters / makeDataQuality via leur effet observable sur la réponse
 *   - POST /cache/clear
 *   - propagation d'erreur (next(err)) si un KPI échoue
 */

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => { req.user = req.user || null; next(); },
  requireAdmin: (req, res, next) => {
    if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
    next();
  },
}));

const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));

jest.mock('../../services/dashboard-cache', () => ({
  cacheMiddleware: () => (req, res, next) => next(),
  clear: jest.fn(() => 3),
}));

// Valeur KPI générique renvoyée par toutes les fonctions metrics.getXxx()
const genericKpi = () => ({ value: 10, label: 'kpi', data_quality: { items_with_data: 5, items_total: 5 } });

function makeMetricsMock() {
  const handler = {
    get(target, prop) {
      if (prop === 'buildFiltersClause') return jest.fn(() => ({ where: '1=1', params: [] }));
      if (!(prop in target)) target[prop] = jest.fn().mockResolvedValue(genericKpi());
      return target[prop];
    },
  };
  return new Proxy({}, handler);
}

jest.mock('../../services/dashboard-metrics', () => {
  const handler = {
    get(target, prop) {
      if (prop === 'buildFiltersClause') return () => ({ where: '1=1', params: [] });
      if (!(prop in target)) target[prop] = jest.fn().mockResolvedValue({
        value: 10, label: 'kpi', data_quality: { items_with_data: 5, items_total: 5 },
      });
      return target[prop];
    },
  };
  return new Proxy({}, handler);
});

jest.mock('../../utils/logger', () => ({
  child: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() })),
  forModule: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() })),
}));

const express = require('express');
const request = require('supertest');

let app;
let currentUser;

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockResolvedValue({ rows: [{ count: 0, day: '2026-01-01', status: 'shipped', orders_count: 0, ca_kmf: 0 }] });
  currentUser = { id: 'admin-1', role: 'admin' };

  app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = currentUser; next(); });

  const router = require('../../routes/admin-dashboard');
  app.use('/api/admin/dashboard', router);
});

describe('admin-dashboard — accès', () => {
  it('non-admin → 403 sur chaque endpoint principal', async () => {
    currentUser = { id: 'u1', role: 'client' };
    for (const path of ['/control-tower', '/costing', '/logistics', '/unified']) {
      const res = await request(app).get('/api/admin/dashboard' + path);
      expect(res.status).toBe(403);
    }
  });

  it('non authentifié → 403 (pas de req.user)', async () => {
    currentUser = null;
    const res = await request(app).get('/api/admin/dashboard/control-tower');
    expect(res.status).toBe(403);
  });
});

describe('GET /control-tower', () => {
  it('nominal → 200 avec kpis, charts, tables, alerts, data_quality', async () => {
    const res = await request(app).get('/api/admin/dashboard/control-tower');
    expect(res.status).toBe(200);
    expect(res.body.kpis).toHaveLength(8);
    expect(res.body.charts).toBeDefined();
    expect(res.body.tables).toBeDefined();
    expect(res.body.data_quality.source_tables).toContain('orders');
    expect(res.body.drilldown_links.ca_encaisse).toBe('/admin/costing');
  });

  it('filtres passés en query → repris dans data_quality.filters', async () => {
    const res = await request(app).get('/api/admin/dashboard/control-tower?from=2026-01-01&island=Grande Comore');
    expect(res.status).toBe(200);
    expect(res.body.data_quality.filters.from).toBe('2026-01-01');
    expect(res.body.data_quality.filters.island).toBe('Grande Comore');
    expect(res.body.data_quality.filters.to).toBeNull();
  });

  it('erreur dans un KPI → 500 via next(err)', async () => {
    const metrics = require('../../services/dashboard-metrics');
    metrics.getCAEncaisse.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).get('/api/admin/dashboard/control-tower');
    expect(res.status).toBe(500);
  });
});

describe('GET /costing', () => {
  it('nominal → 200 avec kpis + data_quality.source_tables', async () => {
    const res = await request(app).get('/api/admin/dashboard/costing');
    expect(res.status).toBe(200);
    expect(res.body.kpis).toHaveLength(8);
    expect(res.body.data_quality.source_tables).toContain('order_item_cost_imputations');
  });

  it('margeConsolidee sans donnees → warning + incomplete_fields', async () => {
    const metrics = require('../../services/dashboard-metrics');
    metrics.getMargeConsolidee.mockResolvedValueOnce({
      value: 0, data_quality: { items_with_data: 0, items_total: 5 },
    });
    metrics.getMargeEstimee.mockResolvedValueOnce({
      value: 0, data_quality: { items_with_data: 2, items_total: 5 },
    });

    const res = await request(app).get('/api/admin/dashboard/costing');
    expect(res.status).toBe(200);
    expect(res.body.data_quality.warnings.length).toBeGreaterThan(0);
    expect(res.body.data_quality.incomplete_fields).toContain('fixed_overhead');
  });
});

describe('GET /logistics', () => {
  it('nominal → 200 avec kpis', async () => {
    const res = await request(app).get('/api/admin/dashboard/logistics');
    expect(res.status).toBe(200);
    expect(res.body.kpis).toHaveLength(8);
  });

  it('retards critiques > 0 → warning dans data_quality', async () => {
    const metrics = require('../../services/dashboard-metrics');
    metrics.getRetardsCritiques.mockResolvedValueOnce({ value: 3 });
    const res = await request(app).get('/api/admin/dashboard/logistics');
    expect(res.body.data_quality.warnings[0]).toContain('retard critique');
  });
});

describe('GET /unified', () => {
  it('nominal → 200 avec kpis_global, view_blocks (3 vues), economic_flow, principles', async () => {
    const res = await request(app).get('/api/admin/dashboard/unified');
    expect(res.status).toBe(200);
    expect(res.body.kpis_global).toHaveLength(5);
    expect(res.body.view_blocks).toHaveLength(3);
    expect(res.body.economic_flow.stages.length).toBeGreaterThan(0);
    expect(res.body.principles.length).toBeGreaterThan(0);
    expect(Array.isArray(res.body.system_alerts)).toBe(true);
  });
});

describe('POST /cache/clear', () => {
  it('admin → vide le cache et renvoie le compte', async () => {
    const res = await request(app).post('/api/admin/dashboard/cache/clear').send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, cleared: 3, prefix: 'all' });
  });

  it('avec prefix → transmis au service cache', async () => {
    const cache = require('../../services/dashboard-cache');
    const res = await request(app).post('/api/admin/dashboard/cache/clear').send({ prefix: 'control-tower' });
    expect(res.status).toBe(200);
    expect(cache.clear).toHaveBeenCalledWith('control-tower');
    expect(res.body.prefix).toBe('control-tower');
  });

  it('non-admin → 403', async () => {
    currentUser = { id: 'u1', role: 'client' };
    const res = await request(app).post('/api/admin/dashboard/cache/clear').send({});
    expect(res.status).toBe(403);
  });
});
