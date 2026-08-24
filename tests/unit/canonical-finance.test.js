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
    incomplete_cost_orders: [
      { reference: 'CMD-C', status: 'confirmed', payment_status: 'paid', total_kmf: 20000, created_at: '2026-08-20T00:00:00.000Z' },
    ],
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
  test('le schéma Finance respecte DashboardSchema', () => {
    const schema = schemaContract.validateDashboardSchema(finance.FINANCE_SCHEMA);
    expect(schema.id).toBe('finance');
    expect(schema.metrics.source).toBe('finance.metrics');
    expect(schema.sections.map(section => section.source)).toEqual([
      'finance.payment-mix',
      'finance.refunds',
      'finance.incomplete-costs',
    ]);
  });

  test('projette les données backend sans recalcul métier', () => {
    const sources = finance.resolveSources(payloadFixture());
    expect(sources['finance.metrics']['ca-encaisse'].value).toBe('120 000 KMF');
    expect(sources['finance.metrics'].completude).toEqual(expect.objectContaining({ value: '80 %', tone: 'warning' }));
    expect(sources['finance.payment-mix'][0]).toEqual({ mode: 'stripe_eur', commandes: '3', montant: '90 000 KMF' });
    expect(sources['finance.refunds'][0]).toEqual(expect.objectContaining({ commande: 'CMD-R', methode: 'stripe', montant: '1 000 KMF' }));
    expect(sources['finance.incomplete-costs'][0]).toEqual(expect.objectContaining({ commande: 'CMD-C', montant: '20 000 KMF' }));
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
      data: expect.objectContaining({ 'finance.metrics': expect.any(Object) }),
      filters: { period: '7' },
    }));
  });
});
