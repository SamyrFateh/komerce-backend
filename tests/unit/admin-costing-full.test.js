'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/admin-costing-full.test.js
 *
 * Complète tests/unit/admin-costing.test.js (qui couvre déjà :
 * 404 sur GET /orders/:orderId, doctrine plausibilité du réel sur GET /products,
 * délégation + invalidation cache des endpoints allocate, validation
 * yearMonth + dryRun sur monthly-fixed, allowlist AUD-07 sur recalibration-apply)
 * avec le reste de routes/admin-costing.js :
 *
 *   - GET /orders            : liste enrichie (cost_status/missing_cost_fields
 *                              par branche, appel conditionnel à getOrderCostTruth,
 *                              filtres status/from/to, pagination)
 *   - GET /orders/:orderId   : chemin succès (mapping items, real_allocations,
 *                              variance, imputation_id présent/absent)
 *   - GET /products          : chemin erreur (catch → next)
 *   - GET /relais             : listing complet (real/variance/estMargin par branche)
 *   - POST /shipments/:id/allocate, /parcels/:id/allocate : chemins erreur
 *   - POST /orders/:id/lock-purchase : entièrement non testé avant ce lot
 *   - POST /monthly-fixed/:yearMonth : chemin erreur
 *   - GET /recalibration-proposal : entièrement non testé avant ce lot
 *     (periodDays défaut/custom, confidence low/medium/high, current absent)
 *   - POST /recalibration-apply : branche allocation_notes, chemin erreur
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
const mockAllocateProductPurchaseCosts = jest.fn();
jest.mock('../../services/cost-allocation', () => ({
  getOrderCostTruth: (...args) => mockGetOrderCostTruth(...args),
  allocateShipmentRealCosts: (...args) => mockAllocateShipmentRealCosts(...args),
  allocateParcelRealCosts: (...args) => mockAllocateParcelRealCosts(...args),
  allocateMonthlyFixedCosts: (...args) => mockAllocateMonthlyFixedCosts(...args),
  allocateProductPurchaseCosts: (...args) => mockAllocateProductPurchaseCosts(...args),
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
  // handler d'erreur express minimal pour capter les next(err)
  app.use((err, req, res, next) => { res.status(500).json({ error: err.message || 'error' }); });
});

// ═══════════════════════════════════════════════════════════════════════
// GET /orders
// ═══════════════════════════════════════════════════════════════════════
describe('admin-costing — GET /orders', () => {
  function mockOrderRow(overrides = {}) {
    return {
      id: 'o1', reference: 'REF-1', status: 'delivered', payment_status: 'paid',
      total_kmf: '10000', relais_id: 'r1', relais_name: 'Relais Test',
      destination_island: 'Grande Comore', created_at: '2026-01-01',
      est_landed: '3000', est_business: '4000',
      imputations_count: '1', items_count: '1',
      real_total: '0',
      ...overrides,
    };
  }

  it('incomplete: pas d\'imputations → cost_status=incomplete, missing=[cost_imputations]', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [mockOrderRow({ imputations_count: '0', est_landed: null, est_business: null })] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });

    const res = await request(app).get('/api/admin/costing/orders');
    expect(res.status).toBe(200);
    const o = res.body.orders[0];
    expect(o.cost_status).toBe('incomplete');
    expect(o.missing_cost_fields).toEqual(['cost_imputations']);
    expect(o.estimated.business_complete_cost_kmf).toBeNull();
    expect(mockGetOrderCostTruth).not.toHaveBeenCalled();
  });

  it('estimated: imputations présentes mais pas de réel → cost_status=estimated', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [mockOrderRow({ real_total: '0' })] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });

    const res = await request(app).get('/api/admin/costing/orders');
    const o = res.body.orders[0];
    expect(o.cost_status).toBe('estimated');
    expect(o.missing_cost_fields).toEqual(['real_costs']);
    expect(o.real).toBeNull();
    expect(mockGetOrderCostTruth).not.toHaveBeenCalled();
  });

  it('partial_real sans appel truth: réel présent mais imputations incomplètes (allItemsImputed=false)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [mockOrderRow({ real_total: '5000', imputations_count: '1', items_count: '2' })] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });

    const res = await request(app).get('/api/admin/costing/orders');
    const o = res.body.orders[0];
    expect(o.cost_status).toBe('partial_real');
    expect(o.missing_cost_fields).toEqual(['fixed_overhead', 'payment']);
    expect(o.real).toEqual({ total_kmf: 5000, margin_kmf: null, margin_pct: null, by_cost_type: {} });
    expect(mockGetOrderCostTruth).not.toHaveBeenCalled();
  });

  it('appelle getOrderCostTruth quand réel présent ET tous les items imputés, et applique le résultat', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [mockOrderRow({ real_total: '5000', imputations_count: '1', items_count: '1' })] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });
    mockGetOrderCostTruth.mockResolvedValueOnce({
      cost_status: 'actual',
      missing_cost_fields: [],
      real: { total_kmf: 5000, margin_kmf: 5000, margin_pct: 50 },
      variance: { total_kmf: 1000, total_pct: 10 },
    });

    const res = await request(app).get('/api/admin/costing/orders');
    const o = res.body.orders[0];
    expect(mockGetOrderCostTruth).toHaveBeenCalledWith('o1');
    expect(o.cost_status).toBe('actual');
    expect(o.missing_cost_fields).toEqual([]);
    expect(o.real).toEqual({ total_kmf: 5000, margin_kmf: 5000, margin_pct: 50 });
    expect(o.variance).toEqual({ total_kmf: 1000, total_pct: 10 });
  });

  it('conserve le fallback si getOrderCostTruth renvoie null malgré réel+imputations complets', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [mockOrderRow({ real_total: '5000', imputations_count: '1', items_count: '1' })] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });
    mockGetOrderCostTruth.mockResolvedValueOnce(null);

    const res = await request(app).get('/api/admin/costing/orders');
    const o = res.body.orders[0];
    expect(o.cost_status).toBe('partial_real');
    expect(o.real).toEqual({ total_kmf: 5000, margin_kmf: null, margin_pct: null, by_cost_type: {} });
  });

  it('applique les filtres status/from/to et la pagination dans le SQL et la réponse', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });

    const res = await request(app)
      .get('/api/admin/costing/orders')
      .query({ status: 'delivered', from: '2026-01-01', to: '2026-06-30', limit: 500, offset: 20 });

    expect(res.status).toBe(200);
    const sqlCall = mockQuery.mock.calls[0][0];
    expect(sqlCall).toMatch(/o\.status = \$1/);
    expect(sqlCall).toMatch(/o\.created_at >= \$2/);
    expect(sqlCall).toMatch(/o\.created_at <= \$3/);
    // limit plafonné à 200
    expect(mockQuery.mock.calls[0][1]).toEqual(['delivered', '2026-01-01', '2026-06-30', 200, 20]);
    expect(res.body.pagination).toEqual({ total: 0, limit: 200, offset: 20 });
  });

  it('chemin erreur → 500 via next(err)', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).get('/api/admin/costing/orders');
    expect(res.status).toBe(500);
  });

  it('fallback sale=0 quand total_kmf est null, real_total=null (pas de réel du tout)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [mockOrderRow({ total_kmf: null, real_total: null, imputations_count: '0' })] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });

    const res = await request(app).get('/api/admin/costing/orders');
    const o = res.body.orders[0];
    expect(o.sale_total_kmf).toBe(0);
    expect(o.real).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// GET /orders/:orderId — chemin succès
// ═══════════════════════════════════════════════════════════════════════
describe('admin-costing — GET /orders/:orderId (succès)', () => {
  it('mappe les items avec imputation présente, real_allocations et variance calculée', async () => {
    mockGetOrderCostTruth.mockResolvedValueOnce({ cost_status: 'actual', order_id: 'o1' });
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          order_item_id: 'oi1', product_id: 'p1', quantity: 2, price_kmf: '5000',
          product_name: 'Produit A', category: 'electronique',
          imputation_id: 'imp1',
          estimated_landed_relay_cost_kmf: '2000',
          estimated_business_complete_cost_kmf: '3000',
          estimated_margin_kmf: '7000', estimated_margin_pct: '70',
          cost_breakdown: {}, allocations: {}, allocation_averages: {},
          allocation_confidence: 'high', data_quality: 'good', pricing_source: 'manual',
        }],
      })
      .mockResolvedValueOnce({
        rows: [{ order_item_id: 'oi1', cost_type: 'shipping', amount_kmf: '4000', allocation_method: 'weight', source: 'shipment', is_actual: true, confidence: 'high', parcel_id: 'pa1', shipment_id: null }],
      });

    const res = await request(app).get('/api/admin/costing/orders/o1');
    expect(res.status).toBe(200);
    const item = res.body.items[0];
    expect(item.estimated.business_complete_cost_kmf).toBe(3000);
    expect(item.real_allocations).toHaveLength(1);
    expect(item.real_total_kmf).toBe(4000);
    expect(item.variance_kmf).toBe(4000 - 3000); // realTotal>0 && estTotal>0
    expect(res.body.cost_status).toBe('actual');
  });

  it('item sans imputation → estimated=null, real_allocations=[], variance=null', async () => {
    mockGetOrderCostTruth.mockResolvedValueOnce({ cost_status: 'incomplete' });
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          order_item_id: 'oi2', product_id: 'p2', quantity: 1, price_kmf: '1000',
          product_name: 'Produit B', category: 'mode',
          imputation_id: null,
        }],
      })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/admin/costing/orders/o1');
    const item = res.body.items[0];
    expect(item.estimated).toBeNull();
    expect(item.real_allocations).toEqual([]);
    expect(item.real_total_kmf).toBeNull();
    expect(item.variance_kmf).toBeNull();
  });

  it('chemin erreur → 500 via next(err)', async () => {
    mockGetOrderCostTruth.mockRejectedValueOnce(new Error('boom'));
    const res = await request(app).get('/api/admin/costing/orders/o1');
    expect(res.status).toBe(500);
  });

  it('regroupe plusieurs real_allocations pour le même order_item_id (branche déjà-existant)', async () => {
    mockGetOrderCostTruth.mockResolvedValueOnce({ cost_status: 'actual' });
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          order_item_id: 'oi1', product_id: 'p1', quantity: 1, price_kmf: '1000',
          product_name: 'Produit A', category: 'x', imputation_id: null,
        }],
      })
      .mockResolvedValueOnce({
        rows: [
          { order_item_id: 'oi1', cost_type: 'shipping', amount_kmf: '1000', allocation_method: 'weight', source: 's', is_actual: true, confidence: 'high', parcel_id: 'pa1', shipment_id: null },
          { order_item_id: 'oi1', cost_type: 'customs', amount_kmf: '500', allocation_method: 'flat', source: 's', is_actual: true, confidence: 'high', parcel_id: 'pa1', shipment_id: null },
        ],
      });

    const res = await request(app).get('/api/admin/costing/orders/o1');
    const item = res.body.items[0];
    expect(item.real_allocations).toHaveLength(2);
    expect(item.real_total_kmf).toBe(1500);
  });

  it('margin_pct null quand estimated_margin_pct est null (imputation présente)', async () => {
    mockGetOrderCostTruth.mockResolvedValueOnce({ cost_status: 'estimated' });
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          order_item_id: 'oi3', product_id: 'p3', quantity: 1, price_kmf: '1000',
          product_name: 'Produit C', category: 'x', imputation_id: 'imp3',
          estimated_landed_relay_cost_kmf: '300', estimated_business_complete_cost_kmf: '500',
          estimated_margin_kmf: '500', estimated_margin_pct: null,
          cost_breakdown: {}, allocations: {}, allocation_averages: {},
          allocation_confidence: 'low', data_quality: 'ok', pricing_source: 'auto',
        }],
      })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/admin/costing/orders/o1');
    const item = res.body.items[0];
    expect(item.estimated.margin_pct).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// GET /products — chemin erreur (complète le fichier existant)
// ═══════════════════════════════════════════════════════════════════════
describe('admin-costing — GET /products (erreur + branches complémentaires)', () => {
  it('chemin erreur → 500 via next(err)', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).get('/api/admin/costing/products');
    expect(res.status).toBe(500);
  });

  it('applique les filtres from/to dans le SQL', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/admin/costing/products').query({ from: '2026-01-01', to: '2026-06-30' });
    expect(res.status).toBe(200);
    const sqlCall = mockQuery.mock.calls[0][0];
    expect(sqlCall).toMatch(/imp\.created_at >= \$1/);
    expect(sqlCall).toMatch(/imp\.created_at <= \$2/);
    expect(mockQuery.mock.calls[0][1]).toEqual(['2026-01-01', '2026-06-30', 100]);
  });

  it('fallback revenue=0/estB=0 et avg_margin_pct=null quand les champs sont null', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        product_id: 'p1', product_name: 'Produit', category: 'x',
        quantity_sold: 0, orders_count: 0,
        revenue_kmf: null, avg_unit_price_kmf: null,
        total_estimated_landed_kmf: null, total_estimated_business_kmf: null,
        avg_estimated_margin_pct: null,
        total_real_kmf: '0',
      }],
    });
    const res = await request(app).get('/api/admin/costing/products');
    const p = res.body.products[0];
    expect(p.revenue_kmf).toBe(0);
    expect(p.estimated.total_business_kmf).toBe(0); // Number(null)||0 = 0, _round(0) = 0
    expect(p.estimated.avg_margin_pct).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// GET /relais
// ═══════════════════════════════════════════════════════════════════════
describe('admin-costing — GET /relais', () => {
  function mockRelaisRow(overrides = {}) {
    return {
      relais_id: 'r1', relais_name: 'Relais A',
      orders_count: 10, revenue_kmf: '100000',
      total_estimated_landed_kmf: '30000', total_estimated_business_kmf: '40000',
      total_real_kmf: '0',
      incomplete_imputations_count: 2, no_real_cost_count: 5,
      ...overrides,
    };
  }

  it('estMargin=null quand estB=0, real=null quand real=0, variance=null', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [mockRelaisRow({ total_estimated_business_kmf: '0', total_real_kmf: '0' })] });
    const res = await request(app).get('/api/admin/costing/relais');
    expect(res.status).toBe(200);
    const r = res.body.relais[0];
    expect(r.estimated.margin_kmf).toBeNull();
    expect(r.estimated.margin_pct).toBeNull();
    expect(r.real).toBeNull();
    expect(r.variance).toBeNull();
  });

  it('calcule margin_pct, real et variance quand real>0 et estB>0', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [mockRelaisRow({ total_real_kmf: '45000' })] });
    const res = await request(app).get('/api/admin/costing/relais');
    const r = res.body.relais[0];
    expect(r.estimated.margin_kmf).toBe(100000 - 40000);
    expect(r.estimated.margin_pct).toBeCloseTo(60, 1);
    expect(r.real).toEqual({ total_kmf: 45000 });
    expect(r.variance).toEqual({ total_kmf: 45000 - 40000, total_pct: Number((((45000 - 40000) / 40000) * 100).toFixed(2)) });
  });

  it('applique les filtres from/to dans le SQL', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/admin/costing/relais').query({ from: '2026-01-01', to: '2026-06-30' });
    expect(res.status).toBe(200);
    const sqlCall = mockQuery.mock.calls[0][0];
    expect(sqlCall).toMatch(/o\.created_at >= \$1/);
    expect(sqlCall).toMatch(/o\.created_at <= \$2/);
    expect(mockQuery.mock.calls[0][1]).toEqual(['2026-01-01', '2026-06-30']);
  });

  it('chemin erreur → 500 via next(err)', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).get('/api/admin/costing/relais');
    expect(res.status).toBe(500);
  });

  it('fallback revenue=0/estB=0/real=0 quand les agrégats SQL sont null', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [mockRelaisRow({
        revenue_kmf: null, total_estimated_business_kmf: null, total_real_kmf: null,
      })],
    });
    const res = await request(app).get('/api/admin/costing/relais');
    const r = res.body.relais[0];
    expect(r.revenue_kmf).toBe(0);
    expect(r.estimated.margin_kmf).toBeNull();
    expect(r.real).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// POST /shipments/:id/allocate et /parcels/:id/allocate — chemins erreur
// ═══════════════════════════════════════════════════════════════════════
describe('admin-costing — allocate endpoints (erreur)', () => {
  it('POST /shipments/:id/allocate : erreur → 500 via next(err), pas d\'invalidation cache', async () => {
    mockAllocateShipmentRealCosts.mockRejectedValueOnce(new Error('shipment not found'));
    const res = await request(app).post('/api/admin/costing/shipments/sh-x/allocate');
    expect(res.status).toBe(500);
    expect(mockInvalidateAllDashboards).not.toHaveBeenCalled();
  });

  it('POST /parcels/:id/allocate : erreur → 500 via next(err), pas d\'invalidation cache', async () => {
    mockAllocateParcelRealCosts.mockRejectedValueOnce(new Error('parcel not found'));
    const res = await request(app).post('/api/admin/costing/parcels/pa-x/allocate');
    expect(res.status).toBe(500);
    expect(mockInvalidateAllDashboards).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// POST /orders/:id/lock-purchase — entièrement non testé avant ce lot
// ═══════════════════════════════════════════════════════════════════════
describe('admin-costing — POST /orders/:id/lock-purchase', () => {
  it('délègue à allocateProductPurchaseCosts et invalide le cache dashboards', async () => {
    mockAllocateProductPurchaseCosts.mockResolvedValueOnce({ locked_kmf: 8000 });
    const res = await request(app).post('/api/admin/costing/orders/o1/lock-purchase');
    expect(res.status).toBe(200);
    expect(mockAllocateProductPurchaseCosts).toHaveBeenCalledWith('o1');
    expect(res.body).toEqual({ ok: true, locked_kmf: 8000 });
    expect(mockInvalidateAllDashboards).toHaveBeenCalledTimes(1);
  });

  it('chemin erreur → 500 via next(err)', async () => {
    mockAllocateProductPurchaseCosts.mockRejectedValueOnce(new Error('lock failed'));
    const res = await request(app).post('/api/admin/costing/orders/o1/lock-purchase');
    expect(res.status).toBe(500);
    expect(mockInvalidateAllDashboards).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// POST /monthly-fixed/:yearMonth — chemin erreur
// ═══════════════════════════════════════════════════════════════════════
describe('admin-costing — POST /monthly-fixed/:yearMonth (erreur)', () => {
  it('chemin erreur → 500 via next(err)', async () => {
    mockAllocateMonthlyFixedCosts.mockRejectedValueOnce(new Error('boom'));
    const res = await request(app).post('/api/admin/costing/monthly-fixed/2026-06').send({});
    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// GET /recalibration-proposal — entièrement non testé avant ce lot
// ═══════════════════════════════════════════════════════════════════════
describe('admin-costing — GET /recalibration-proposal', () => {
  function mockCountsRow(overrides = {}) {
    return { orders_count: 0, items_count: 0, parcels_count: 0, shipments_count: 0, ...overrides };
  }

  it('periodDays défaut = 90 quand days absent/invalide, confidence=low si volumes faibles', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [mockCountsRow({ orders_count: 10, items_count: 20, parcels_count: 2, shipments_count: 0 })] })
      .mockResolvedValueOnce({ rows: [] }); // finance_config vide → current = {}

    const res = await request(app).get('/api/admin/costing/recalibration-proposal');
    expect(res.status).toBe(200);
    expect(res.body.based_on.period_days).toBe(90);
    expect(res.body.proposal.allocation_confidence).toBe('low');
    expect(res.body.current.allocation_confidence).toBeUndefined();
  });

  it('confidence=medium si orders>=50 et parcels>=10', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [mockCountsRow({ orders_count: 60, items_count: 120, parcels_count: 12, shipments_count: 1 })] })
      .mockResolvedValueOnce({ rows: [{}] });

    const res = await request(app).get('/api/admin/costing/recalibration-proposal');
    expect(res.body.proposal.allocation_confidence).toBe('medium');
  });

  it('confidence=high si orders>=200, parcels>=30, shipments>=5', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [mockCountsRow({ orders_count: 250, items_count: 500, parcels_count: 40, shipments_count: 6 })] })
      .mockResolvedValueOnce({ rows: [{}] });

    const res = await request(app).get('/api/admin/costing/recalibration-proposal');
    expect(res.body.proposal.allocation_confidence).toBe('high');
  });

  it('accepte un ?days= custom et calcule les moyennes / deltas contre la config actuelle', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [mockCountsRow({ orders_count: 30, items_count: 90, parcels_count: 5, shipments_count: 2 })] })
      .mockResolvedValueOnce({ rows: [{
        avg_articles_per_order: '2.5', avg_articles_per_parcel: '4', avg_articles_per_shipment: '3',
        avg_orders_per_month: '10', allocation_confidence: 'low', allocation_calibrated_at: '2026-01-01', allocation_notes: 'old',
      }] });

    const res = await request(app).get('/api/admin/costing/recalibration-proposal').query({ days: 30 });
    expect(res.status).toBe(200);
    expect(res.body.based_on.period_days).toBe(30);
    expect(res.body.proposal.avg_articles_per_order).toBe(3); // 90/30
    expect(res.body.delta.avg_articles_per_order).toBe(0.5); // 3 - 2.5
    expect(res.body.current.allocation_confidence).toBe('low');
  });

  it('chemin erreur → 500 via next(err)', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).get('/api/admin/costing/recalibration-proposal');
    expect(res.status).toBe(500);
  });

  it('fallback à 0 quand orders_count/items_count SQL sont null, et avg_articles_per_parcel/shipment=null si counts=0', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ orders_count: null, items_count: null, parcels_count: 0, shipments_count: 0 }] })
      .mockResolvedValueOnce({ rows: [{}] });

    const res = await request(app).get('/api/admin/costing/recalibration-proposal');
    expect(res.status).toBe(200);
    expect(res.body.based_on.orders_count).toBe(0);
    expect(res.body.based_on.items_count).toBe(0);
    expect(res.body.proposal.avg_articles_per_parcel).toBeNull();
    expect(res.body.proposal.avg_articles_per_shipment).toBeNull();
    // delta correspondantes restent null quand la proposition est null
    expect(res.body.delta.avg_articles_per_parcel).toBeNull();
    expect(res.body.delta.avg_articles_per_shipment).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// POST /recalibration-apply — complète le fichier existant
// ═══════════════════════════════════════════════════════════════════════
describe('admin-costing — POST /recalibration-apply (complément)', () => {
  it('applique allocation_notes seul (branche != null)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ allocation_notes: 'note ok' }] });

    const res = await request(app)
      .post('/api/admin/costing/recalibration-apply')
      .send({ avg_articles_per_order: 3, allocation_notes: 'note ok' });

    expect(res.status).toBe(200);
    const updateSql = mockQuery.mock.calls[0][0];
    expect(updateSql).toMatch(/allocation_notes/);
    expect(res.body.applied).toEqual({ allocation_notes: 'note ok' });
  });

  it('chemin erreur → 500 via next(err)', async () => {
    mockQuery.mockRejectedValueOnce(new Error('update failed'));
    const res = await request(app)
      .post('/api/admin/costing/recalibration-apply')
      .send({ avg_articles_per_order: 3 });
    expect(res.status).toBe(500);
  });

  // NOTE couverture : le fallback `req.body || {}` (L619) et la garde
  // `if (!FINANCE_CONFIG_NUMERIC_COLS.includes(key))` (L628) sont du code
  // défensif inatteignable par HTTP normal : express.json() renseigne
  // toujours req.body={} (jamais falsy), et `fields` est construit par
  // destructuration des 4 clés de l'allowlist elle-même — la branche "hors
  // allowlist" ne peut donc jamais être vraie tant que `fields` n'est pas
  // enrichi dynamiquement. Gap accepté (pas un bug, juste defensive code).
});
