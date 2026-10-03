'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => ({
  query: jest.fn(),
  getClient: jest.fn(),
}));

const db = require('../../db');
const { allocateStructurePool } = require('../../services/pricing-period-structure');

const CHARGE_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_CHARGE_ID = '66666666-6666-4666-8666-666666666666';
const M1 = '44444444-4444-4444-8444-444444444444';
const M2 = '55555555-5555-4555-8555-555555555555';
const PERIOD = { from: '2026-09-01T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z' };
const POOL = { charge_id: CHARGE_ID, group_pool_kmf: 1000 };

function policy(overrides = {}) {
  return {
    charge_id: CHARGE_ID,
    version: 'policy-v1',
    source: 'comite',
    evidence_ref: 'PV-2026-09',
    policy_kind: 'PROPORTIONAL',
    basis_kind: 'PAID_ORDER_COUNT',
    eligibility_kind: 'POSITIVE_BASIS',
    confidence: 'medium',
    effective_from: '2026-01-01T00:00:00.000Z',
    effective_to: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('allocateStructurePool — autorité unique de ventilation d’un pool', () => {
  test('ventile un pool selon les commandes payées et conserve le total', async () => {
    db.query.mockResolvedValueOnce({
      rows: [
        { market_id: M1, basis_value: '20' },
        { market_id: M2, basis_value: '10' },
      ],
    });

    const result = await allocateStructurePool(POOL, [policy()], PERIOD);

    expect(result.decisional).toBe(true);
    expect(result.policy.version).toBe('policy-v1');
    expect(result.basis_total).toBe(30);
    expect(result.shares.map((s) => [s.market_id, s.allocated_kmf])).toEqual([
      [M1, 666.67],
      [M2, 333.33],
    ]);
    expect(result.shares.reduce((sum, s) => sum + s.allocated_kmf, 0)).toBeCloseTo(1000, 2);
  });

  test('aucune politique : NOT_DECISIONAL_POLICY_MISSING', async () => {
    const result = await allocateStructurePool(POOL, undefined, PERIOD);
    expect(result).toMatchObject({ decisional: false, status: 'NOT_DECISIONAL_POLICY_MISSING', shares: [] });
    expect(db.query).not.toHaveBeenCalled();
  });

  test('politique d’une autre charge : NOT_DECISIONAL_POLICY_MISSING', async () => {
    const result = await allocateStructurePool(POOL, [policy({ charge_id: OTHER_CHARGE_ID })], PERIOD);
    expect(result.status).toBe('NOT_DECISIONAL_POLICY_MISSING');
  });

  test('politique ne couvrant pas toute la fenêtre : NOT_DECISIONAL_POLICY_MISSING', async () => {
    const result = await allocateStructurePool(
      POOL,
      [policy({ effective_from: '2026-09-15T00:00:00.000Z' })],
      PERIOD
    );
    expect(result.status).toBe('NOT_DECISIONAL_POLICY_MISSING');
  });

  test('deux politiques candidates : NOT_DECISIONAL_POLICY_AMBIGUOUS', async () => {
    const result = await allocateStructurePool(POOL, [policy(), policy({ version: 'policy-v2' })], PERIOD);
    expect(result).toMatchObject({ decisional: false, status: 'NOT_DECISIONAL_POLICY_AMBIGUOUS', policy: null });
  });

  test('marché explicite inconnu : NOT_DECISIONAL_UNKNOWN_MARKET, aucune répartition', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: M1 }] });
    const result = await allocateStructurePool(
      POOL,
      [policy({
        basis_kind: 'EQUAL_ELIGIBLE',
        eligibility_kind: 'EXPLICIT_MARKETS',
        confidence: 'low',
        eligible_market_ids: [M1, M2],
      })],
      PERIOD
    );
    expect(result).toMatchObject({ decisional: false, status: 'NOT_DECISIONAL_UNKNOWN_MARKET', shares: [] });
  });

  test('assiette nulle : NOT_DECISIONAL_ZERO_BASIS, pas de repli silencieux', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ market_id: M1, basis_value: '0' }] });
    const result = await allocateStructurePool(POOL, [policy()], PERIOD);
    expect(result.decisional).toBe(false);
    expect(result.status).toMatch(/^NOT_DECISIONAL_/);
  });

  test('fenêtre invalide : lève', async () => {
    await expect(
      allocateStructurePool(POOL, [policy()], { from: PERIOD.to, to: PERIOD.from })
    ).rejects.toThrow('economic period bounds are invalid');
  });
});
