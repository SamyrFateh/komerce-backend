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
      { reference: 'CMD-C', market_code: 'KM', status: 'collected', sale_total_kmf: 20000, estimated_cost_kmf: 11000, real_cost_kmf: 12000, variance_kmf: 1000, consolidated_margin_kmf: 8000, cost_status: 'actual',
        variance: { class: 'overrun', reason: null, cost_variance_kmf: 1000, margin_variance_kmf: -1000, estimated_variable_kmf: 11000, real_variable_kmf: 12000, scope: 'N1+paiement',
          components: [{ type: 'freight', label: 'Fret', state: 'confirmed', estimated_kmf: 1000, real_kmf: 2000, delta_kmf: 1000, owner: { label: 'Expéditions & Douane', href: '/admin/workspaces/shipping-customs' } }] } },
    ],
    variance_summary: {
      orders_considered: 3, scope: 'N1+paiement',
      overrun: { orders: 1, amount_kmf: 1000 }, saving: { orders: 0, amount_kmf: 0 },
      provisional: { orders: 1, amount_kmf: -500 }, not_comparable: { orders: 1, amount_kmf: null }, none: { orders: 0, amount_kmf: 0 },
    },
    margin_scope: {
      paid_orders: 5, eligible_orders: 2, eligible_references: ['CMD-C', 'CMD-D'],
      excluded: [{ reason: 'not_final_stage', label: 'Commande pas encore remise au client', count: 3 }],
      real_cost_split: { final: { orders: 2, amount_kmf: 30000 }, partial: { orders: 2, amount_kmf: 40000 } },
    },
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
      commande: 'CMD-C', costing: 'Réel complet', variance: '+1 000 KMF · Surcoût confirmé', marge: '8 000 KMF',
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
      'Coûts restant à établir',
      'Écarts entre coûts prévus et constatés',
      'Paiements fournisseur à revoir',
      'Remboursements période',
    ]);
    expect(decisions.some(item => /variances élevées|à suivre|non rapprochés/i.test(item.label))).toBe(false);

    expect(financeDecision.headlineMetrics(payload, finance).map(item => item.key)).toEqual([
      'ca-encaisse', 'cout-reel', 'marge',
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
      tone: 'warning',
      value: '+1 000 KMF',
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
      helper: expect.stringContaining('ambigu · rapprochement non vérifié'),
      value: 'attendu 19.9900 USD · observé —',
      tone: 'warning',
    }));
    expect(items[0].helper).toContain('débit réel prouvé non');
    expect(items[1]).toEqual(expect.objectContaining({
      title: 'aliexpress · PO bbbbbbbb',
      helper: expect.stringContaining('réussi · rapprochement écart constaté'),
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

  test('incompleteCostOrderItems explique ce qui manque, ce qui n’est pas encore attendu et l’absence de collecte (D1)', () => {
    const payload = payloadFixture();
    payload.incomplete_cost_orders = [{
      reference: 'CMD-I2', status: 'preparation', payment_status: 'paid', total_kmf: 5000, created_at: '2026-08-20T00:00:00.000Z',
      cost_explanation: {
        missing: [
          { type: 'packaging', label: 'Emballage', state: 'unknown', collection_mechanism: false },
          { type: 'product_purchase', label: 'Achat produit', state: 'unknown', collection_mechanism: true },
        ],
        not_yet_expected: [{ type: 'customs', label: 'Douane', expected_from: 'available' }],
        not_applicable: [],
        missing_estimate: false,
        costs_complete_at_stage: false,
        margin: { final_computable: false, reason: 'not_final_stage', label: 'Marge réelle finale non calculable : la commande n’est pas encore remise au client.' },
      },
    }];
    const [item] = financeDecision.incompleteCostOrderItems(payload, finance);
    expect(item.helper).toContain('Manque : Emballage (mécanisme de collecte absent), Achat produit');
    expect(item.helper).toContain('Pas encore attendu : Douane');
    expect(item.helper).toContain('Marge réelle finale non calculable');
  });

  test('varianceItems ne retient que surcoûts/économies confirmés et provisoires — pas les sans écart ni non comparables', () => {
    const payload = payloadFixture();
    payload.costing_orders = [
      ...payload.costing_orders,
      { reference: 'CMD-ZERO', sale_total_kmf: 10000, cost_status: 'actual', variance: { class: 'none', cost_variance_kmf: 0 } },
      { reference: 'CMD-NC', sale_total_kmf: 10000, cost_status: 'estimated', variance: { class: 'not_comparable', reason: 'no_real_cost' } },
      { reference: 'CMD-PROV', sale_total_kmf: 10000, cost_status: 'partial_real', variance: { class: 'provisional', cost_variance_kmf: -500 } },
    ];
    const items = financeDecision.varianceItems(payload, finance);
    expect(items.map(item => item.title)).toEqual(['CMD-C', 'CMD-PROV']);
    expect(items[1].helper).toContain('Écart provisoire');
    expect(items[1].tone).toBe('neutral');
  });

  test('notes de définition : numérateur/dénominateur, coût réel partiel vs final, périmètre de la marge', () => {
    const notes = financeDecision.indicatorNotes(payloadFixture(), finance);
    const byKey = Object.fromEntries(notes.map(n => [n.key, n]));
    expect(byKey.margin.title).toContain('2 commande(s) éligible(s) sur 5 encaissée(s)');
    expect(byKey.margin.text).toContain('CMD-C + CMD-D');
    expect(byKey.margin.text).toContain('3');
    const flat = t => t.replace(/[\u00a0\u202f]/g, ' ');
    expect(flat(byKey['real-cost'].text)).toContain('30 000 KMF');
    expect(flat(byKey['real-cost'].text)).toContain('40 000 KMF');
    expect(byKey['real-cost'].title).toContain('coûts partiels inclus');
  });

  test('rendu : sections « Coûts restant à établir » et « Écarts » réellement ancrées, détails repliés, liens avec retour Finance', () => {
    class Node {
      constructor(tag) { this.tag = tag; this.nodeType = 1; this.children = []; this.attrs = {}; this.className = ''; this.textContent = ''; this.style = {}; const cls = new Set(); this.classList = { add: c => cls.add(c), contains: c => cls.has(c) }; }
      appendChild(c) { this.children.push(c); return c; }
      insertBefore(c, ref) { const i = this.children.indexOf(ref); this.children.splice(i < 0 ? this.children.length : i, 0, c); return c; }
      replaceChildren() { this.children = []; }
      setAttribute(k, v) { this.attrs[k] = v; }
      addEventListener() {}
      find(pred, out = []) { if (pred(this)) out.push(this); this.children.forEach(c => c.find(pred, out)); return out; }
    }
    const doc = { createElement: tag => new Node(tag) };
    const noop = { render() {} };
    const ui = { MetricStrip: noop };
    const decisionUi = { DecisionStrip: noop, RankedList: noop };
    const payload = payloadFixture();
    payload.incomplete_cost_orders = [{
      reference: 'CMD-F', market_code: 'KM', status: 'collected', cost_explanation: { missing_estimate: false, margin: { label: 'Marge réelle finale non calculable : des coûts attendus manquent.' } },
      follow_up: { to_establish: [{ type: 'relay', label: 'Commission relais', state: 'unknown', reason: 'Coût attendu, non encore enregistré.', owner: { label: 'Relais', href: '/admin/relais-live' } }], not_yet_due: [] },
    }];
    const root = new Node('div');
    financeDecision.render(root, payload, { document: doc, ui, period: '30' }, finance, decisionUi);
    const all = root.find(() => true);
    const ids = all.map(n => n.attrs.id).filter(Boolean);
    expect(ids).toContain('finance-situation');
    expect(ids).not.toContain('finance-incomplete-costs');
    expect(ids).not.toContain('finance-variances');
    expect(ids).not.toContain('finance-variance-detail');
    expect(all.some(n => /Écarts entre coûts prévus et constatés/.test(n.textContent))).toBe(false);
    expect(all.filter(n => n.attrs['data-kpi']).map(n => n.attrs['data-kpi'])).toEqual(['ca-encaisse', 'cout-reel', 'marge']);
    expect(all.find(n => n.attrs['data-dashboard-visual'] === 'finance-mock-v1')).toBeTruthy();
    const help = all.find(n => n.attrs.id === 'finance-indicator-help');
    expect(help.hidden).toBe(true);
  });

  test('FIN-03 : KPI du mock — marge finalisée avec son périmètre, jamais celle des commandes encaissées', () => {
    const payload = payloadFixture();
    payload.margin_scope = { ...payload.margin_scope, paid_orders: 6, eligible_orders: 2, eligible_margin_pct: 31.4 };
    const cards = financeDecision.kpiCards(payload, finance);
    expect(cards.map(c => c.key)).toEqual(['ca-encaisse', 'cout-reel', 'marge']);
    const margin = cards.find(c => c.key === 'marge');
    expect(margin.label).toBe('Marge réelle finalisée');
    expect(margin.badge).toBe('Finalisée');
    expect(margin.helper.replace(/[\u00a0\u202f]/g, ' ')).toBe('31,4 % sur 2/6 commandes payées finalisées');
    payload.margin_scope.eligible_orders = 0;
    payload.margin_scope.eligible_margin_pct = null;
    const none = financeDecision.kpiCards(payload, finance).find(c => c.key === 'marge');
    expect(none.badge).toBeNull();
    // Inconnu jamais zéro : sans commande finalisée, ni « 0 KMF » ni ton positif.
    expect(none.value).toBe('—');
    expect(none.tone).toBe('neutral');
    expect(none.unknown).toBe(true);
    expect(none.helper).toMatch(/^Aucune commande finalisée \(0\//);
  });

  test('FIN-03 : bandeaux — coûts à établir et écarts confirmés (singulier/pluriel, inconnu jamais zéro)', () => {
    const payload = payloadFixture();
    const [costs, variances] = financeDecision.banners(payload, finance);
    expect(costs).toMatchObject({ key: 'incomplete-costs', value: '2 commandes', href: '#finance-incomplete-costs', actionLabel: 'Voir les commandes' });
    expect(variances).toMatchObject({ key: 'observed-variances', value: '1 surcoût confirmé', href: '#finance-variances', actionLabel: 'Analyser les écarts' });
    expect(variances.helper).toBe('1 provisoire(s) · 1 non comparable(s)');
    payload.variance_summary.overrun.orders = 2;
    payload.variance_summary.saving.orders = 1;
    expect(financeDecision.banners(payload, finance)[1].value).toBe('3 écarts confirmés');
    payload.variance_summary.overrun.orders = 0;
    payload.variance_summary.saving.orders = 0;
    expect(financeDecision.banners(payload, finance)[1].value).toBe('Aucun écart confirmé');
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



test('Finance overview : Hero + KPI + fiabilité + bandeaux + panneaux (mock FIN-03)', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical', 'js', 'finance-decision.js'),
    'utf8'
  );
  const start = source.indexOf('function render(rootNode');
  const renderSource = source.slice(start, source.indexOf('function enhance', start));
  expect(renderSource).toContain("data-dashboard-role', 'hero");
  expect(renderSource).toContain("data-dashboard-role', 'attention");
  expect(renderSource).toContain("data-dashboard-role', 'primary");
  expect(renderSource).toContain("'Performance financière'");
  expect(renderSource).toContain("'Paiements fournisseurs à revoir'");
  expect(renderSource).not.toContain('decorateDashboard');
  expect(renderSource).not.toContain("'Coûts incomplets'");
  expect(renderSource).not.toContain("'Variances observées'");
  expect(renderSource).not.toContain("'Trajectoire financière'");
  expect(renderSource).not.toContain("'Approfondir'");
  expect(renderSource).not.toContain("TrustFooter.render");
});

test('Finance précise que les paiements en attente sont bornés par la période', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'public/dashboards/canonical/js/finance.js'), 'utf8');
  expect(src).toContain("label: 'Paiements en attente (période)'");
});

describe('L3 — périmètre de recette affiché', () => {
  test('Finance : faits simulés jamais présentés comme source réelle', () => {
    const t = financeDecision.trust({ simulation: { scope: 'RCT1', label: 'Périmètre de recette RCT1 : faits simulés' } }, { formatNumber: (n) => String(n) });
    expect(t.stateLabel).toBe('Recette RCT1 — faits simulés');
    expect(t.simulationLabel).toMatch(/faits simulés/);
    expect(financeDecision.trust({}, { formatNumber: String }).stateLabel).toBe('Source canonique');
  });
});

describe('L1 — coût sans collecteur automatique', () => {
  test('le manque indique la saisie manuelle requise, jamais un zéro', () => {
    const payload = { incomplete_cost_orders: [{ reference: 'RCT1-E1', status: 'collected', missing_cost_types: ['sourcing'],
      cost_explanation: { missing: [{ type: 'sourcing', label: 'Sourcing', collection_mechanism: true, mechanism: 'manual_entry' }], not_yet_expected: [], margin: { label: 'Marge réelle finale non calculable : des coûts attendus manquent.' } } }] };
    const items = financeDecision.incompleteCostOrderItems(payload, finance);
    expect(JSON.stringify(items)).toContain('Sourcing (saisie manuelle requise)');
  });
});

describe('L3 — périmètre de recette transmis depuis l’URL de la page (finance)', () => {
  const run = async (search) => {
    const fetch = jest.fn().mockResolvedValue({ ok: true, json: jest.fn().mockResolvedValue(payloadFixture()) });
    await finance.mount({ root: {}, document: {}, ui: {}, fetch, renderer: { createRenderer: () => ({ render: jest.fn() }) },
      adminContext: marketContext(), contextContract: adminContextContract, user: { role: 'admin' }, location: { search } });
    return fetch.mock.calls[0][0];
  };
  test('périmètre valide transmis ; invalide ou absent ignoré (activité réelle)', async () => {
    expect(await run('?simulation_scope=RCT1')).toBe('/api/admin/dashboard/finance/market/CM?period=30&simulation_scope=RCT1');
    expect(await run("?simulation_scope=rct1'--")).toBe('/api/admin/dashboard/finance/market/CM?period=30');
    expect(await run('')).toBe('/api/admin/dashboard/finance/market/CM?period=30');
  });
  test('la période de l’URL est reprise (valide) ou ignorée (invalide) via la navigation partagée', async () => {
    jest.isolateModules(() => require('../../public/dashboards/canonical/js/navigation-policy-v4.js'));
    try {
      expect(await run('?period=90')).toBe('/api/admin/dashboard/finance/market/CM?period=90');
      expect(await run('?period=15&simulation_scope=RCT1')).toBe('/api/admin/dashboard/finance/market/CM?period=30&simulation_scope=RCT1');
    } finally {
      delete global.KomerceCanonicalNavigation;
    }
  });
});


test('Finance → Commande 360 : le lien d’une commande ouvre la section Coûts & écarts (#couts) avec retour à Finance', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'public/dashboards/canonical/js/finance-decision.js'), 'utf8');
  expect(src).toContain("base.contextualHref(`/admin/orders/${encodeURIComponent(reference)}#couts`, returnTo, 'Retour à Finance')");
});
