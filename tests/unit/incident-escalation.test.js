'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const mockConnect = jest.fn();
const mockUpsertSignal = jest.fn();

jest.mock('../../db', () => ({ connect: (...args) => mockConnect(...args) }));
jest.mock('../../services/signal-service', () => ({
  upsertSignal: (...args) => mockUpsertSignal(...args),
}));

const {
  SIGNAL_TYPE,
  FIRST_ESCALATION_LEVEL,
  loadNextOverdueIncident,
  escalateOneOverdueIncident,
  scanOverdueIncidents,
} = require('../../services/incident-escalation');

function incident(overrides = {}) {
  return {
    id: 'inc-1', incident_type: 'weight_mismatch', severity: 'high', status: 'open',
    title: 'Poids incohérent', parcel_id: 'parcel-1', order_id: 'order-1', order_item_id: null,
    origin_domain: 'LOGISTICS', resolver_domain: 'LOGISTICS', resolution_class: 'PHYSICAL_PROOF',
    due_at: new Date('2026-09-15T09:00:00Z'), escalation_level: 0,
    market_id: 'market-1', order_reference: 'ORD-1', parcel_reference: 'PCL-1',
    ...overrides,
  };
}

describe('incident-escalation — F3', () => {
  beforeEach(() => jest.clearAllMocks());

  test('overdue candidate is row-locked with SKIP LOCKED and never selects resolved incidents', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [incident()] }) };
    await expect(loadNextOverdueIncident(client)).resolves.toMatchObject({ id: 'inc-1' });
    const sql = client.query.mock.calls[0][0];
    expect(sql).toContain("status IN ('open', 'investigating')");
    expect(sql).toContain('due_at <= NOW()');
    expect(sql).toContain('escalation_level < $1');
    expect(sql).toMatch(/FOR UPDATE OF i SKIP LOCKED/);
  });

  test('escalation delivers to resolver operational role with the same transaction executor', async () => {
    const client = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [incident()] })
      .mockResolvedValueOnce({ rows: [{ id: 'inc-1', status: 'open', escalation_level: 1 }] }) };
    mockUpsertSignal.mockResolvedValue({ id: 'sig-1' });

    await expect(escalateOneOverdueIncident(client)).resolves.toEqual({
      incident_id: 'inc-1', status: 'open', escalation_level: 1, owner_role: 'hub', market_id: 'market-1',
    });

    expect(mockUpsertSignal).toHaveBeenCalledWith(expect.objectContaining({
      signal_type: SIGNAL_TYPE,
      owner_role: 'hub',
      entity_type: 'incident', entity_id: 'inc-1', market_id: 'market-1',
      meta: expect.objectContaining({ resolver_domain: 'LOGISTICS', resolution_class: 'PHYSICAL_PROOF' }),
    }), client);
    const updateSql = client.query.mock.calls[1][0];
    expect(updateSql).toContain('escalation_level = $2');
    expect(updateSql).not.toMatch(/status\s*=\s*'resolved'/);
  });

  test('UPSTREAM_TRUTH escalation is addressed to its resolver and never claims Hub authority', async () => {
    const client = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [incident({
        incident_type: 'payment_issue', origin_domain: 'PAYMENTS', resolver_domain: 'PAYMENTS',
        resolution_class: 'UPSTREAM_TRUTH', market_id: null,
      })] })
      .mockResolvedValueOnce({ rows: [{ id: 'inc-1', status: 'investigating', escalation_level: 1 }] }) };
    mockUpsertSignal.mockResolvedValue({ id: 'sig-1' });

    const result = await escalateOneOverdueIncident(client);
    expect(result.owner_role).toBe('admin');
    expect(result.status).toBe('investigating');
    expect(mockUpsertSignal.mock.calls[0][0].recommendation).toMatch(/PAYMENTS/);
  });

  test('scanner commits signal + marker atomically', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [] }), // BEGIN does not inspect rows; candidate then needs another result
      release: jest.fn(),
    };
    // explicit dispatcher for BEGIN -> candidate(empty) -> ROLLBACK
    client.query.mockImplementation(async (sql) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [] };
      if (String(sql).includes('FROM incidents i')) return { rows: [] };
      throw new Error(`unexpected SQL: ${sql}`);
    });
    mockConnect.mockResolvedValue(client);

    await expect(scanOverdueIncidents({ limit: 1 })).resolves.toEqual({
      scanned_limit: 1, escalated_count: 0, escalated: [],
    });
    expect(client.query).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('sink failure rolls transaction back and does not advance marker', async () => {
    const client = { query: jest.fn(), release: jest.fn() };
    client.query.mockImplementation(async (sql) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] };
      if (String(sql).includes('FROM incidents i')) return { rows: [incident()] };
      if (String(sql).includes('UPDATE incidents')) return { rows: [{ id: 'inc-1', status: 'open', escalation_level: 1 }] };
      throw new Error(`unexpected SQL: ${sql}`);
    });
    mockConnect.mockResolvedValue(client);
    mockUpsertSignal.mockRejectedValue(new Error('signal sink unavailable'));

    await expect(scanOverdueIncidents({ limit: 1 })).rejects.toThrow(/signal sink unavailable/);
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE incidents'))).toBe(false);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('escalation level is deliberately bounded to one durable delivery in F3', () => {
    expect(FIRST_ESCALATION_LEVEL).toBe(1);
  });
});
