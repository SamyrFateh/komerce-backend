'use strict';

jest.mock('../../db', () => ({
  query: jest.fn(),
  getClient: jest.fn(),
}));
jest.mock('../../services/pricing-market-coverage', () => ({
  computeMarketCoverage: jest.fn(),
}));

const db = require('../../db');
const { computeMarketCoverage } = require('../../services/pricing-market-coverage');
const {
  normalizePolicyInput,
  recordMarketDecisionPolicy,
  getCurrentMarketDecisionPolicy,
  canonicalPeriod,
  calendarMonthPeriod,
  isValidCalendarMonth,
  evaluateMarketDecision,
  _buildBreakEvenTarget,
} = require('../../services/pricing-market-decision-policy');

const MARKET = '11111111-1111-4111-8111-111111111111';
const ACTOR = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-09-07T08:00:00.000Z');
const MATURE_ORDERS = [
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',
];

function policyInput(overrides = {}) {
  return {
    version: 'CM-V1',
    window_days: 30,
    maturity_threshold: 0.9,
    coverage_threshold: 1,
    max_disposition_ratio: 0.05,
    source: 'pricing-governance',
    evidence_ref: 'decision://pricing/CM-V1',
    rationale: 'Politique initiale du gate économique Cameroun.',
    ...overrides,
  };
}

function policyRow(overrides = {}) {
  return {
    ...policyInput(),
    disposed_contribution_treatment: 'EXCLUDE_FROM_NUMERATOR',
    effective_from: NOW.toISOString(),
    effective_to: null,
    recorded_at: NOW.toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

test('aucun seuil silencieux : tous les paramètres décisionnels sont requis', () => {
  expect(() => normalizePolicyInput({ ...policyInput(), coverage_threshold: undefined }, ACTOR, { now: NOW }))
    .toThrow('policy.coverage_threshold must be a finite number');
  expect(() => normalizePolicyInput(policyInput({ max_disposition_ratio: 1.1 }), ACTOR, { now: NOW }))
    .toThrow('policy.max_disposition_ratio must be between 0 and 1');
});

test('une politique ne peut pas être antidatée', () => {
  expect(() => normalizePolicyInput(policyInput({ effective_from: '2026-09-06T00:00:00.000Z' }), ACTOR, { now: NOW }))
    .toThrow('policy.effective_from cannot be backdated');
});

test('la fenêtre canonique est dérivée côté serveur depuis window_days', () => {
  const period = canonicalPeriod(policyRow(), NOW);
  expect(period.to).toBe('2026-09-07T08:00:00.000Z');
  expect(period.from).toBe('2026-08-08T08:00:00.000Z');
  expect(period.width_days).toBe(30);
  expect(period.source).toBe('server_policy_window');
});

test('calendarMonthPeriod borne un mois civil exact, largeur variable selon le mois', () => {
  const april = calendarMonthPeriod('2025-04');
  expect(april.from).toBe('2025-04-01T00:00:00.000Z');
  expect(april.to).toBe('2025-05-01T00:00:00.000Z');
  expect(april.width_days).toBe(30);
  expect(april.source).toBe('calendar_month_selection');
  expect(april.calendar_month).toBe('2025-04');

  const february = calendarMonthPeriod('2024-02');
  expect(february.width_days).toBe(29); // année bissextile

  const december = calendarMonthPeriod('2025-12');
  expect(december.to).toBe('2026-01-01T00:00:00.000Z');
});

test('calendarMonthPeriod rejette un format autre que YYYY-MM', () => {
  expect(() => calendarMonthPeriod('2025-4')).toThrow('period must match YYYY-MM');
  expect(() => calendarMonthPeriod('2025-13')).toThrow('period must match YYYY-MM');
  expect(() => calendarMonthPeriod('avril 2025')).toThrow('period must match YYYY-MM');
});

test('isValidCalendarMonth valide le format sans lever', () => {
  expect(isValidCalendarMonth('2025-04')).toBe(true);
  expect(isValidCalendarMonth('2025-4')).toBe(false);
  expect(isValidCalendarMonth('')).toBe(false);
  expect(isValidCalendarMonth(null)).toBe(false);
});

test('evaluateMarketDecision avec period utilise le mois calendaire au lieu de la fenêtre glissante', async () => {
  db.query.mockResolvedValueOnce({ rows: [policyRow()] });
  computeMarketCoverage.mockResolvedValueOnce({
    coverage_status: 'COVERED',
    authorization: 'ALLOW_NEW_UNDER_CDR_POSITION',
    reason: 'COVERAGE_THRESHOLD_MET',
  });

  const result = await evaluateMarketDecision(MARKET, { period: '2025-04' });

  expect(result.canonical_period.source).toBe('calendar_month_selection');
  expect(result.canonical_period.from).toBe('2025-04-01T00:00:00.000Z');
  expect(result.canonical_period.to).toBe('2025-05-01T00:00:00.000Z');
  expect(result.canonical_period.width_days).toBe(30);
  expect(computeMarketCoverage).toHaveBeenCalledWith(expect.objectContaining({
    from: '2025-04-01T00:00:00.000Z',
    to: '2025-05-01T00:00:00.000Z',
  }));
  // La politique résolue doit être celle en vigueur à la fin du mois demandé,
  // pas "maintenant".
  expect(db.query.mock.calls[0][1]).toContainEqual('2025-05-01T00:00:00.000Z');
});

test('evaluateMarketDecision rejette un period malformé', async () => {
  await expect(evaluateMarketDecision(MARKET, { period: '2025/04' })).rejects.toThrow('period must match YYYY-MM');
  expect(db.query).not.toHaveBeenCalled();
});

test('recordMarketDecisionPolicy écrit un nouvel événement append-only avec preuve', async () => {
  const client = {
    query: jest.fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ id: MARKET }] })
      .mockResolvedValueOnce({ rows: [policyRow()] })
      .mockResolvedValueOnce({}),
    release: jest.fn(),
  };
  db.getClient.mockResolvedValue(client);

  const result = await recordMarketDecisionPolicy(MARKET, policyInput(), ACTOR, { now: NOW });

  expect(client.query.mock.calls[2][0]).toContain('INSERT INTO pricing_market_decision_policy_events');
  expect(client.query.mock.calls[2][0]).not.toContain('UPDATE pricing_market_decision_policy_events');
  expect(result.version).toBe('CM-V1');
  expect(result.coverage_threshold).toBe(1);
  expect(client.release).toHaveBeenCalled();
});

test('getCurrentMarketDecisionPolicy résout la dernière politique effective', async () => {
  db.query.mockResolvedValueOnce({ rows: [policyRow()] });
  const result = await getCurrentMarketDecisionPolicy(MARKET, { at: NOW });
  expect(result.version).toBe('CM-V1');
  expect(db.query.mock.calls[0][0]).toContain('effective_from <= $2');
});

test('evaluateMarketDecision fail-closed si aucune politique n existe', async () => {
  db.query.mockResolvedValueOnce({ rows: [] });
  const result = await evaluateMarketDecision(MARKET, { at: NOW });
  expect(result.decision_status).toBe('NOT_DECISIONAL');
  expect(result.authorization).toBe('DENY_NEW_UNDER_CDR_POSITION');
  expect(result.reason).toBe('MARKET_DECISION_POLICY_REQUIRED');
  expect(result.flow_break_even).toBeNull();
  expect(computeMarketCoverage).not.toHaveBeenCalled();
});

test('evaluateMarketDecision injecte la politique versionnée dans le gate existant', async () => {
  db.query.mockResolvedValueOnce({ rows: [policyRow()] });
  computeMarketCoverage.mockResolvedValueOnce({
    coverage_status: 'COVERED',
    authorization: 'ALLOW_NEW_UNDER_CDR_POSITION',
    reason: 'COVERAGE_THRESHOLD_MET',
  });

  const result = await evaluateMarketDecision(MARKET, { at: NOW, allocationPolicies: [] });

  expect(result.decision_status).toBe('COVERED');
  expect(result.flow_break_even.reason).toBe('BREAK_EVEN_INPUTS_UNAVAILABLE');
  expect(computeMarketCoverage).toHaveBeenCalledWith(expect.objectContaining({
    marketId: MARKET,
    coveragePolicy: expect.objectContaining({
      version: 'CM-V1',
      maturity_threshold: 0.9,
      coverage_threshold: 1,
    }),
    dispositionPolicy: expect.objectContaining({ max_ratio: 0.05 }),
    allocationPolicies: [],
  }));
});

test('le point d équilibre traduit le même gap en commandes, articles et colis équivalents au mix observé', async () => {
  db.query
    .mockResolvedValueOnce({ rows: [policyRow({ coverage_threshold: 1.1 })] })
    .mockResolvedValueOnce({ rows: [{ article_units: '10', parcel_count: 2 }] });
  computeMarketCoverage.mockResolvedValueOnce({
    coverage_status: 'UNCOVERED',
    authorization: 'DENY_NEW_UNDER_CDR_POSITION',
    reason: 'COVERAGE_THRESHOLD_NOT_MET',
    coverage_ratio: 0.72,
    numerator_contribution_kmf: 720,
    denominator_n3_kmf: 1000,
    mature_order_ids: MATURE_ORDERS,
    contribution: { mature_order_count: 4 },
  });

  const result = await evaluateMarketDecision(MARKET, { at: NOW });
  const flow = result.flow_break_even;

  expect(flow.status).toBe('READY');
  expect(flow.basis).toBe('CURRENT_RECONCILED_MIX');
  expect(flow.observed_mix).toMatchObject({
    mature_orders: 4,
    article_units: 10,
    parcels: 2,
    articles_per_order: 2.5,
    articles_per_parcel: 5,
    contribution_per_order_kmf: 180,
    contribution_per_article_kmf: 72,
    contribution_per_parcel_kmf: 360,
  });
  expect(flow.economic_break_even).toMatchObject({
    target_coverage_ratio: 1,
    gap_kmf: 280,
    additional_equivalent_orders: 2,
    additional_equivalent_articles: 4,
    additional_equivalent_parcels: 1,
  });
  expect(flow.policy_safety_target).toMatchObject({
    target_coverage_ratio: 1.1,
    gap_kmf: 380,
    additional_equivalent_orders: 3,
    additional_equivalent_articles: 6,
    additional_equivalent_parcels: 2,
  });
  expect(flow.assumptions.unmodelled_capacity_step_excluded).toBe(true);
  expect(db.query.mock.calls[1][0]).toContain('FROM order_items');
  expect(db.query.mock.calls[1][0]).toContain('FROM parcels');
});

test('un mix à contribution non positive ne fabrique jamais un volume de break-even fini', () => {
  const target = _buildBreakEvenTarget(1, 1000, -200, {
    contribution_per_order_kmf: -50,
    contribution_per_article_kmf: -20,
    contribution_per_parcel_kmf: -100,
  });

  expect(target.status).toBe('CURRENT_MIX_NOT_PROJECTABLE');
  expect(target.gap_kmf).toBe(1200);
  expect(target.additional_equivalent_orders).toBeNull();
  expect(target.additional_equivalent_articles).toBeNull();
  expect(target.additional_equivalent_parcels).toBeNull();
});

test('une couverture non décisionnelle ne déclenche aucune fausse projection de forme du flux', async () => {
  db.query.mockResolvedValueOnce({ rows: [policyRow()] });
  computeMarketCoverage.mockResolvedValueOnce({
    coverage_status: 'NOT_DECISIONAL',
    authorization: 'DENY_NEW_UNDER_CDR_POSITION',
    reason: 'MATURITY_THRESHOLD_NOT_MET',
  });

  const result = await evaluateMarketDecision(MARKET, { at: NOW });

  expect(result.flow_break_even).toMatchObject({
    status: 'NOT_DECISIONAL',
    reason: 'COVERAGE_TRUTH_NOT_DECISIONAL',
  });
  expect(db.query).toHaveBeenCalledTimes(1);
});
