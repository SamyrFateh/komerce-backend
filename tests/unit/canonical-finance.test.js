'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const schemaContract = require('../../public/dashboards/canonical/js/dashboard-schema');
const adminContextContract = require('../../public/dashboards/canonical/js/admin-context');
const finance = require('../../public/dashboards/canonical/js/finance');

function payloadFixture() {
  return {
    kpis: [
      { key: 'ca_encaisse', value: 120000, unit: 'KMF', data_quality: {} },
      { key: 'cout_reel', value: 70000, unit: 'KMF', data_quality: {} },
      { key: 'marge_consolidee', value: 50000, unit: 'KMF', data_quality: {} },
      { key: 'taux_completude_couts', value: 80, unit: '%', data_quality: { warning: '2 commandes incomplètes' } },
      { key: 'cmds_cout_incomplet', value: 2, unit: 'count', data_quality: {} },
      { key: 'paiements_en_attente', value: 1, unit: 'count', data_quality: {} },
      { key: 'remboursements', value: 1500, unit: 'KMF', data_quality: { warning: '2 remboursement(s) sur la période' } },
    ],
    costing_kpis: [
      { key: 'cout_estime', label: 'Coût estimé', value: 68000, unit: 'KMF', data_quality: { completeness: 'complete', items_total: 4, items_with_data: 4 } },
      { key: 'cout_reel', label: 'Coût réel', value: 70000, unit: 'KMF', data_quality: { completeness: 'partial', items_total: 4, items_with_data: 3, warning: 'Réel partiel' } },
      { key: 'marge_estimee', label: 'Marge estimée', value: 52000, unit: 'KMF', data_quality: { completeness: 'complete', items_total: 4, items_with_data: 4 } },
      { key: 'marge_variable_reelle', label: 'Marge variable réelle', value: 56000, unit: 'KMF', data_quality: { completeness: 'partial', items_total: 4, items_with_data: 3 } },
      { key: 'marge_consolidee', label: 'Marge consolidée', value: 50000, unit: 'KMF', data_quality: { completeness: 'partial', items_total: 4, items_with_data: 3 } },
    ],
    trend: [
      { bucket: '2026-08-18T00:00:00.000Z', paid_orders: 4, revenue_kmf: 120000, real_cost_kmf: 70000, consolidated_margin_kmf: 50000, actual_orders: 3, cost_coverage_pct: 75 },
    ],
    cost_families: [
      { cost_type: 'product_purchase', orders: 4, amount_kmf: 40000 },
    ],
    costing_orders: [
      { reference: 'CMD-C', sale_total_kmf: 20000, estimated_cost_kmf: 11000, real_cost_kmf: 12000, variance_kmf: 1000, consolidated_margin_kmf: 8000, cost_status: 'actual' },
    ],
    relay_profitability: [
      { relais_name: 'Relais Centre', orders: 4, revenue_kmf: 120000, estimated_margin_kmf: 50000, consolidated_margin_kmf: 38000, cost_coverage_pct: 75 },
    ],
    payment_mix: [
      { payment_mode: 'stripe_eur', orders: 3, total_kmf: 90000 },
      { payment_mode: 'cash_relais', orders: 1, total_kmf: 30000 },
    ],
    refunds: {
      count: 2,
      total_kmf: 1500,
      recent: [
        { order_reference: 'CMD-R', refund_method: 'stripe', amount_kmf: 1000, completed_at: '2026-08-23T00:00:00.000Z' },
      ],
    },
  };
}

function globalContext() {
  return {
    actor: { id: 'hq-admin', role: 'admin' },
    access: { mode: 'global', allowedMarkets: ['CM', 'CG'], defaultMarket: null, capabilities: ['dashboard.global.read'] },
  };
}

function marketContext() {
  return {
    actor: { id: 'operator-cm', role: 'admin' },
    access: { mode: 'market', allowedMarkets: ['CM'], defaultMarket: 'CM', capabilities: ['dashboard.market.read'] },
  };
}

describe('LOT 2F-CANON — Finance vivant', () => {
  test('le schéma Finance respecte DashboardSchema et couvre la rentabilité relais', () => {
    const schema = schemaContract.validateDashboardSchema(finance.FINANCE_SCHEMA);
    expect(schema.id).toBe('finance');
    expect(schema.metrics.source).toBe('finance.metrics');
    expect(schema.sections.map(section => section.source)).toEqual([
      'finance.trend',
      'finance.costing-summary',
      'finance.costing-orders',
      'finance.cost-families',
      'finance.relay-profitability',
      'finance.payment-mix',
      'finance.refunds',
    ]);
    expect(schema.drill.map(item => item.href)).toEqual([
      '/admin/workspaces/accounting',
      '/admin/workspaces/pricing',
    ]);
  });

  test('projette les données backend sans recalcul métier', () => {
    const sources = finance.resolveSources(payloadFixture());
    expect(sources['finance.metrics']['ca-encaisse'].value).toBe('120 000 KMF');
    expect(sources['finance.metrics'].completude).toEqual(expect.objectContaining({ value: '80 %', tone: 'warning' }));
    expect(sources['finance.trend'][0]).toEqual(expect.objectContaining({
      commandes: '4', ca: '120 000 KMF', cout: '70 000 KMF', marge: '50 000 KMF', couverture: '75 %',
    }));
    expect(sources['finance.costing-summary'][1]).toEqual(expect.objectContaining({
      indicateur: 'Coût réel', valeur: '70 000 KMF', couverture: '3/4', qualite: 'Réel partiel',
    }));
    expect(sources['finance.costing-orders'][0]).toEqual(expect.objectContaining({
      commande: 'CMD-C', costing: 'Réel complet', variance: '+1 000 KMF', marge: '8 000 KMF',
    }));
    expect(sources['finance.cost-families'][0]).toEqual({ famille: 'product_purchase', commandes: '4', montant: '40 000 KMF' });
    expect(sources['finance.relay-profitability'][0]).toEqual({
      relais: 'Relais Centre',
      commandes: '4',
      ca: '120 000 KMF',
      'marge-estimee': '50 000 KMF',
      'marge-reelle': '38 000 KMF',
      couverture: '75 %',
    });
    expect(sources['finance.payment-mix'][0]).toEqual({ mode: 'stripe_eur', commandes: '3', montant: '90 000 KMF' });
    expect(sources['finance.refunds'][0]).toEqual(expect.objectContaining({ commande: 'CMD-R', methode: 'stripe', montant: '1 000 KMF' }));
  });

  test('une marge réelle relais absente reste explicitement inconnue', () => {
    const sources = finance.resolveSources({ relay_profitability: [{ relais_name: 'R', orders: 1, revenue_kmf: 10000, estimated_margin_kmf: 1000, consolidated_margin_kmf: null, cost_coverage_pct: 0 }] });
    expect(sources['finance.relay-profitability'][0]['marge-reelle']).toBe('—');
  });

  test('résout la source uniquement depuis AdminContext', () => {
    expect(finance.endpointForContext(globalContext(), adminContextContract))
      .toBe('/api/admin/dashboard/finance');
    expect(finance.endpointForContext(marketContext(), adminContextContract))
      .toBe('/api/admin/dashboard/finance/market/CM');
    expect(finance.endpointForContext(globalContext(), adminContextContract, 'CG'))
      .toBe('/api/admin/dashboard/finance/market/CG');
    expect(() => finance.endpointForContext(marketContext(), adminContextContract, 'CG'))
      .toThrow(/autorisés par le serveur/);
  });

  test('mount marché charge directement Finance CM avec la période', async () => {
    const root = {};
    const render = jest.fn();
    const renderer = { createRenderer: jest.fn(() => ({ render })) };
    const fetch = jest.fn().mockResolvedValue({ ok: true, json: jest.fn().mockResolvedValue(payloadFixture()) });

    const result = await finance.mount({
      root,
      document: {},
      ui: {},
      fetch,
      renderer,
      adminContext: marketContext(),
      contextContract: adminContextContract,
      period: '7',
    });

    expect(fetch).toHaveBeenCalledWith(
      '/api/admin/dashboard/finance/market/CM?period=7',
      expect.objectContaining({ method: 'GET', credentials: 'include' })
    );
    expect(result.endpoint).toBe('/api/admin/dashboard/finance/market/CM');
    expect(result.period).toBe('7');
    expect(render).toHaveBeenNthCalledWith(1, root, finance.FINANCE_SCHEMA, expect.objectContaining({ state: 'loading' }));
    expect(render).toHaveBeenNthCalledWith(2, root, finance.FINANCE_SCHEMA, expect.objectContaining({
      data: expect.objectContaining({
        'finance.metrics': expect.any(Object),
        'finance.costing-orders': expect.any(Array),
        'finance.relay-profitability': expect.any(Array),
      }),
      filters: { period: '7' },
    }));
  });
});
