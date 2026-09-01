/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

'use strict';

const schemaContract = require('../../public/dashboards/canonical/js/dashboard-schema');
const adminContextContract = require('../../public/dashboards/canonical/js/admin-context');
const commerce = require('../../public/dashboards/canonical/js/commerce');

function payloadFixture() {
  return {
    period: 30,
    kpis: [
      { key: 'ca_encaisse', value: 120000, unit: 'KMF', data_quality: {} },
      { key: 'cmds_creees', value: 12, unit: 'count', data_quality: {} },
      { key: 'panier_moyen', value: 10000, unit: 'KMF', data_quality: {} },
      { key: 'marge_consolidee', value: 24500, unit: 'KMF', data_quality: {} },
    ],
    top_products: [
      { product_ref: 'PRD-1', name: 'Téléphone', category: 'Électronique', quantity: 3, revenue_kmf: 90000 },
    ],
    product_profitability: [
      { product_ref: 'PRD-1', name: 'Téléphone', category: 'Électronique', orders: 3, quantity: 3, revenue_kmf: 90000, estimated_margin_kmf: 36000, consolidated_margin_kmf: 25000, cost_coverage_pct: 66.7 },
    ],
    categories: [
      { category: 'Électronique', orders: 3, quantity: 3, revenue_kmf: 90000 },
    ],
    funnel: {
      steps: [
        { id: 'created', label: 'Commandes créées', count: 12, pct: 100 },
        { id: 'paid', label: 'Payées', count: 10, pct: 83.3 },
      ],
      lost: 2,
    },
  };
}

function globalContext() {
  return {
    actor: { id: 'hq-admin', role: 'admin' },
    access: {
      mode: 'global',
      allowedMarkets: ['CM', 'CG', 'KM'],
      defaultMarket: null,
      capabilities: ['pilotage.read', 'dashboard.market.read', 'dashboard.global.read'],
    },
  };
}

function marketContext() {
  return {
    actor: { id: 'operator-cm', role: 'admin' },
    access: {
      mode: 'market',
      allowedMarkets: ['CM'],
      defaultMarket: 'CM',
      capabilities: ['pilotage.read', 'dashboard.market.read'],
    },
  };
}

describe('LOT 2D-CANON — Commerce vivant', () => {
  test('le schéma Commerce respecte DashboardSchema V1', () => {
    const schema = schemaContract.validateDashboardSchema(commerce.COMMERCE_SCHEMA);
    expect(schema.id).toBe('commerce');
    expect(schema.filters[0].key).toBe('period');
    expect(schema.metrics.source).toBe('commerce.metrics');
    expect(schema.sections.map(section => section.source)).toEqual([
      'commerce.top-products',
      'commerce.product-profitability',
      'commerce.categories',
      'commerce.funnel',
    ]);
  });

  test('projette le payload backend sans recalcul métier', () => {
    const sources = commerce.resolveSources(payloadFixture());

    expect(sources['commerce.metrics']['ca-encaisse'].value).toContain('KMF');
    expect(sources['commerce.metrics']['commandes'].value).toBe('12');
    expect(sources['commerce.metrics'].marge.value).toContain('KMF');
    expect(sources['commerce.top-products'][0]).toEqual({
      produit: 'Téléphone',
      categorie: 'Électronique',
      quantite: '3',
      ca: expect.stringContaining('KMF'),
    });
    expect(sources['commerce.product-profitability'][0]).toEqual({
      produit: 'Téléphone',
      categorie: 'Électronique',
      commandes: '3',
      ca: '90 000 KMF',
      marge_estimee: '36 000 KMF',
      marge_reelle: '25 000 KMF',
      couverture: '66,7 %',
    });
    expect(sources['commerce.funnel'][1]).toEqual({
      etape: 'Payées',
      commandes: '10',
      taux: '83,3 %',
    });
  });

  test('une marge réelle absente reste explicitement inconnue', () => {
    const sources = commerce.resolveSources({ product_profitability: [{ name: 'X', orders: 2, revenue_kmf: 10000, estimated_margin_kmf: 2000, consolidated_margin_kmf: null, cost_coverage_pct: 0 }] });
    expect(sources['commerce.product-profitability'][0].marge_reelle).toBe('—');
  });

  test('résout l’endpoint uniquement depuis AdminContext', () => {
    expect(commerce.endpointForContext(globalContext(), adminContextContract))
      .toBe('/api/admin/dashboard/commerce');
    expect(commerce.endpointForContext(marketContext(), adminContextContract))
      .toBe('/api/admin/dashboard/commerce/market/CM');
    expect(commerce.endpointForContext(globalContext(), adminContextContract, 'CG'))
      .toBe('/api/admin/dashboard/commerce/market/CG');
    expect(() => commerce.endpointForContext(marketContext(), adminContextContract, 'CG'))
      .toThrow(/autorisés par le serveur/);
  });

  test('mount market charge directement la source CM avec période 30j', async () => {
    const root = {};
    const render = jest.fn();
    const renderer = { createRenderer: jest.fn(() => ({ render })) };
    const fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue(payloadFixture()),
    });

    const result = await commerce.mount({
      root,
      document: {},
      ui: {},
      fetch,
      renderer,
      adminContext: marketContext(),
      contextContract: adminContextContract,
    });

    expect(fetch).toHaveBeenCalledWith(
      '/api/admin/dashboard/commerce/market/CM?period=30',
      expect.objectContaining({ method: 'GET', credentials: 'include' })
    );
    expect(result.endpoint).toBe('/api/admin/dashboard/commerce/market/CM');
    expect(result.period).toBe('30');
    expect(render).toHaveBeenNthCalledWith(1, root, commerce.COMMERCE_SCHEMA, expect.objectContaining({ state: 'loading' }));
    expect(render).toHaveBeenNthCalledWith(2, root, commerce.COMMERCE_SCHEMA, expect.objectContaining({
      filters: { period: '30' },
      data: expect.objectContaining({ 'commerce.metrics': expect.any(Object) }),
    }));
  });

  test('période non supportée retombe sur 30 jours', () => {
    expect(commerce.normalizePeriod('7')).toBe('7');
    expect(commerce.normalizePeriod('90')).toBe('90');
    expect(commerce.normalizePeriod('365')).toBe('30');
  });
});
