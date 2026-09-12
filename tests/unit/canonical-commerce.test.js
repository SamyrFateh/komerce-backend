/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

'use strict';

const schemaContract = require('../../public/dashboards/canonical/js/dashboard-schema');
const adminContextContract = require('../../public/dashboards/canonical/js/admin-context');
const commerce = require('../../public/dashboards/canonical/js/commerce');
const commerceDecision = require('../../public/dashboards/canonical/js/commerce-decision');

function payloadFixture() {
  return {
    period: 30,
    scope: { mode: 'market', market: { code: 'CM', name: 'Cameroun', currency: 'XAF' } },
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
    product_viability: [
      {
        product_ref: 'PRD-1', name: 'Téléphone', category: 'Électronique', quantity: 3, revenue_kmf: 90000,
        status: 'VIABLE_UNDER_CONDITIONS', label: 'Viable sous conditions',
        reason: 'La cible marché exige une meilleure condition de sourcing.',
        sourcing_action: 'RENEGOTIATE_OR_REPOSITION', market_confidence: 'high',
        purchase_cost_gap_to_safe_ceiling_kmf: -2000,
      },
    ],
    product_availability: [
      {
        product_ref: 'PRD-1', name: 'Téléphone', category: 'Électronique', quantity: 3, revenue_kmf: 90000,
        state: 'LOCAL_EXPOSED_UNAVAILABLE', commercial_exposure: 'ENABLED', authority: 'LOCAL_STOCK',
      },
    ],
    decision_signals: [
      {
        key: 'best-seller-local-unavailable:PRD-1', kind: 'best_seller_local_unavailable', severity: 'warning',
        label: 'Best-seller sans disponibilité immédiate',
        helper: 'Téléphone · stock local exposé sans unité immédiatement disponible ; l’import peut rester disponible.',
        value: 'Téléphone', product_ref: 'PRD-1', source: 'local_stock_service',
        destination: { kind: 'market_catalog', market_code: 'CM', product_ref: 'PRD-1' },
      },
      {
        key: 'sku-viability:PRD-1', kind: 'sku_viable_under_conditions', severity: 'warning',
        label: 'SKU à renégocier / repositionner', helper: 'Téléphone · La cible marché exige une meilleure condition de sourcing.',
        value: 'Téléphone', product_ref: 'PRD-1', source: 'pricing_market_corridor',
        destination: { kind: 'pricing_workspace', market_code: 'CM', product_ref: 'PRD-1' },
      },
      {
        key: 'orders-lost', kind: 'orders_lost', severity: 'critical', label: 'Commandes perdues',
        helper: 'Perte explicitement remontée par le funnel', value_count: 2,
        destination: { kind: 'commerce_funnel' },
      },
      {
        key: 'profitability-incomplete', kind: 'costing_incomplete', severity: 'warning', label: 'Costing incomplet',
        helper: 'Produits sans marge réelle complète', value_count: 1,
        destination: { kind: 'commerce_profitability' },
      },
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
    data_quality: { warnings: [], decision_authority: 'server' },
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
      'marge-estimee': '36 000 KMF',
      'marge-reelle': '25 000 KMF',
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
    expect(sources['commerce.product-profitability'][0]['marge-reelle']).toBe('—');
  });

  test('la couche decision-first consomme la priorité serveur avec CTA Catalogue pays et Atelier', () => {
    const payload = payloadFixture();
    const decisions = commerceDecision.decisionItems(payload, commerce);

    expect(decisions.map(item => item.label)).toEqual([
      'Best-seller sans disponibilité immédiate',
      'SKU à renégocier / repositionner',
      'Commandes perdues',
      'Costing incomplet',
    ]);
    expect(decisions[0]).toMatchObject({
      tone: 'warning',
      value: 'Téléphone',
      href: '/dashboards/canonical/market-catalog.html?market=CM',
      actionLabel: 'Voir le Catalogue pays →',
    });
    expect(decisions[1]).toMatchObject({
      tone: 'warning',
      value: 'Téléphone',
      href: '/admin/workspaces/pricing?market=CM',
      actionLabel: 'Ouvrir l’Atelier →',
    });
    expect(decisions.some(item => /rupture|prix à recalibrer|conversion|aujourd/i.test(item.label))).toBe(false);

    expect(commerceDecision.metricItems(payload, commerce)).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'commandes-perdues', value: '2' }),
    ]));
    expect(commerceDecision.rankedCategories(payload, commerce)[0]).toEqual(expect.objectContaining({
      title: 'Électronique',
      value: '90 000 KMF',
    }));
    expect(commerceDecision.rankedProducts(payload, commerce)[0]).toEqual(expect.objectContaining({
      title: 'Téléphone',
      value: '90 000 KMF',
    }));
    expect(commerceDecision.viabilityItems(payload, commerce)[0]).toEqual(expect.objectContaining({
      title: 'Téléphone',
      tone: 'warning',
      value: 'Écart sourcing -2 000 KMF',
    }));
    expect(commerceDecision.funnelStages(payload, commerce)[1]).toEqual({
      label: 'Payées',
      value: '10',
      rate: '83,3 %',
    });
    expect(commerceDecision.profitabilityItems(payload, commerce)[0]).toEqual(expect.objectContaining({
      title: 'Téléphone',
      tone: 'warning',
    }));
  });

  test('un signal serveur de marge négative garde sa valeur et sa sévérité', () => {
    const payload = payloadFixture();
    payload.decision_signals = [{
      key: 'negative-margin', kind: 'negative_margin', severity: 'critical',
      label: 'Marge négative', helper: 'Marge consolidée de la période', value_kmf: -5000,
    }];
    const decisions = commerceDecision.decisionItems(payload, commerce);
    expect(decisions).toEqual([
      expect.objectContaining({ label: 'Marge négative', tone: 'critical', value: '-5 000 KMF' }),
    ]);
  });

  test('sans nouveau contrat serveur, le fallback historique reste strictement projection-only', () => {
    const payload = payloadFixture();
    delete payload.decision_signals;
    payload.kpis = payload.kpis.map(item => item.key === 'marge_consolidee' ? { ...item, value: -5000 } : item);
    const decisions = commerceDecision.decisionItems(payload, commerce);
    expect(decisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Marge négative', tone: 'critical', value: '-5 000 KMF' }),
    ]));
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
      user: { role: 'admin' },
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