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
  evaluateMarketDecision,
} = require('../../services/pricing-market-decision-policy');

const MARKET = '11111111-1111-4111-8111-111111111111';
const ACTOR = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-09-07T08:00:00.000Z');

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
