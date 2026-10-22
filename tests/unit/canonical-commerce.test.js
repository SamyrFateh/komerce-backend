/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

'use strict';

const fs = require('fs');
const path = require('path');

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
      { key: 'produits_actifs_vendus', value: 8, unit: 'count', data_quality: {} },
      { key: 'quantites_vendues', value: 14, unit: 'count', data_quality: {} },
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
        key: 'orders-lost', kind: 'orders_lost', severity: 'critical', label: 'Commandes annulées ou remboursées',
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
    expect(schema.description).toMatch(/rythme/i);
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
    expect(sources['commerce.metrics']['produits-actifs-vendus'].value).toBe('8');
    expect(sources['commerce.metrics']['quantites-vendues'].value).toBe('14');
    expect(commerce.COMMERCE_SCHEMA.metrics.pick.map(x => x.key)).toEqual([
      'ca-encaisse', 'commandes', 'panier-moyen', 'quantites-vendues',
    ]);
    // marge_consolidee reste dans le payload brut (le fallback historique de
    // decisionItems en a besoin, cf. test plus bas), mais n'est plus une
    // clé affichée dans la bande KPI — KPI_KEYS ne la mappe plus.
    expect(sources['commerce.metrics'].marge).toBeUndefined();
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

  test('CM : les KPI et les classements affichent explicitement XAF sans effacer KMF', () => {
    const payload = payloadFixture();
    payload.kpis[0] = { ...payload.kpis[0], value: 170000, unit: 'XAF' };
    payload.kpis[2] = { ...payload.kpis[2], value: 14167, unit: 'XAF' };
    payload.top_products[0].revenue_display = { value: 119000, unit: 'XAF', base_currency: 'KMF' };
    payload.categories[0].revenue_display = { value: 119000, unit: 'XAF', base_currency: 'KMF' };
    const metrics = commerce.projectMetrics(payload);
    expect(metrics['ca-encaisse'].value).toContain('XAF');
    expect(metrics['panier-moyen'].value).toContain('XAF');
    expect(commerceDecision.metricItems(payload, commerce).find(item => item.key === 'ca-encaisse').label).toBe('Ventes payées');
    expect(commerceDecision.rankedProducts(payload, commerce)[0].value).toContain('XAF');
    expect(commerce.projectTopProducts(payload)[0].ca).toContain('XAF');
    expect(commerce.projectCategories(payload)[0].ca).toContain('XAF');
    expect(commerce.projectProductProfitability(payload)[0].ca).toContain('KMF');
    expect(payload.top_products[0].revenue_kmf).toBe(90000);
  });

  test('KMF : la devise reste explicite sur les montants commerciaux', () => {
    const payload = payloadFixture();
    expect(commerce.projectMetrics(payload)['ca-encaisse'].value).toContain('KMF');
    expect(commerceDecision.rankedProducts(payload, commerce)[0].value).toContain('KMF');
    expect(commerce.formatMoney(null, 'XAF')).toBe('—');
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
      'Commandes annulées ou remboursées',
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
    expect(decisions.some(item => item.href === '#commerce-profitability')).toBe(false);
    expect(decisions.find(item => item.key === 'orders-lost').href).toBe('#commerce-funnel');

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

test('commerce : la frontière Commerce / Commandes & logistique est énoncée dans le sous-titre', () => {
  expect(commerce.COMMERCE_SCHEMA.description).toContain('Ce qui se vend');
});



test('Commerce overview garde la vérité des quatre KPI, le funnel et expose les classements serveur', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical', 'js', 'commerce-decision.js'),
    'utf8'
  );
  expect(source).toContain("data-dashboard-role', 'hero");
  expect(source).toContain("data-dashboard-role', 'attention");
  expect(source).toContain("data-dashboard-role', 'primary");
  expect(source).toContain("'Activité commerciale'");
  expect(source).toContain("'Parcours des commandes'");
  expect(source).toContain("funnelHost.id = 'commerce-funnel'");
  expect(source).toContain("'Top produits'");
  expect(source).toContain("'Répartition par catégorie'");
  expect(source).toContain("data-dashboard-role', 'secondary");
  expect(source).toContain('const top = rankedProducts(payload, base);');
  expect(source).toContain('const categories = rankedCategories(payload, base);');
  expect(source).not.toContain('rankedProducts(payload, base).slice(0, 3)');
  expect(source).toContain('Aucune ligne produit payée sur la période sélectionnée.');
  expect(source).toContain('Aucune catégorie vendue sur la période sélectionnée.');
  expect(source).toContain('payload.simulation.scope');
  expect(source).toContain('faits simulés, pas une activité réelle');
  expect(source).toContain("dashboard.setAttribute('data-simulation-scope'");

  expect(source).not.toContain("'Viabilité des meilleures ventes'");
  expect(source).not.toContain("'Rentabilité produits'");
  expect(source).not.toContain("TrustFooter.render");
});

describe('L3 — périmètre de recette affiché (Commerce)', () => {
  test('Commerce : libellé faits simulés', () => {
    const t = commerceDecision.trust({ simulation: { scope: 'RCT1', label: 'Périmètre de recette RCT1 : faits simulés' } }, { formatNumber: (n) => String(n) });
    expect(t.stateLabel).toBe('Recette RCT1 — faits simulés');
    expect(t.simulationLabel).toMatch(/faits simulés/);
  });
});

describe('L3 — périmètre de recette transmis depuis l’URL de la page (commerce)', () => {
  const run = async (search) => {
    const fetch = jest.fn().mockResolvedValue({ ok: true, json: jest.fn().mockResolvedValue(payloadFixture()) });
    await commerce.mount({ root: {}, document: {}, ui: {}, fetch, renderer: { createRenderer: () => ({ render: jest.fn() }) },
      adminContext: marketContext(), contextContract: adminContextContract, user: { role: 'admin' }, location: { search } });
    return fetch.mock.calls[0][0];
  };
  test('périmètre valide transmis ; invalide ou absent ignoré (activité réelle)', async () => {
    expect(await run('?simulation_scope=RCT1')).toBe('/api/admin/dashboard/commerce/market/CM?period=30&simulation_scope=RCT1');
    expect(await run("?simulation_scope=rct1'--")).toBe('/api/admin/dashboard/commerce/market/CM?period=30');
    expect(await run('')).toBe('/api/admin/dashboard/commerce/market/CM?period=30');
  });
  test('la période de l’URL est reprise (valide) ou ignorée (invalide) via la navigation partagée', async () => {
    jest.isolateModules(() => require('../../public/dashboards/canonical/js/navigation-policy-v4.js'));
    try {
      expect(await run('?period=90')).toBe('/api/admin/dashboard/commerce/market/CM?period=90');
      expect(await run('?period=15&simulation_scope=RCT1')).toBe('/api/admin/dashboard/commerce/market/CM?period=30&simulation_scope=RCT1');
    } finally {
      delete global.KomerceCanonicalNavigation;
    }
  });
});

test('Commerce : panel produits et catégories ne dérivent pas de montant de commande ni de tendances imaginaires', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'public/dashboards/canonical/js/commerce-decision.js'), 'utf8');
  expect(source).toContain('Les cinq meilleures lignes produit et les catégories viennent DIRECTEMENT');
  expect(source).toContain('transport et remises');
  const fixture = payloadFixture();
  fixture.top_products = Array.from({ length:5 }, (_, i) => ({
    name:'Produit '+(i+1), category:'Test', quantity:i+1, revenue_kmf:1000*(i+1),
  }));
  expect(commerceDecision.rankedProducts(fixture, commerce)).toHaveLength(5);
  fixture.top_products = [];
  fixture.categories = [];
  expect(commerceDecision.rankedProducts(fixture, commerce)).toEqual([]);
  expect(commerceDecision.rankedCategories(fixture, commerce)).toEqual([]);
  expect(source).not.toContain("data-dashboard-role', 'tertiary");
});

describe('Commerce — top produits cliquables vers la fiche Produit 360', () => {
  afterEach(() => { delete globalThis.location; delete globalThis.KomerceCanonicalNavigation; });

  test('le lien porte le retour vers Commerce avec marché et période ; sans product_ref, pas de lien', () => {
    jest.resetModules();
    globalThis.location = { pathname: '/admin/commerce', search: '?market=KM&period=7' };
    require('../../public/dashboards/canonical/js/navigation-policy-v4.js');
    const decision = require('../../public/dashboards/canonical/js/commerce-decision');
    const base = { formatNumber: v => String(v), formatKmf: v => `${v} KMF`, formatMoney: (v, u) => `${v} ${u}` };
    const rows = decision.rankedProducts({ top_products: [
      { product_ref: 'PRD-1', name: 'A', quantity: 2, revenue_kmf: 100 },
      { name: 'B', quantity: 1, revenue_kmf: 50 },
    ] }, base);
    const url = new URL(rows[0].href, 'http://x.test');
    expect(url.pathname).toBe('/admin/products/PRD-1');
    expect(url.searchParams.get('return_to')).toBe('/admin/commerce?market=KM&period=7');
    expect(url.searchParams.get('return_label')).toBe('Retour au commerce');
    expect(rows[1].href).toBeUndefined();
  });
  test('série peu dense : un seul jour = un libellé d’axe, une note, jamais un bloc plein sans explication', () => {
    const one = commerceDecision.salesSeriesBars({ sales_series: [{ day: '2026-10-17', sales_kmf: 25000, orders: 1 }] }, commerce);
    expect(commerceDecision.salesSeriesAxis(one)).toEqual(['17/10']);
    expect(commerceDecision.salesSeriesNote(one)).toMatch(/Un seul jour avec des ventes payées \(17\/10\)/);
    const many = commerceDecision.salesSeriesBars({ sales_series: ['01', '02', '03', '04'].map(d => ({ day: `2026-10-${d}`, sales_kmf: 1000, orders: 1 })) }, commerce);
    expect(commerceDecision.salesSeriesAxis(many)).toEqual(['01/10', '04/10']);
    expect(commerceDecision.salesSeriesNote(many)).toBeNull();
    expect(commerceDecision.salesSeriesAxis([])).toEqual([]);
  });
  test('série, répartition par marché et dernières commandes : valeurs serveur dessinées telles quelles', () => {
    const p = {
      sales_series: [{ day: '2026-08-20', sales_kmf: 50000, orders: 5 }, { day: '2026-08-22', sales_kmf: 100000, orders: 9 }],
      sales_by_market: [{ market_code: 'CM', market_name: 'Cameroun', sales_kmf: 90000, share_pct: 75 }, { market_code: 'CG', market_name: 'Congo', sales_kmf: 30000, share_pct: null }],
      recent_orders: [{ reference: 'CMD-1', created_at: '2026-08-23T10:00:00Z', status: 'confirmed', total_kmf: null, market_code: null, client_name: null }],
    };
    const bars = commerceDecision.salesSeriesBars(p, commerce);
    expect(bars.map(b => b.heightPct)).toEqual([50, 100]);
    expect(bars[0].label).toBe('20/08');
    const shares = commerceDecision.marketShares(p, commerce);
    expect(shares.map(m => m.share)).toEqual([75, null]);
    const [row] = commerceDecision.recentOrderRows(p, commerce);
    expect(row).toMatchObject({ reference: 'CMD-1', market: '—', client: '—', amount: 'Non disponible' });
    expect(commerceDecision.salesSeriesBars({}, commerce)).toEqual([]);
  });
});
