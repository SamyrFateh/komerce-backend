'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));

const mockMetric = key => ({ key, label: key, value: 1, unit: 'count', data_quality: {} });
const mockMetrics = {
  getCAEncaisse: jest.fn(async () => mockMetric('ca_encaisse')),
  getCoutEstime: jest.fn(async () => mockMetric('cout_estime')),
  getCoutReel: jest.fn(async () => mockMetric('cout_reel')),
  getMargeEstimee: jest.fn(async () => mockMetric('marge_estimee')),
  getMargeVariableReelle: jest.fn(async () => mockMetric('marge_variable_reelle')),
  getMargeConsolidee: jest.fn(async () => mockMetric('marge_consolidee')),
  getTauxCompletudeCouts: jest.fn(async () => mockMetric('taux_completude_couts')),
  getCmdsCoutIncompletCount: jest.fn(async () => mockMetric('cmds_cout_incomplet')),
  getPaiementsEnAttente: jest.fn(async () => mockMetric('paiements_en_attente')),
  getCmdsCoutIncompletIds: jest.fn(async () => [
    { reference: 'CMD-1', status: 'confirmed', payment_status: 'paid', total_kmf: '1000', created_at: '2026-08-20T00:00:00.000Z', missing_cost_types: ['payment'], cost_explanation: { missing: [{ type: 'payment', state: 'unknown' }], not_yet_expected: [], not_applicable: [] } },
  ]),
};
jest.mock('../../services/dashboard-metrics', () => mockMetrics);

const finance = require('../../services/dashboard-finance-canonical');

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockImplementation(async sql => {
    const text = String(sql);
    if (text.includes('COUNT(*)::int AS count') && text.includes('FROM refunds')) {
      return { rows: [{ count: 2, total_kmf: '1500', stripe_kmf: '1000', store_credit_kmf: '500' }] };
    }
    if (text.includes('GROUP BY o.payment_mode')) {
      return { rows: [{ payment_mode: 'stripe_eur', orders: 2, total_kmf: '9000' }] };
    }
    if (text.includes('ORDER BY r.completed_at DESC')) {
      return { rows: [{ order_reference: 'CMD-R', amount_kmf: '500', refund_method: 'stripe', completed_at: '2026-08-23T00:00:00.000Z' }] };
    }
    if (text.includes('JOIN relais r ON r.id = ct.relais_id')) {
      return { rows: [{ relais_name: 'Relais Centre', orders: '4', revenue_kmf: '120000', estimated_cost_kmf: '70000', actual_orders: '3', actual_revenue_kmf: '90000', real_cost_kmf: '52000' }] };
    }
    if (text.includes('WITH scoped_orders AS')) {
      return { rows: [{ bucket: '2026-08-18T00:00:00.000Z', paid_orders: '4', revenue_kmf: '120000', real_cost_kmf: '70000', actual_orders: '3', consolidated_margin_kmf: '50000' }] };
    }
    if (text.includes('GROUP BY alc.cost_type::text')) {
      return { rows: [{ cost_type: 'product_purchase', orders: '4', amount_kmf: '40000' }] };
    }
    if (text.includes('AS estimated_cost_kmf')) {
      return { rows: [{ reference: 'CMD-C', status: 'collected', payment_status: 'paid', total_kmf: '20000', created_at: '2026-08-20T00:00:00.000Z', estimated_cost_kmf: '11000', real_cost_kmf: '12000', has_imputation: true, final_ready: true, missing_cost_types: [] }] };
    }
    if (text.includes('FROM supplier_execution_payments')) {
      return { rows: [
        {
          purchase_order_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          provider: 'cj', payment_ref: 'PAY-1',
          expected_amount: '19.9900', observed_amount: null, currency: 'USD',
          status: 'ambiguous', reconciliation_status: 'unverified', real_debit_verified: false,
          review_reason: 'PAYMENT_AMBIGUOUS_RECONCILIATION_REQUIRED',
          created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-05T00:00:00.000Z',
          total_count: 2,
        },
        {
          purchase_order_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          provider: 'aliexpress', payment_ref: 'PAY-2',
          expected_amount: '88.0000', observed_amount: '90.0000', currency: 'CNY',
          status: 'succeeded', reconciliation_status: 'mismatched', real_debit_verified: false,
          review_reason: 'PAYMENT_RECONCILIATION_MISMATCH',
          created_at: '2026-10-02T00:00:00.000Z', updated_at: '2026-10-05T01:00:00.000Z',
          total_count: 2,
        },
      ] };
    }
    return { rows: [] };
  });
});

test('Finance market applique le scope serveur aux métriques et projections', async () => {
  const payload = await finance.buildFinance(
    { period: '30' },
    { market: { id: 'market-cm-id', code: 'CM', name: 'Cameroun', currency: 'XAF' }, now: new Date('2026-08-24T12:00:00.000Z') }
  );

  for (const fn of [
    mockMetrics.getCAEncaisse,
    mockMetrics.getCoutEstime,
    mockMetrics.getCoutReel,
    mockMetrics.getMargeEstimee,
    mockMetrics.getMargeVariableReelle,
    mockMetrics.getMargeConsolidee,
    mockMetrics.getTauxCompletudeCouts,
    mockMetrics.getCmdsCoutIncompletCount,
    mockMetrics.getPaiementsEnAttente,
  ]) {
    expect(fn).toHaveBeenCalledWith(expect.objectContaining({ market_id: 'market-cm-id' }));
  }

  const scopedCalls = mockQuery.mock.calls.filter(([sql]) => {
    const text = String(sql);
    return text.includes('GROUP BY o.payment_mode') || text.includes('WITH scoped_orders AS') || text.includes('GROUP BY alc.cost_type::text') || text.includes('AS estimated_cost_kmf');
  });
  expect(scopedCalls.length).toBeGreaterThanOrEqual(5);
  scopedCalls.forEach(([sql, params]) => {
    expect(String(sql)).toContain('o.market_id =');
    expect(params).toContain('market-cm-id');
  });

  expect(payload.scope).toEqual({ mode: 'market', market: { code: 'CM', name: 'Cameroun', currency: 'XAF' } });
  expect(payload.period).toBe(30);
  expect(payload.trend[0]).toMatchObject({ revenue_kmf: 120000, actual_orders: 3, cost_coverage_pct: 75 });
  expect(payload.cost_families[0]).toEqual({ cost_type: 'product_purchase', orders: 4, amount_kmf: 40000 });
  expect(payload.costing_orders[0]).toMatchObject({ reference: 'CMD-C', variance_kmf: 1000, consolidated_margin_kmf: 8000, cost_status: 'actual' });
  expect(payload.relay_profitability[0]).toMatchObject({
    relais_name: 'Relais Centre',
    revenue_kmf: 120000,
    estimated_margin_kmf: 50000,
    consolidated_margin_kmf: 38000,
    actual_orders: 3,
    cost_coverage_pct: 75,
  });
  expect(payload.costing_kpis.map(item => item.key)).toEqual(['cout_estime', 'cout_reel', 'marge_estimee', 'marge_variable_reelle', 'marge_consolidee']);
  expect(payload.data_quality.economic_global_engine_consumed).toBe(false);
  expect(payload.data_quality.relay_real_margin_basis).toBe('actual_cost_orders_only');
  expect(payload.data_quality.finance_period_basis).toEqual({
    orders: {
      field: 'orders.created_at',
      semantics: 'paid_order_creation_cohort',
      cash_basis: false,
      reason: 'no_universal_payment_received_timestamp_across_all_payment_modes',
    },
    refunds: {
      field: 'refunds.completed_at',
      semantics: 'refund_completion_event',
    },
  });
  expect(payload.supplier_payment_review).toEqual(expect.objectContaining({
    count: 2,
    basis: 'current_state_all_time_market_lineage',
    truncated: false,
  }));
  expect(payload.data_quality.supplier_payment_review_basis).toBe('current_state_all_time_market_lineage');
  const reviewCall = mockQuery.mock.calls.find(([sql]) => String(sql).includes('FROM supplier_execution_payments'));
  expect(reviewCall).toBeTruthy();
  expect(String(reviewCall[0])).toContain('EXISTS');
  expect(String(reviewCall[0])).toContain('FROM purchase_lines pl');
  expect(String(reviewCall[0])).toContain('JOIN order_items oi');
  expect(String(reviewCall[0])).toContain('JOIN orders o');
  expect(String(reviewCall[0])).toContain('o.market_id = $1');
  expect(String(reviewCall[0])).toContain("WHERE (status IN ('ambiguous', 'rejected') OR reconciliation_status = 'mismatched')");
  expect(reviewCall[1]).toEqual(['market-cm-id', 50]);
  expect(JSON.stringify(payload)).not.toContain('market-cm-id');
});

test('une rentabilité relais sans coût actual ne fabrique aucune marge réelle', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{
    relais_name: 'Relais Test',
    orders: '3',
    revenue_kmf: '60000',
    estimated_cost_kmf: '40000',
    actual_orders: '0',
    actual_revenue_kmf: null,
    real_cost_kmf: null,
  }] });

  const rows = await finance.getRelayProfitability({ market_id: 'market-cm-id' });
  expect(rows[0]).toMatchObject({ estimated_margin_kmf: 20000, consolidated_margin_kmf: null, real_cost_kmf: null });
  expect(String(mockQuery.mock.calls[0][0])).toContain('o.market_id =');
  expect(mockQuery.mock.calls[0][1]).toContain('market-cm-id');
});

test('les remboursements market utilisent la période et le marché serveur', async () => {
  await finance.buildFinance(
    { period: '7' },
    { market: { id: 'market-cm-id', code: 'CM', name: 'Cameroun', currency: 'XAF' }, now: new Date('2026-08-24T12:00:00.000Z') }
  );

  const refundCalls = mockQuery.mock.calls.filter(([sql]) => String(sql).includes('FROM refunds r'));
  expect(refundCalls).toHaveLength(2);
  refundCalls.forEach(([sql, params]) => {
    expect(String(sql)).toContain('r.completed_at >= $1');
    expect(String(sql)).toContain('r.completed_at <= $2');
    expect(String(sql)).toContain('o.market_id = $3');
    expect(params[2]).toBe('market-cm-id');
  });
});

test('trajectoire canonique : données réelles absentes => null, aucun faux 0 de marge finale', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{
    bucket: '2026-10-19T00:00:00.000Z',
    paid_orders: '3', revenue_kmf: '90000', real_cost_kmf: null,
    actual_orders: '0', consolidated_margin_kmf: null,
  }] });
  const trend = await finance.getFinanceTrend({ market_id: 'market-cm-id' }, 30);
  expect(trend).toHaveLength(1);
  expect(trend[0]).toMatchObject({
    paid_orders: 3, revenue_kmf: 90000,
    real_cost_kmf: null, consolidated_margin_kmf: null,
    actual_orders: 0, cost_coverage_pct: 0,
  });
  const sql = String(mockQuery.mock.calls[0][0]);
  expect(sql).toContain('SUM(total_kmf - real_cost_kmf) FILTER');
  expect(sql).toContain('final_ready AND real_cost_kmf IS NOT NULL');
  expect(sql).not.toContain('ELSE 0');
});

test('trajectoire canonique : une valeur réelle explicitement nulle reste 0', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{
    bucket: '2026-10-19T00:00:00.000Z',
    paid_orders: '1', revenue_kmf: '5000', real_cost_kmf: '0',
    actual_orders: '1', consolidated_margin_kmf: '5000',
  }] });
  const trend = await finance.getFinanceTrend({}, 7);
  expect(trend[0]).toMatchObject({
    real_cost_kmf: 0, consolidated_margin_kmf: 5000,
    actual_orders: 1, cost_coverage_pct: 100,
  });
});

test('granularité de trajectoire dépend uniquement de la période normalisée', () => {
  expect(finance.trendBucket(7)).toBe('day');
  expect(finance.trendBucket(30)).toBe('week');
  expect(finance.trendBucket(90)).toBe('month');
});

test('Finance globale ne fabrique aucun filtre marché', async () => {
  const payload = await finance.buildFinance(
    { period: '999' },
    { now: new Date('2026-08-24T12:00:00.000Z') }
  );

  expect(payload.scope).toEqual({ mode: 'global', market: null });
  expect(payload.period).toBe(30);
  expect(payload.data_quality.economic_global_engine_consumed).toBe(false);
  const refundCalls = mockQuery.mock.calls.filter(([sql]) => String(sql).includes('FROM refunds r'));
  refundCalls.forEach(([sql, params]) => {
    expect(String(sql)).not.toContain('o.market_id');
    expect(params).toHaveLength(2);
  });
  expect(payload.supplier_payment_review).toEqual(expect.objectContaining({
    count: 2,
    basis: 'current_state_all_time',
    truncated: false,
  }));
  expect(payload.supplier_payment_review.items[0]).toEqual(expect.objectContaining({
    provider: 'cj',
    expected_amount: '19.9900',
    observed_amount: null,
    currency: 'USD',
    status: 'ambiguous',
    reconciliation_status: 'unverified',
    real_debit_verified: false,
    review_reason: 'PAYMENT_AMBIGUOUS_RECONCILIATION_REQUIRED',
    drill_to: '/admin/workspaces/purchasing?po=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  }));
  expect(payload.supplier_payment_review.items[1]).toEqual(expect.objectContaining({
    provider: 'aliexpress',
    expected_amount: '88.0000',
    observed_amount: '90.0000',
    currency: 'CNY',
    status: 'succeeded',
    reconciliation_status: 'mismatched',
    review_reason: 'PAYMENT_RECONCILIATION_MISMATCH',
  }));
  expect(payload.supplier_payment_review.items.every(item => !Object.prototype.hasOwnProperty.call(item, 'payment_id'))).toBe(true);
  expect(JSON.stringify(payload.supplier_payment_review)).not.toContain('payment_id');
  expect(payload.data_quality.source_tables).toContain('supplier_execution_payments');
});


test('la file fournisseur utilise uniquement les états canoniques de revue, sans inventer retard ni preuve manquante', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [] });

  const review = await finance.getSupplierPaymentReview({ limit: 25 });

  expect(review).toEqual({ count: 0, items: [], truncated: false, scope: 'global', basis: 'current_state_all_time' });
  const [sql, params] = mockQuery.mock.calls[0];
  const text = String(sql);
  expect(text).toContain("status IN ('ambiguous', 'rejected')");
  expect(text).toContain("reconciliation_status = 'mismatched'");
  expect(text).not.toContain("status = 'requested'");
  expect(text).not.toContain('real_debit_verified = false');
  expect(text).not.toMatch(/proof/i);
  expect(params).toEqual([25]);
});

test('la projection Finance transmet l’explication des coûts manquants par commande (D1)', async () => {
  const payload = await finance.buildFinance({ period: '30' }, { market: null, now: new Date('2026-08-21T00:00:00Z') });
  expect(payload.incomplete_cost_orders[0].cost_explanation.missing[0]).toMatchObject({ type: 'payment', state: 'unknown' });
  expect(payload.incomplete_cost_orders[0].missing_cost_types).toEqual(['payment']);
});

describe('D1b — complétude partagée avec cost-expectation', () => {
  const fs = require('fs');
  const path = require('path');
  const read = (rel) => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');

  test.each(['services/dashboard-finance-canonical.js', 'services/dashboard-commerce.js'])(
    '%s : marge finale = finalMarginReadySql (plus de comptage de types fixe)', (rel) => {
      const src = read(rel);
      expect(src).toContain('finalMarginReadySql');
      expect(src).not.toMatch(/expected_cost_types|expectedCount|expectedIndex/);
    });

  test('Commerce expose toujours sa liste de types attendus', () => {
    const commerce = require('../../services/dashboard-commerce');
    expect(Array.isArray(commerce.EXPECTED_COST_TYPES)).toBe(true);
  });

  test('commandes récentes : types manquants exposés, jamais présentés comme zéro', async () => {
    const db = require('../../db');
    expect(read('services/dashboard-finance-canonical.js')).toContain('missingTypesArraySql');
    expect(db).toBeDefined();
  });
});

describe('RCT1-FIN-01 — écarts coûts prévus / constatés et coûts restant à établir', () => {
  const truth = (over = {}) => ({
    estimated: { variable_total_kmf: 9000, by_cost_type: { product_purchase: 6000, freight: 1500, customs: 0, relay: 500, payment: 80 }, ...(over.estimated || {}) },
    real: { by_cost_type: { product_purchase: 6000, freight: 2000, relay: 600 }, variable_by_cost_type: { product_purchase: 6000, freight: 2000, relay: 600 }, variable_total_kmf: 8600, expected_unknown_cost_types: [], ...(over.real || {}) },
    variance: over.variance === undefined ? { total_kmf: -400 } : over.variance,
  });

  test('coûts complets : surcoût, économie, sans écart ; signe de la marge opposé', () => {
    expect(finance.classifyOrderVariance(truth({ variance: { total_kmf: 300 } }), 'actual')).toMatchObject({ class: 'overrun', cost_variance_kmf: 300, margin_variance_kmf: -300 });
    expect(finance.classifyOrderVariance(truth({ variance: { total_kmf: -400 } }), 'actual')).toMatchObject({ class: 'saving', cost_variance_kmf: -400, margin_variance_kmf: 400 });
    expect(finance.classifyOrderVariance(truth({ variance: { total_kmf: 0 } }), 'actual')).toMatchObject({ class: 'none', cost_variance_kmf: 0 });
  });

  test('un réel partiel inférieur à l’estimé n’est jamais une économie', () => {
    const verdict = finance.classifyOrderVariance(truth({ variance: { total_kmf: -400 } }), 'partial_real');
    expect(verdict.class).toBe('provisional');
    expect(verdict.margin_variance_kmf).toBeUndefined();
  });

  test('non comparable : estimation absente, aucun réel, coût attendu inconnu', () => {
    expect(finance.classifyOrderVariance(truth({ estimated: { variable_total_kmf: null } }), 'actual')).toMatchObject({ class: 'not_comparable', reason: 'estimate_absent' });
    expect(finance.classifyOrderVariance(truth({ real: { by_cost_type: {}, variable_by_cost_type: {} } }), 'estimated')).toMatchObject({ class: 'not_comparable', reason: 'no_real_cost' });
    expect(finance.classifyOrderVariance(truth({ variance: null, real: { expected_unknown_cost_types: ['customs'] } }), 'partial_real')).toMatchObject({ class: 'not_comparable', reason: 'expected_cost_unknown' });
  });

  test('composantes : inconnu ≠ zéro ≠ non applicable, delta seulement quand prévu et constaté existent', () => {
    const explanation = {
      missing: [{ type: 'customs', label: 'Douane', note: 'Coût attendu, non encore enregistré.' }],
      not_yet_expected: [],
      not_applicable: [{ type: 'payment', label: 'Frais du prestataire de paiement', motif: 'Paiement en espèces au relais' }],
    };
    const t = truth({ real: { by_cost_type: { product_purchase: 6000, freight: 2000, relay: 0 }, variable_by_cost_type: { product_purchase: 6000, freight: 2000, relay: 0 } } });
    const rows = Object.fromEntries(finance.buildVarianceComponents(t, explanation).map(c => [c.type, c]));
    expect(rows.freight).toMatchObject({ state: 'confirmed', estimated_kmf: 1500, real_kmf: 2000, delta_kmf: 500 });
    expect(rows.relay).toMatchObject({ state: 'zero_confirmed', real_kmf: 0, delta_kmf: -500 });
    expect(rows.customs).toMatchObject({ state: 'unknown', real_kmf: null, delta_kmf: null });
    expect(rows.payment).toMatchObject({ state: 'not_applicable', delta_kmf: null, motif: 'Paiement en espèces au relais' });
    expect(rows.customs.owner.label).toBe('Expéditions & Douane');
  });

  test('synthèse : montants par classe, non comparables sans montant, provisoires non mêlés aux confirmés', () => {
    const rows = [
      { variance: { class: 'overrun', cost_variance_kmf: 300 } },
      { variance: { class: 'saving', cost_variance_kmf: -100 } },
      { variance: { class: 'provisional', cost_variance_kmf: -900 } },
      { variance: { class: 'not_comparable', reason: 'no_real_cost' } },
    ];
    const s = finance.summarizeVariances(rows);
    expect(s.overrun).toEqual({ orders: 1, amount_kmf: 300 });
    expect(s.saving).toEqual({ orders: 1, amount_kmf: -100 });
    expect(s.provisional).toEqual({ orders: 1, amount_kmf: -900 });
    expect(s.not_comparable).toEqual({ orders: 1, amount_kmf: null });
  });

  test('suivi : à établir (inconnu) distinct de pas encore dû, avec responsable', () => {
    const fu = finance.buildFollowUp({ cost_explanation: {
      missing: [{ type: 'relay', label: 'Commission relais', note: 'Coût attendu, non encore enregistré.' }],
      not_yet_expected: [{ type: 'customs', label: 'Douane', expected_when: 'expédition douane déclarée' }],
    } });
    expect(fu.to_establish[0]).toMatchObject({ type: 'relay', state: 'unknown', owner: { label: 'Relais' } });
    expect(fu.not_yet_due[0]).toMatchObject({ type: 'customs', state: 'expected', reason: 'Attendu à : expédition douane déclarée' });
  });
});

describe('FIN-03 — rapport marge/vente des commandes finalisées', () => {
  test('marge % calculée côté serveur sur les seules commandes finalisées (jamais les six encaissées)', async () => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValueOnce({ rows: [
      { reference: 'A', status: 'collected', payment_mode: 'cash_relais', total_kmf: '15065', has_imputation: true, final_ready: true, real_cost_kmf: '10300', missing_cost_types: [] },
      { reference: 'B', status: 'collected', payment_mode: 'cash_relais', total_kmf: '6000', has_imputation: true, final_ready: true, real_cost_kmf: '4150', missing_cost_types: [] },
      { reference: 'C', status: 'in_transit', payment_mode: 'cash_relais', total_kmf: '15000', has_imputation: true, final_ready: false, real_cost_kmf: '5000', missing_cost_types: ['freight'] },
    ] });
    const scope = await finance.getMarginScope({});
    expect(scope.paid_orders).toBe(3);
    expect(scope.eligible_orders).toBe(2);
    expect(scope.eligible_revenue_kmf).toBe(21065);
    expect(scope.eligible_margin_pct).toBe(31.4);
  });
  test('aucune commande finalisée : pas de pourcentage', async () => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const scope = await finance.getMarginScope({});
    expect(scope.eligible_revenue_kmf).toBe(0);
    expect(scope.eligible_margin_pct).toBeNull();
  });
});
