'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => ({ query: jest.fn() }));

const mockMetrics = {
  getCAEncaisse: jest.fn(),
  getCmdsCreees: jest.fn(),
  getMargeConsolidee: jest.fn(),
};
jest.mock('../../services/dashboard-metrics', () => mockMetrics);

const db = require('../../db');
const commerce = require('../../services/dashboard-commerce');

const metric = (key, label, value, unit = 'count') => ({
  key,
  label,
  value,
  unit,
  delta: null,
  data_quality: { completeness: 'complete', items_total: null, items_with_data: null, warning: null },
  drill_to: null,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockMetrics.getCAEncaisse.mockResolvedValue(metric('ca_encaisse', 'CA encaissé', 120000, 'KMF'));
  mockMetrics.getCmdsCreees.mockResolvedValue(metric('cmds_creees', 'Commandes créées', 12));
  mockMetrics.getMargeConsolidee.mockResolvedValue(metric('marge_consolidee', 'Marge consolidée', 24500, 'KMF'));

  db.query
    .mockResolvedValueOnce({ rows: [{ value: '10000', items_total: '12' }] })
    .mockResolvedValueOnce({ rows: [{ product_ref: 'PRD-1', name: 'Téléphone', category: 'Électronique', quantity: '3', revenue_kmf: '90000' }] })
    .mockResolvedValueOnce({ rows: [{
      product_ref: 'PRD-1',
      product_name: 'Téléphone',
      category: 'Électronique',
      orders: '3',
      quantity: '3',
      revenue_kmf: '90000',
      estimated_cost_kmf: '54000',
      actual_orders: '2',
      actual_revenue_kmf: '60000',
      real_cost_kmf: '35000',
    }] })
    .mockResolvedValueOnce({ rows: [{ category: 'Électronique', orders: '3', quantity: '3', revenue_kmf: '90000' }] })
    .mockResolvedValueOnce({ rows: [{ created: '12', paid: '10', shipped: '8', available: '6', collected: '4', lost: '2' }] });
});

describe('dashboard-commerce', () => {
  test('normalise uniquement les périodes supportées', () => {
    expect(commerce.normalizePeriod('7')).toBe(7);
    expect(commerce.normalizePeriod('90')).toBe(90);
    expect(commerce.normalizePeriod('365')).toBe(30);
    expect(commerce.normalizePeriod('x')).toBe(30);
  });

  test('projection market-scoped injecte le market_id dans métriques et SQL', async () => {
    const now = new Date('2026-08-24T12:00:00.000Z');
    const market = { id: 'market-cm-id', code: 'CM', name: 'Cameroun', currency: 'XAF' };

    const result = await commerce.buildCommerce({ period: '30' }, { market, now });

    expect(result.scope).toEqual({
      mode: 'market',
      market: { code: 'CM', name: 'Cameroun', currency: 'XAF' },
    });
    expect(result.period).toBe(30);
    expect(result.data_quality).toMatchObject({
      scope_enforced: true,
      scope_mode: 'market',
      product_real_margin_basis: 'actual_cost_orders_only',
    });
    expect(JSON.stringify(result)).not.toContain('market-cm-id');

    for (const fn of [mockMetrics.getCAEncaisse, mockMetrics.getCmdsCreees, mockMetrics.getMargeConsolidee]) {
      expect(fn).toHaveBeenCalledWith(expect.objectContaining({
        market_id: 'market-cm-id',
        from: '2026-07-25T12:00:00.000Z',
        to: '2026-08-24T12:00:00.000Z',
      }));
    }

    expect(db.query).toHaveBeenCalledTimes(5);
    db.query.mock.calls.forEach(([sql, params]) => {
      expect(String(sql)).toContain('o.market_id =');
      expect(params).toContain('market-cm-id');
    });
    expect(result.kpis.map(item => item.key)).toEqual([
      'ca_encaisse', 'cmds_creees', 'panier_moyen', 'marge_consolidee',
    ]);
    expect(result.kpis[2].drill_to).toBe('/admin/operations?payment_status=paid');
    expect(result.kpis[3].unit).toBe('KMF');
    expect(result.top_products[0]).toEqual({
      product_ref: 'PRD-1', name: 'Téléphone', category: 'Électronique', quantity: 3, revenue_kmf: 90000,
    });
    expect(result.product_profitability[0]).toEqual(expect.objectContaining({
      product_ref: 'PRD-1',
      revenue_kmf: 90000,
      estimated_margin_kmf: 36000,
      consolidated_margin_kmf: 25000,
      actual_orders: 2,
      cost_coverage_pct: 66.7,
    }));
    expect(result.funnel.steps.map(step => step.pct)).toEqual([100, 83.3, 66.7, 50, 33.3]);
  });

  test('une rentabilité sans costing actual ne fabrique jamais de marge réelle', async () => {
    db.query.mockReset();
    db.query.mockResolvedValueOnce({ rows: [{
      product_ref: 'PRD-X',
      product_name: 'Produit X',
      category: 'Test',
      orders: '4',
      quantity: '4',
      revenue_kmf: '100000',
      estimated_cost_kmf: '60000',
      actual_orders: '0',
      actual_revenue_kmf: null,
      real_cost_kmf: null,
    }] });

    const rows = await commerce.getProductProfitability({ market_id: 'market-cm-id' });
    expect(rows[0]).toMatchObject({ estimated_margin_kmf: 40000, consolidated_margin_kmf: null, real_cost_kmf: null });
    expect(String(db.query.mock.calls[0][0])).toContain('o.market_id =');
    expect(db.query.mock.calls[0][1]).toContain('market-cm-id');
  });

  test('projection globale n’invente aucun market_id mais reste sous autorité serveur', async () => {
    const now = new Date('2026-08-24T12:00:00.000Z');
    const result = await commerce.buildCommerce({ period: '7' }, { now });

    expect(result.scope).toEqual({ mode: 'global', market: null });
    expect(result.data_quality).toMatchObject({ scope_enforced: true, scope_mode: 'global' });
    expect(mockMetrics.getCAEncaisse.mock.calls[0][0]).not.toHaveProperty('market_id');
    db.query.mock.calls.forEach(([sql, params]) => {
      expect(String(sql)).not.toContain('o.market_id =');
      expect(params).not.toContain('market-cm-id');
    });
  });
});
