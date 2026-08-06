'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/admin-costing.test.js
 *
 * Tests du router routes/admin-costing.js
 *
 * Couverture (invariants métier critiques, doctrine "vérité économique") :
 *   ✓ GET /orders/:orderId : 404 si getOrderCostTruth renvoie null
 *   ✓ GET /products : real.margin_kmf reste null si le réel n'est pas "plausible"
 *     (real < 50% de l'estimé business) — jamais de marge réelle non fiable affichée
 *   ✓ GET /products : cost_status = 'estimated' tant qu'aucun réel, 'partial_real' sinon
 *   ✓ POST /shipments/:id/allocate : délègue à costAllocation + invalide le cache dashboards
 *   ✓ POST /parcels/:id/allocate : idem
 *   ✓ POST /monthly-fixed/:yearMonth : 400 si format != YYYY-MM
 *   ✓ POST /monthly-fixed/:yearMonth : dryRun=true → PAS d'invalidation cache
 *   ✓ POST /monthly-fixed/:yearMonth : dryRun=false (défaut) → invalidation cache
 *   ✓ POST /recalibration-apply : 400 si aucun champ valide (AUD-07 allowlist)
 *   ✓ POST /recalibration-apply : ignore les champs hors allowlist (pas d'injection de colonne)
 *   ✓ POST /recalibration-apply : valide allocation_confidence contre l'enum low/medium/high
 *   ✓ POST /recalibration-apply : succès → UPDATE + invalidation cache
 */

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => { req.user = req.user || { id: 'admin-1', role: 'admin' }; next(); },
  requireAdmin: (req, res, next) => { if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Accès admin requis' }); next(); },
}));

jest.mock('../../utils/logger', () => ({ child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }) }));

const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));

const mockGetOrderCostTruth = jest.fn();
const mockAllocateShipmentRealCosts = jest.fn();
const mockAllocateParcelRealCosts = jest.fn();
const mockAllocateMonthlyFixedCosts = jest.fn();
jest.mock('../../services/cost-allocation', () => ({
  getOrderCostTruth: (...args) => mockGetOrderCostTruth(...args),
  allocateShipmentRealCosts: (...args) => mockAllocateShipmentRealCosts(...args),
  allocateParcelRealCosts: (...args) => mockAllocateParcelRealCosts(...args),
  allocateMonthlyFixedCosts: (...args) => mockAllocateMonthlyFixedCosts(...args),
  allocateProductPurchaseCosts: jest.fn(),
}));

const mockInvalidateAllDashboards = jest.fn();
jest.mock('../../services/dashboard-cache', () => ({
  invalidateAllDashboards: (...args) => mockInvalidateAllDashboards(...args),
}));

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
    const router = require('../../routes/admin-costing');
    app.use('/api/admin/costing', router);
  });
});

describe('admin-costing — GET /orders/:orderId', () => {
  it('404 si la commande est introuvable (truth null)', async () => {
    mockGetOrderCostTruth.mockResolvedValueOnce(null);
    const res = await request(app).get('/api/admin/costing/orders/order-404');
    expect(res.status).toBe(404);
  });
});

describe('admin-costing — GET /products (doctrine vérité économique)', () => {
  function mockProductRow(overrides = {}) {
    return {
      product_id: 'p1', product_name: 'Produit', category: 'electronique',
      quantity_sold: 10, orders_count: 5,
      revenue_kmf: '100000', avg_unit_price_kmf: '10000',
      total_estimated_landed_kmf: '40000', total_estimated_business_kmf: '60000',
      avg_estimated_margin_pct: '40',
      total_real_kmf: '0',
      ...overrides,
    };
  }

  it('real.margin_kmf est null si le réel est trop faible pour être plausible (< 50% de l\'estimé)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [mockProductRow({ total_real_kmf: '20000' })] }); // 20000 < 60000*0.5=30000
    const res = await request(app).get('/api/admin/costing/products');
    expect(res.status).toBe(200);
    const product = res.body.products[0];
    expect(product.real).not.toBeNull();
    expect(product.real.margin_kmf).toBeNull();
    expect(product.real.margin_pct).toBeNull();
    expect(product.cost_status).toBe('partial_real');
  });

  it('real.margin_kmf est calculé si le réel est plausible (>= 50% de l\'estimé)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [mockProductRow({ total_real_kmf: '65000' })] }); // >= 30000
    const res = await request(app).get('/api/admin/costing/products');
    const product = res.body.products[0];
    expect(product.real.margin_kmf).toBe(100000 - 65000);
  });

  it('cost_status = "estimated" et real = null tant qu\'aucun coût réel', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [mockProductRow({ total_real_kmf: '0' })] });
    const res = await request(app).get('/api/admin/costing/products');
    const product = res.body.products[0];
    expect(product.cost_status).toBe('estimated');
    expect(product.real).toBeNull();
  });
});

describe('admin-costing — allocate endpoints', () => {
  it('POST /shipments/:id/allocate délègue et invalide le cache dashboards', async () => {
    mockAllocateShipmentRealCosts.mockResolvedValueOnce({ allocated_kmf: 5000 });
    const res = await request(app).post('/api/admin/costing/shipments/sh-1/allocate');
    expect(res.status).toBe(200);
    expect(mockAllocateShipmentRealCosts).toHaveBeenCalledWith('sh-1');
    expect(res.body).toEqual({ ok: true, allocated_kmf: 5000 });
    expect(mockInvalidateAllDashboards).toHaveBeenCalledTimes(1);
  });

  it('POST /parcels/:id/allocate délègue et invalide le cache dashboards', async () => {
    mockAllocateParcelRealCosts.mockResolvedValueOnce({ allocated_kmf: 1200 });
    const res = await request(app).post('/api/admin/costing/parcels/pa-1/allocate');
    expect(res.status).toBe(200);
    expect(mockAllocateParcelRealCosts).toHaveBeenCalledWith('pa-1');
    expect(mockInvalidateAllDashboards).toHaveBeenCalledTimes(1);
  });
});

describe('admin-costing — POST /monthly-fixed/:yearMonth', () => {
  it('400 si yearMonth ne respecte pas le format YYYY-MM', async () => {
    const res = await request(app).post('/api/admin/costing/monthly-fixed/2026-6-bad');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/YYYY-MM/);
    expect(mockAllocateMonthlyFixedCosts).not.toHaveBeenCalled();
  });

  it('dryRun=true : alloue mais NE PAS invalider le cache (rien n\'a changé)', async () => {
    mockAllocateMonthlyFixedCosts.mockResolvedValueOnce({ proposal: true });
    const res = await request(app)
      .post('/api/admin/costing/monthly-fixed/2026-06')
      .send({ dryRun: true });
    expect(res.status).toBe(200);
    expect(mockAllocateMonthlyFixedCosts).toHaveBeenCalledWith('2026-06', { dryRun: true });
    expect(mockInvalidateAllDashboards).not.toHaveBeenCalled();
  });

  it('dryRun absent (défaut false) : invalide le cache après allocation', async () => {
    mockAllocateMonthlyFixedCosts.mockResolvedValueOnce({ applied: true });
    const res = await request(app).post('/api/admin/costing/monthly-fixed/2026-06').send({});
    expect(res.status).toBe(200);
    expect(mockAllocateMonthlyFixedCosts).toHaveBeenCalledWith('2026-06', { dryRun: false });
    expect(mockInvalidateAllDashboards).toHaveBeenCalledTimes(1);
  });
});

describe('admin-costing — POST /recalibration-apply (AUD-07 allowlist)', () => {
  it('400 si aucun champ valide à appliquer', async () => {
    const res = await request(app).post('/api/admin/costing/recalibration-apply').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Aucun champ valide/);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('ignore un champ hors allowlist (pas d\'injection de colonne arbitraire)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // UPDATE
      .mockResolvedValueOnce({ rows: [{}] }); // SELECT

    const res = await request(app)
      .post('/api/admin/costing/recalibration-apply')
      .send({ avg_articles_per_order: 3.5, drop_table_or_whatever: 999, malicious_col: 1 });

    expect(res.status).toBe(200);
    const updateSql = mockQuery.mock.calls[0][0];
    expect(updateSql).not.toMatch(/drop_table_or_whatever/);
    expect(updateSql).not.toMatch(/malicious_col/);
    expect(updateSql).toMatch(/avg_articles_per_order/);
  });

  it('rejette une allocation_confidence hors enum low/medium/high', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{}] });

    const res = await request(app)
      .post('/api/admin/costing/recalibration-apply')
      .send({ avg_articles_per_order: 3.5, allocation_confidence: 'super-high' });

    expect(res.status).toBe(200);
    const updateSql = mockQuery.mock.calls[0][0];
    expect(updateSql).not.toMatch(/allocation_confidence/);
  });

  it('accepte une allocation_confidence valide et invalide le cache après succès', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ allocation_confidence: 'high' }] });

    const res = await request(app)
      .post('/api/admin/costing/recalibration-apply')
      .send({ avg_articles_per_order: 3.5, allocation_confidence: 'high' });

    expect(res.status).toBe(200);
    expect(res.body.applied).toEqual({ allocation_confidence: 'high' });
    expect(mockInvalidateAllDashboards).toHaveBeenCalledTimes(1);
  });
});
