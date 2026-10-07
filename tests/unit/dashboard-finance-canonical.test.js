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
    { reference: 'CMD-1', status: 'confirmed', payment_status: 'paid', total_kmf: '1000', created_at: '2026-08-20T00:00:00.000Z' },
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
      return { rows: [{ reference: 'CMD-C', status: 'collected', payment_status: 'paid', total_kmf: '20000', created_at: '2026-08-20T00:00:00.000Z', estimated_cost_kmf: '11000', real_cost_kmf: '12000', has_imputation: true, expected_cost_types: String(finance.EXPECTED_COST_TYPES.length) }] };
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
  expect(payload.supplier_payment_review).toEqual(expect.objectContaining({
    count: 2,
    basis: 'current_state_all_time_market_lineage',
    truncated: false,
  }));
  expect(payload.data_quality.supplier_payment_review_basis).toBe('current_state_all_time_market_lineage');
  const reviewCall = mockQuery.mock.calls.find(([sql]) => String(sql).includes('FROM supplier_execution_payments'));
  expect(reviewCall).toBeTruthy();
  expect(String(reviewCall[0])).toContain('EXISTS');
  expect(String(reviewCall[0])).toContain('JOIN purchase_lines pl');
  expect(String(reviewCall[0])).toContain('JOIN order_items oi');
  expect(String(reviewCall[0])).toContain('JOIN orders o');
  expect(String(reviewCall[0])).toContain('o.market_id = $1');
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

  expect(review).toEqual({ count: 0, items: [], truncated: false, basis: 'current_state_all_time' });
  const [sql, params] = mockQuery.mock.calls[0];
  const text = String(sql);
  expect(text).toContain("status IN ('ambiguous', 'rejected')");
  expect(text).toContain("reconciliation_status = 'mismatched'");
  expect(text).not.toContain("status = 'requested'");
  expect(text).not.toContain('real_debit_verified = false');
  expect(text).not.toMatch(/proof/i);
  expect(params).toEqual([25]);
});
