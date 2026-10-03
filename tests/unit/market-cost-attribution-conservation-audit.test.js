'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => ({
  query: jest.fn(),
  getClient: jest.fn(),
  pool: { end: jest.fn().mockResolvedValue() },
}));
jest.mock('../../services/pricing-period-structure', () => ({
  allocateStructurePool: jest.fn(),
}));

const db = require('../../db');
const { auditAttributionConservation } = require('../../services/market-cost-attribution-service');
const { main, parseEventIds } = require('../../scripts/market-cost-attribution-conservation-check');

const E1 = '11111111-1111-4111-8111-111111111111';
const E2 = '22222222-2222-4222-8222-222222222222';
const E3 = '33333333-3333-4333-8333-333333333333';

function row(overrides = {}) {
  return {
    event_id: E1,
    event_amount_kmf: '60000.00',
    scope_kind: 'GROUP',
    event_kind: 'ACCRUAL',
    active_total_kmf: '60000.00',
    ...overrides,
  };
}

describe('auditAttributionConservation', () => {
  beforeEach(() => {
    db.query.mockReset();
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => { console.log.mockRestore(); });

  test('conservé quand la somme active égale le montant de chaque fait', async () => {
    db.query.mockResolvedValueOnce({ rows: [row(), row({ event_id: E2, event_amount_kmf: '100.10', active_total_kmf: '100.10' })] });

    const report = await auditAttributionConservation();

    expect(report).toEqual({ checked_events: 2, violations: [], conserved: true });
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain("a.event_kind = 'ATTRIBUTION'");
    expect(sql).toContain('r.reverses_id = a.id');
    expect(params).toEqual([null]);
  });

  test('signale NOT_CONSERVED au centime près', async () => {
    db.query.mockResolvedValueOnce({ rows: [row({ active_total_kmf: '59999.99' })] });

    const report = await auditAttributionConservation();

    expect(report.conserved).toBe(false);
    expect(report.violations).toEqual([
      { event_id: E1, event_amount_kmf: '60000.00', active_total_kmf: '59999.99', code: 'NOT_CONSERVED' },
    ]);
  });

  test('signale EVENT_NOT_ATTRIBUTABLE pour un fait non GROUP ACCRUAL', async () => {
    db.query.mockResolvedValueOnce({ rows: [
      row({ event_id: E2, scope_kind: 'MARKET_DIRECT' }),
      row({ event_id: E3, event_kind: 'ADJUSTMENT' }),
    ] });

    const report = await auditAttributionConservation();

    expect(report.violations.map((v) => [v.event_id, v.code])).toEqual([
      [E2, 'EVENT_NOT_ATTRIBUTABLE'],
      [E3, 'EVENT_NOT_ATTRIBUTABLE'],
    ]);
  });

  test('filtre par eventIds validés et accepte un exécuteur injecté', async () => {
    const executor = { query: jest.fn().mockResolvedValue({ rows: [row()] }) };

    const report = await auditAttributionConservation({ eventIds: [E1] }, { executor });

    expect(report.checked_events).toBe(1);
    expect(executor.query.mock.calls[0][1]).toEqual([[E1]]);
    expect(db.query).not.toHaveBeenCalled();
    await expect(auditAttributionConservation({ eventIds: ['pas-un-uuid'] }))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  test('aucune attribution : rien à contrôler, conservé', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    expect(await auditAttributionConservation()).toEqual({ checked_events: 0, violations: [], conserved: true });
  });

  test('réponse sans rows : traitée comme vide', async () => {
    db.query.mockResolvedValueOnce({});
    expect(await auditAttributionConservation()).toEqual({ checked_events: 0, violations: [], conserved: true });
  });
});

describe('script market-cost-attribution-conservation-check', () => {
  beforeEach(() => {
    db.query.mockReset();
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => { console.log.mockRestore(); });

  test('parseEventIds lit --event-id répété, null sinon', () => {
    expect(parseEventIds([])).toBeNull();
    expect(parseEventIds(['--event-id', E1, '--event-id', E2])).toEqual([E1, E2]);
  });

  test('code 0 quand conservé', async () => {
    db.query.mockResolvedValueOnce({ rows: [row()] });
    expect(await main([])).toBe(0);
  });

  test('code 1 et détail quand une violation existe', async () => {
    db.query.mockResolvedValueOnce({ rows: [row({ active_total_kmf: '1.00' })] });
    expect(await main(['--event-id', E1])).toBe(1);
    expect(console.log.mock.calls.flat().join('\n')).toContain('[NOT_CONSERVED]');
  });
});
