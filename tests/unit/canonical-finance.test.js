'use strict';

const fs = require('fs');
const path = require('path');

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const schemaContract = require('../../public/dashboards/canonical/js/dashboard-schema');
const adminContextContract = require('../../public/dashboards/canonical/js/admin-context');
const finance = require('../../public/dashboards/canonical/js/finance');
const financeDecision = require('../../public/dashboards/canonical/js/finance-decision');

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
    supplier_payment_review: {
      count: 2,
      truncated: false,
      basis: 'current_state_all_time',
      items: [
        {
          purchase_order_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          provider: 'cj',
          expected_amount: '19.9900',
          observed_amount: null,
          currency: 'USD',
          status: 'ambiguous',
          reconciliation_status: 'unverified',
          real_debit_verified: false,
          review_reason: 'PAYMENT_AMBIGUOUS_RECONCILIATION_REQUIRED',
          updated_at: '2026-10-05T00:00:00.000Z',
          drill_to: '/admin/workspaces/purchasing?po=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        },
        {
          purchase_order_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          provider: 'aliexpress',
          expected_amount: '88.0000',
          observed_amount: '90.0000',
          currency: 'CNY',
          status: 'succeeded',
          reconciliation_status: 'mismatched',
          real_debit_verified: false,
          review_reason: 'PAYMENT_RECONCILIATION_MISMATCH',
          updated_at: '2026-10-05T01:00:00.000Z',
          drill_to: '/admin/workspaces/purchasing?po=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        },
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
    expect(schema.description).toMatch(/marge est fiable/i);
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
    expect(sources['finance.supplier-payment-review'][0]).toEqual(expect.objectContaining({
      po: 'aaaaaaaa',
      provider: 'cj',
      expected: '19.9900 USD',
      observed: '—',
      status: 'ambiguous',
      reconciliation: 'unverified',
      real_debit_verified: 'Non',
      review_reason: 'PAYMENT_AMBIGUOUS_RECONCILIATION_REQUIRED',
    }));
  });

  test('la couche decision-first Finance ne fabrique ni seuil de variance ni rapprochement', () => {
    const payload = payloadFixture();
    const decisions = financeDecision.decisionItems(payload, finance);

    expect(decisions.map(item => item.label)).toEqual([
      'Paiements en attente',
      'Coûts incomplets',
      'Variances observées',
      'Paiements fournisseur à revoir',
      'Remboursements période',
    ]);
    expect(decisions.some(item => /variances élevées|à suivre|non rapprochés/i.test(item.label))).toBe(false);

    expect(financeDecision.headlineMetrics(payload, finance).map(item => item.key)).toEqual([
      'ca-encaisse', 'cout-reel', 'marge', 'completude',
    ]);
    expect(financeDecision.overviewCards(payload, finance)).toHaveLength(4);
    expect(financeDecision.completenessProgress(payload, finance)[0]).toEqual({
      label: 'Complétude des coûts',
      value: '80 %',
      percent: 80,
      tone: 'warning',
      helper: '2 commandes incomplètes',
    });
    expect(financeDecision.trendItems(payload, finance)[0]).toEqual(expect.objectContaining({
      value: '75 %',
      helper: expect.stringContaining('120 000 KMF'),
    }));
    expect(financeDecision.costingItems(payload, finance)[1]).toEqual(expect.objectContaining({
      title: 'Coût réel',
      value: '70 000 KMF',
      tone: 'warning',
    }));
    expect(financeDecision.varianceItems(payload, finance)[0]).toEqual(expect.objectContaining({
      title: 'CMD-C',
      value: '+1 000 KMF',
      tone: 'neutral',
    }));
    expect(financeDecision.paymentItems(payload, finance)[0]).toEqual(expect.objectContaining({
      title: 'stripe_eur',
      value: '90 000 KMF',
    }));
    expect(financeDecision.relayItems(payload, finance)[0]).toEqual(expect.objectContaining({
      title: 'Relais Centre',
      tone: 'warning',
    }));
    expect(financeDecision.refundItems(payload, finance)[0]).toEqual(expect.objectContaining({
      title: 'CMD-R',
      value: '1 000 KMF',
    }));
    expect(financeDecision.drillCards(finance, { role: 'admin' })).toHaveLength(2);
  });

  test('la file fournisseur garde statut, rapprochement et preuve de débit distincts, sans somme multi-devise', () => {
    const payload = payloadFixture();
    const items = financeDecision.supplierPaymentReviewItems(payload, finance);

    expect(items).toHaveLength(2);
    expect(items[0]).toEqual(expect.objectContaining({
      title: 'cj · PO aaaaaaaa',
      helper: expect.stringContaining('ambiguous · rapprochement unverified'),
      value: 'attendu 19.9900 USD · observé —',
      tone: 'warning',
    }));
    expect(items[0].helper).toContain('débit réel prouvé non');
    expect(items[1]).toEqual(expect.objectContaining({
      title: 'aliexpress · PO bbbbbbbb',
      helper: expect.stringContaining('succeeded · rapprochement mismatched'),
      value: 'attendu 88.0000 CNY · observé 90.0000 CNY',
      tone: 'critical',
    }));
    expect(items.some(item => /USD.*CNY|CNY.*USD/.test(item.value))).toBe(false);

    const decisions = financeDecision.decisionItems(payload, finance);
    expect(decisions.find(item => item.key === 'supplier-payments-review')).toEqual(expect.objectContaining({
      value: '2',
      href: '#finance-supplier-payments',
    }));
  });

  test('les cartes de décision utilisent le drill_to serveur quand il existe, jamais une ancre partagée par défaut', () => {
    const payload = payloadFixture();
    payload.kpis = payload.kpis.map(item => (item.key === 'paiements_en_attente'
      ? { ...item, drill_to: '/admin/orders' }
      : item));
    const decisions = financeDecision.decisionItems(payload, finance);
    const pending = decisions.find(item => item.key === 'payments-pending');
    expect(pending.href).toBe('/admin/orders');
  });

  test('sans drill_to backend, repli sur l’ancre locale (jamais un lien cassé)', () => {
    const payload = payloadFixture();
    const decisions = financeDecision.decisionItems(payload, finance);
    const pending = decisions.find(item => item.key === 'payments-pending');
    expect(pending.href).toBe('#finance-kpis');
  });

  test('incompleteCostOrderItems projette les commandes réelles à coût incomplet, jamais les métriques de qualité coût/marge', () => {
    const payload = payloadFixture();
    payload.incomplete_cost_orders = [
      { reference: 'CMD-I1', status: 'confirmed', payment_status: 'paid', total_kmf: 5000, created_at: '2026-08-20T00:00:00.000Z' },
    ];
    const items = financeDecision.incompleteCostOrderItems(payload, finance);
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual(expect.objectContaining({ title: 'CMD-I1', value: finance.formatKmf(5000) }));
  });

  test('varianceItems exclut les commandes à variance nulle — correspondance exacte avec le compte du bandeau de décision', () => {
    const payload = payloadFixture();
    payload.costing_orders = [
      ...payload.costing_orders,
      { reference: 'CMD-ZERO', sale_total_kmf: 10000, estimated_cost_kmf: 6000, real_cost_kmf: 6000, variance_kmf: 0, consolidated_margin_kmf: 4000, cost_status: 'actual' },
    ];
    const items = financeDecision.varianceItems(payload, finance);
    expect(items.map(item => item.title)).toEqual(['CMD-C']);
    expect(items.map(item => item.title)).not.toContain('CMD-ZERO');
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
      user: { role: 'admin' },
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

describe('Finance — vérité d’affichage', () => {
  test('la file de revue fournisseur absente est signalée « non disponible », pas masquée', () => {
    expect(financeDecision.supplierReviewState({}).state).toBe('not-provided');
    expect(financeDecision.supplierReviewState({ supplier_payment_review: null }).message).toMatch(/Non disponible/);
    expect(financeDecision.supplierReviewState({ supplier_payment_review: { items: [] } }).state).toBe('empty');
    expect(financeDecision.supplierReviewState({ supplier_payment_review: { items: [{}] } }).state).toBe('rows');
  });

  test('marge : consolidée (réelle) d’abord, estimée explicitement non définitive ; consolidée nulle = « — », jamais 0', () => {
    const payload = { kpis: [
      { key: 'marge_consolidee', label: 'Marge consolidée', value: null, unit: 'KMF' },
      { key: 'marge_estimee', label: 'Marge estimée', value: 12000, unit: 'KMF' },
    ] };
    const card = financeDecision.overviewCards(payload, finance).find(item => item.key === 'margin');
    expect(card.metrics.map(metric => metric.label)).toEqual(['Marge consolidée (réelle)', 'Marge estimée — non définitive']);
    expect(card.metrics[0].value).not.toMatch(/^0/);
  });
});



test('Finance overview garde uniquement Hero + décisions + situation financière', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical', 'js', 'finance-decision.js'),
    'utf8'
  );
  const start = source.indexOf('function render(rootNode');
  const renderSource = source.slice(start, source.indexOf('function enhance', start));
  expect(renderSource).toContain("data-dashboard-role', 'hero");
  expect(renderSource).toContain("data-dashboard-role', 'attention");
  expect(renderSource).toContain("data-dashboard-role', 'primary");
  expect(renderSource).toContain("'Situation financière'");
  expect(renderSource).toContain("'Paiements fournisseurs à revoir'");
  expect(renderSource).not.toContain("'Coûts incomplets'");
  expect(renderSource).not.toContain("'Variances observées'");
  expect(renderSource).not.toContain("'Trajectoire financière'");
  expect(renderSource).not.toContain("'Approfondir'");
  expect(renderSource).not.toContain("TrustFooter.render");
});
