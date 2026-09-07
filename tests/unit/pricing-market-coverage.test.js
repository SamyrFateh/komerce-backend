'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => ({
  query: jest.fn(),
}));

jest.mock('../../services/pricing-maturity', () => ({
  computeMarketMaturityWatermark: jest.fn(),
  getOrderMaturity: jest.fn(),
}));

jest.mock('../../services/pricing-period-structure', () => ({
  computePeriodStructureTruth: jest.fn(),
}));

const db = require('../../db');
const {
  computeMarketMaturityWatermark,
  getOrderMaturity,
} = require('../../services/pricing-maturity');
const { computePeriodStructureTruth } = require('../../services/pricing-period-structure');
const {
  COVERAGE_STATUSES,
  computeMarketCoverage,
  _normalizeCoveragePolicy,
  _normalizeRiskReconciliation,
  _loadMatureOrderIds,
} = require('../../services/pricing-market-coverage');

const MARKET_ID = '11111111-1111-1111-1111-111111111111';
const ORDER_1 = '22222222-2222-2222-2222-222222222222';
const ORDER_2 = '33333333-3333-3333-3333-333333333333';
const FROM = '2026-09-01T00:00:00.000Z';
const TO = '2026-10-01T00:00:00.000Z';

function coveragePolicy(overrides = {}) {
  return {
    version: 'coverage-v1',
    source: 'docs/policy/coverage-v1',
    evidence_ref: 'decision://coverage/v1',
    maturity_threshold: 0.9,
    coverage_threshold: 1,
    disposed_contribution_treatment: 'EXCLUDE_FROM_NUMERATOR',
    effective_from: '2026-08-01T00:00:00.000Z',
    effective_to: null,
    ...overrides,
  };
}

function riskTruth(overrides = {}) {
  return {
    status: 'RECONCILED',
    market_id: MARKET_ID,
    from: FROM,
    to: TO,
    actual_risk_cost_kmf: 5000,
    source: 'risk-period-close',
    version: 'risk-v1',
    evidence_ref: 'risk-close://cm/2026-09',
    ...overrides,
  };
}

function maturityTruth(overrides = {}) {
  return {
    decision_status: 'READY_FOR_NEXT_GATE',
    status: 'FULLY_MATURE',
    total_orders: 2,
    mature_orders: 2,
    disposed_orders: 0,
    maturity_ratio: 1,
    disposition_ratio: 0,
    effective_pass_ratio: 1,
    disposition_gate: { decisional: true, status: 'NOT_REQUIRED' },
    ...overrides,
  };
}

function structureTruth(overrides = {}) {
  return {
    status: 'MARKET_PERIOD_TRUTH_ALLOCATED',
    market_n3_decisional: true,
    market_n3_total_kmf: 10000,
    market_direct_kmf: 4000,
    market_shared_n3_kmf: 6000,
    ...overrides,
  };
}

function aggregateContributionRow(overrides = {}) {
  return {
    mature_order_count: 2,
    revenue_kmf: '50000',
    transaction_variable_kmf: '20000',
    unknown_actual_kmf: '0',
    estimated_risk_kmf: '3000',
    ...overrides,
  };
}

function arrangeHappyPath({ contributionRow = {}, maturity = {}, structure = {}, orderMaturities = null } = {}) {
  computeMarketMaturityWatermark.mockResolvedValue(maturityTruth(maturity));
  computePeriodStructureTruth.mockResolvedValue(structureTruth(structure));
  getOrderMaturity
    .mockResolvedValueOnce(orderMaturities?.[0] || { mature: true })
    .mockResolvedValueOnce(orderMaturities?.[1] || { mature: true });
  db.query
    .mockResolvedValueOnce({ rows: [{ id: ORDER_1 }, { id: ORDER_2 }] })
    .mockResolvedValueOnce({ rows: [aggregateContributionRow(contributionRow)] });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('pricing-market-coverage — politique gouvernée', () => {
  test('aucun seuil ni traitement de disposition implicite', () => {
    const period = { from: new Date(FROM), to: new Date(TO) };
    expect(() => _normalizeCoveragePolicy({
      ...coveragePolicy(),
      disposed_contribution_treatment: undefined,
    }, period)).toThrow('EXCLUDE_FROM_NUMERATOR');

    expect(() => _normalizeCoveragePolicy(coveragePolicy({ maturity_threshold: 1.2 }), period))
      .toThrow('between 0 and 1');

    expect(() => _normalizeCoveragePolicy(coveragePolicy({
      effective_from: '2026-09-15T00:00:00.000Z',
    }), period)).toThrow('does not cover canonical period');
  });

  test('la réconciliation risque doit porter exactement le même marché et la même fenêtre', () => {
    const period = { from: new Date(FROM), to: new Date(TO) };
    expect(() => _normalizeRiskReconciliation(riskTruth({
      market_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    }), MARKET_ID, period)).toThrow('market_id mismatch');

    expect(() => _normalizeRiskReconciliation(riskTruth({
      to: '2026-09-30T00:00:00.000Z',
    }), MARKET_ID, period)).toThrow('exact canonical period');
  });
});

describe('pricing-market-coverage — numérateur de contribution', () => {
  test('une commande disposée mais non mature est exclue du numérateur', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: ORDER_1 }, { id: ORDER_2 }] });
    getOrderMaturity
      .mockResolvedValueOnce({ mature: true })
      .mockResolvedValueOnce({ mature: false, disposition_effective: true });

    const ids = await _loadMatureOrderIds(MARKET_ID, {
      from: new Date(FROM),
      to: new Date(TO),
    });

    expect(ids).toEqual([ORDER_1]);
  });
});

describe('pricing-market-coverage — gate', () => {
  test('COVERED seulement avec maturité, N3 et risque réconciliés', async () => {
    arrangeHappyPath();

    const result = await computeMarketCoverage({
      marketId: MARKET_ID,
      from: FROM,
      to: TO,
      coveragePolicy: coveragePolicy(),
      dispositionPolicy: null,
      allocationPolicies: [{ charge_id: 'charge-1' }],
      riskReconciliation: riskTruth(),
    });

    expect(result.coverage_status).toBe(COVERAGE_STATUSES.COVERED);
    expect(result.coverage_ratio).toBe(2.5); // (50k - 20k - 5k) / 10k
    expect(result.numerator_contribution_kmf).toBe(25000);
    expect(result.denominator_n3_kmf).toBe(10000);
    expect(result.contribution.provisional_contribution_after_estimated_risk_kmf).toBe(27000);
    expect(result.contribution.risk_variance_vs_provision_kmf).toBe(2000);
    expect(result.authorization).toBe('ALLOW_NEW_UNDER_CDR_POSITION');
    expect(computePeriodStructureTruth).toHaveBeenCalledWith(expect.objectContaining({
      marketId: MARKET_ID,
      allocationPolicies: [{ charge_id: 'charge-1' }],
    }));
  });

  test('UNCOVERED quand le ratio réconcilié reste sous le seuil', async () => {
    arrangeHappyPath({
      structure: { market_n3_total_kmf: 20000 },
      contributionRow: { revenue_kmf: '35000', transaction_variable_kmf: '20000' },
    });

    const result = await computeMarketCoverage({
      marketId: MARKET_ID,
      from: FROM,
      to: TO,
      coveragePolicy: coveragePolicy(),
      allocationPolicies: [],
      riskReconciliation: riskTruth({ actual_risk_cost_kmf: 5000 }),
    });

    expect(result.coverage_status).toBe(COVERAGE_STATUSES.UNCOVERED);
    expect(result.coverage_ratio).toBe(0.5);
    expect(result.authorization).toBe('DENY_NEW_UNDER_CDR_POSITION');
  });

  test('absence de vérité risque reste NOT_DECISIONAL même si la provision estimée vaut zéro', async () => {
    arrangeHappyPath({ contributionRow: { estimated_risk_kmf: '0' } });

    const result = await computeMarketCoverage({
      marketId: MARKET_ID,
      from: FROM,
      to: TO,
      coveragePolicy: coveragePolicy(),
      allocationPolicies: [],
    });

    expect(result.coverage_status).toBe(COVERAGE_STATUSES.NOT_DECISIONAL);
    expect(result.coverage_ratio).toBeNull();
    expect(result.reason).toBe('RISK_RECONCILIATION_REQUIRED');
    expect(result.authorization).toBe('DENY_NEW_UNDER_CDR_POSITION');
  });

  test('maturité insuffisante bloque avant toute autorisation', async () => {
    arrangeHappyPath({ maturity: { maturity_ratio: 0.8 } });

    const result = await computeMarketCoverage({
      marketId: MARKET_ID,
      from: FROM,
      to: TO,
      coveragePolicy: coveragePolicy({ maturity_threshold: 0.9 }),
      allocationPolicies: [],
      riskReconciliation: riskTruth(),
    });

    expect(result.coverage_status).toBe(COVERAGE_STATUSES.NOT_DECISIONAL);
    expect(result.reason).toBe('MATURITY_THRESHOLD_NOT_MET');
  });

  test('N3 partiel ou non alloué ne produit jamais de ratio', async () => {
    arrangeHappyPath({
      structure: {
        market_n3_decisional: false,
        market_n3_total_kmf: null,
        status: 'NOT_DECISIONAL_SHARED_ALLOCATION_POLICY',
      },
    });

    const result = await computeMarketCoverage({
      marketId: MARKET_ID,
      from: FROM,
      to: TO,
      coveragePolicy: coveragePolicy(),
      allocationPolicies: [],
      riskReconciliation: riskTruth(),
    });

    expect(result.coverage_status).toBe(COVERAGE_STATUSES.NOT_DECISIONAL);
    expect(result.coverage_ratio).toBeNull();
    expect(result.reason).toBe('MARKET_N3_NOT_DECISIONAL');
  });

  test('un cost_type réel inconnu rend le numérateur non décisionnel', async () => {
    arrangeHappyPath({ contributionRow: { unknown_actual_kmf: '250' } });

    const result = await computeMarketCoverage({
      marketId: MARKET_ID,
      from: FROM,
      to: TO,
      coveragePolicy: coveragePolicy(),
      allocationPolicies: [],
      riskReconciliation: riskTruth(),
    });

    expect(result.coverage_status).toBe(COVERAGE_STATUSES.NOT_DECISIONAL);
    expect(result.reason).toBe('UNKNOWN_ACTUAL_VARIABLE_COST_TYPE');
  });

  test('le compteur de commandes MATURE doit correspondre au jeu réellement agrégé', async () => {
    arrangeHappyPath({ contributionRow: { mature_order_count: 1 } });

    const result = await computeMarketCoverage({
      marketId: MARKET_ID,
      from: FROM,
      to: TO,
      coveragePolicy: coveragePolicy(),
      allocationPolicies: [],
      riskReconciliation: riskTruth(),
    });

    expect(result.coverage_status).toBe(COVERAGE_STATUSES.NOT_DECISIONAL);
    expect(result.reason).toBe('MATURE_ORDER_SET_MISMATCH');
  });
});
