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
jest.mock('../../services/pricing-period-structure', () => ({
  allocateStructurePool: jest.fn(),
}));

const db = require('../../db');
const { allocateStructurePool } = require('../../services/pricing-period-structure');
const {
  OUTCOMES,
  MarketCostAttributionError,
  attributeGroupEvent,
  reverseAttributions,
  correctGroupEventAttribution,
  listEventAttributions,
} = require('../../services/market-cost-attribution-service');

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const CHARGE_ID = '33333333-3333-4333-8333-333333333333';
const M1 = '44444444-4444-4444-8444-444444444444';
const M2 = '55555555-5555-4555-8555-555555555555';

function eventRow(overrides = {}) {
  return {
    id: EVENT_ID,
    charge_id: CHARGE_ID,
    scope_kind: 'GROUP',
    event_kind: 'ACCRUAL',
    amount_kmf: '1000.00',
    economic_from: new Date('2026-09-01T00:00:00.000Z'),
    economic_to: new Date('2026-10-01T00:00:00.000Z'),
    has_adjustments: false,
    ...overrides,
  };
}

function allocation(overrides = {}) {
  return {
    decisional: true,
    status: 'GROUP_ALLOCATION_AVAILABLE',
    policy: {
      charge_id: CHARGE_ID,
      version: 'policy-v1',
      source: 'comite',
      evidence_ref: 'PV-2026-09',
      policy_kind: 'PROPORTIONAL',
      basis_kind: 'PAID_ORDER_COUNT',
      eligibility_kind: 'POSITIVE_BASIS',
      confidence: 'medium',
      base_pool_ratio: 0,
    },
    basis_source: 'orders paid',
    basis_total: 30,
    shares: [
      { market_id: M1, basis_value: 20, allocation_ratio: 0.666667, allocated_kmf: 666.67 },
      { market_id: M2, basis_value: 10, allocation_ratio: 0.333333, allocated_kmf: 333.33 },
    ],
    ...overrides,
  };
}

function activeRow(id, marketId, amount, policyVersion = 'policy-v1') {
  return {
    id,
    market_id: marketId,
    amount_kmf: amount,
    allocation_key: 'PROPORTIONAL:PAID_ORDER_COUNT',
    policy_version: policyVersion,
  };
}

function makeExecutor(state = {}) {
  const inserted = [];
  const sqlLog = [];
  const executor = {
    inserted,
    sqlLog,
    query: jest.fn(async (sql, params) => {
      sqlLog.push(String(sql).trim().split(/\s+/)[0]);
      if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return { rows: [] };
      if (/pg_advisory_xact_lock/.test(sql)) return { rows: [] };
      if (/FROM public\.economic_structure_cost_events/.test(sql)) {
        if (state.nullEventRows) return {};
        return { rows: state.event === null ? [] : [state.event || eventRow()] };
      }
      if (/JOIN public\.markets m/.test(sql)) {
        if (state.nullListRows) return {};
        return { rows: state.listRows || [] };
      }
      if (/FROM public\.market_cost_attributions a/.test(sql)) {
        if (state.nullActiveRows) return {};
        return { rows: state.active || [] };
      }
      if (/INSERT INTO public\.market_cost_attributions/.test(sql)) {
        const row = {
          id: `new-${inserted.length + 1}`,
          source_event_id: params[0],
          market_id: params[1],
          event_kind: params[2],
          amount_kmf: params[3],
          allocation_key: params[4],
          allocation_basis: JSON.parse(params[5]),
          policy_version: params[6],
          reverses_id: params[7],
          recorded_by: params[8],
        };
        inserted.push(row);
        return { rows: [row] };
      }
      throw new Error(`unexpected sql: ${sql}`);
    }),
  };
  return executor;
}

beforeEach(() => {
  jest.clearAllMocks();
  allocateStructurePool.mockResolvedValue(allocation());
});

describe('attributeGroupEvent', () => {
  test('écrit une ATTRIBUTION par marché, conserve le total et trace policy_version', async () => {
    const executor = makeExecutor();
    const policies = [{ charge_id: CHARGE_ID }];

    const result = await attributeGroupEvent({ eventId: EVENT_ID, actorId: ACTOR_ID, policies }, { executor });

    expect(result.outcome).toBe(OUTCOMES.ATTRIBUTED);
    expect(result.written).toHaveLength(2);
    expect(executor.inserted.map((r) => [r.market_id, r.amount_kmf, r.event_kind, r.policy_version])).toEqual([
      [M1, '666.67', 'ATTRIBUTION', 'policy-v1'],
      [M2, '333.33', 'ATTRIBUTION', 'policy-v1'],
    ]);
    const total = executor.inserted.reduce((sum, r) => sum + Math.round(Number(r.amount_kmf) * 100), 0);
    expect(total).toBe(100000);
    expect(executor.inserted[0].reverses_id).toBeNull();
    expect(executor.inserted[0].recorded_by).toBe(ACTOR_ID);
    expect(executor.inserted[0].allocation_key).toBe('PROPORTIONAL:PAID_ORDER_COUNT');
    expect(executor.inserted[0].allocation_basis).toMatchObject({
      policy: { version: 'policy-v1', evidence_ref: 'PV-2026-09' },
      basis_source: 'orders paid',
      basis_total: 30,
      basis_value: 20,
      pool_kmf: 1000,
      period: { from: '2026-09-01T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z' },
    });
    expect(allocateStructurePool).toHaveBeenCalledWith(
      { charge_id: CHARGE_ID, group_pool_kmf: 1000 },
      policies,
      { from: expect.any(Date), to: expect.any(Date) }
    );
  });

  test('ignore une part à zéro mais garde la conservation', async () => {
    allocateStructurePool.mockResolvedValue(allocation({
      shares: [
        { market_id: M1, basis_value: 30, allocation_ratio: 1, allocated_kmf: 1000 },
        { market_id: M2, basis_value: 0, allocation_ratio: 0, allocated_kmf: 0 },
      ],
    }));
    const executor = makeExecutor();

    const result = await attributeGroupEvent(
      { eventId: EVENT_ID, actorId: ACTOR_ID, policies: [{}] },
      { executor }
    );

    expect(result.outcome).toBe(OUTCOMES.ATTRIBUTED);
    expect(executor.inserted).toHaveLength(1);
    expect(executor.inserted[0].market_id).toBe(M1);
  });

  test('noop si une attribution active existe, sans recalcul ni écriture', async () => {
    const executor = makeExecutor({ active: [activeRow('a1', M1, '1000.00')] });

    const result = await attributeGroupEvent(
      { eventId: EVENT_ID, actorId: ACTOR_ID, policies: [{}] },
      { executor }
    );

    expect(result).toMatchObject({ outcome: OUTCOMES.NOOP_ACTIVE_ATTRIBUTION, active_count: 1, written: [] });
    expect(allocateStructurePool).not.toHaveBeenCalled();
    expect(executor.inserted).toHaveLength(0);
  });

  test('une attribution historique déjà reversée ne bloque pas (liste active vide ou absente)', async () => {
    const executor = makeExecutor({ nullActiveRows: true });

    const result = await attributeGroupEvent(
      { eventId: EVENT_ID, actorId: ACTOR_ID, policies: [{}] },
      { executor }
    );

    expect(result.outcome).toBe(OUTCOMES.ATTRIBUTED);
  });

  test('requête active : exclut les attributions ciblées par un REVERSAL', async () => {
    const executor = makeExecutor();
    await attributeGroupEvent({ eventId: EVENT_ID, actorId: ACTOR_ID, policies: [{}] }, { executor });
    const activeCall = executor.query.mock.calls.find(([sql]) => /FROM public\.market_cost_attributions a/.test(sql));
    expect(activeCall[0]).toMatch(/NOT EXISTS[\s\S]*r\.reverses_id = a\.id/);
    expect(activeCall[0]).toMatch(/a\.event_kind = 'ATTRIBUTION'/);
  });

  test('fait non décisionnel : aucune écriture, raison remontée', async () => {
    allocateStructurePool.mockResolvedValue({ decisional: false, status: 'NOT_DECISIONAL_POLICY_MISSING', shares: [] });
    const executor = makeExecutor();

    const result = await attributeGroupEvent(
      { eventId: EVENT_ID, actorId: ACTOR_ID, policies: [{}] },
      { executor }
    );

    expect(result).toEqual({
      outcome: OUTCOMES.NOT_DECISIONAL,
      event_id: EVENT_ID,
      reason: 'NOT_DECISIONAL_POLICY_MISSING',
      written: [],
    });
    expect(executor.inserted).toHaveLength(0);
  });

  test('échec de conservation : lève et n’écrit rien', async () => {
    allocateStructurePool.mockResolvedValue(allocation({
      shares: [{ market_id: M1, basis_value: 30, allocation_ratio: 1, allocated_kmf: 999.99 }],
    }));
    const executor = makeExecutor();

    await expect(
      attributeGroupEvent({ eventId: EVENT_ID, actorId: ACTOR_ID, policies: [{}] }, { executor })
    ).rejects.toMatchObject({ code: 'CONSERVATION_FAILURE' });
    expect(executor.inserted).toHaveLength(0);
  });

  test.each([
    ['eventId invalide', { eventId: 'x', actorId: ACTOR_ID, policies: [{}] }],
    ['actorId absent', { eventId: EVENT_ID, policies: [{}] }],
    ['policies vide', { eventId: EVENT_ID, actorId: ACTOR_ID, policies: [] }],
    ['policies absent', { eventId: EVENT_ID, actorId: ACTOR_ID }],
  ])('refuse une entrée invalide : %s', async (_label, input) => {
    await expect(attributeGroupEvent(input, { executor: makeExecutor() })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
  });

  test('appel sans argument : INVALID_INPUT', async () => {
    await expect(attributeGroupEvent()).rejects.toBeInstanceOf(MarketCostAttributionError);
  });

  test.each([
    ['fait introuvable', { event: null }, 'EVENT_NOT_FOUND'],
    ['réponse sans rows', { nullEventRows: true }, 'EVENT_NOT_FOUND'],
    ['fait MARKET_DIRECT', { event: eventRow({ scope_kind: 'MARKET_DIRECT' }) }, 'EVENT_NOT_GROUP'],
    ['fait ADJUSTMENT', { event: eventRow({ event_kind: 'ADJUSTMENT' }) }, 'EVENT_NOT_ACCRUAL'],
    ['fait déjà ajusté', { event: eventRow({ has_adjustments: true }) }, 'EVENT_ALREADY_ADJUSTED'],
  ])('refuse un fait non attribuable : %s', async (_label, state, code) => {
    const executor = makeExecutor(state);
    await expect(
      attributeGroupEvent({ eventId: EVENT_ID, actorId: ACTOR_ID, policies: [{}] }, { executor })
    ).rejects.toMatchObject({ code });
    expect(executor.inserted).toHaveLength(0);
  });

  test('transaction possédée : BEGIN, verrou, COMMIT puis release', async () => {
    const client = makeExecutor();
    client.release = jest.fn();
    db.getClient.mockResolvedValue(client);

    await attributeGroupEvent({ eventId: EVENT_ID, actorId: ACTOR_ID, policies: [{}] });

    expect(client.sqlLog[0]).toBe('BEGIN');
    expect(client.sqlLog[1]).toBe('SELECT');
    expect(client.sqlLog[client.sqlLog.length - 1]).toBe('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(client.query.mock.calls[1][0]).toMatch(/pg_advisory_xact_lock/);
  });

  test('transaction possédée : ROLLBACK + release sur erreur, même si ROLLBACK échoue', async () => {
    const client = makeExecutor({ event: null });
    client.release = jest.fn();
    const base = client.query.getMockImplementation();
    client.query.mockImplementation(async (sql, params) => {
      if (sql === 'ROLLBACK') throw new Error('rollback failed');
      return base(sql, params);
    });
    db.getClient.mockResolvedValue(client);

    await expect(
      attributeGroupEvent({ eventId: EVENT_ID, actorId: ACTOR_ID, policies: [{}] })
    ).rejects.toMatchObject({ code: 'EVENT_NOT_FOUND' });
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('client sans release : pas d’erreur', async () => {
    const client = makeExecutor();
    db.getClient.mockResolvedValue(client);

    await expect(
      attributeGroupEvent({ eventId: EVENT_ID, actorId: ACTOR_ID, policies: [{}] })
    ).resolves.toMatchObject({ outcome: OUTCOMES.ATTRIBUTED });
  });

  test('executor injecté invalide : TypeError', async () => {
    await expect(
      attributeGroupEvent({ eventId: EVENT_ID, actorId: ACTOR_ID, policies: [{}] }, { executor: {} })
    ).rejects.toBeInstanceOf(TypeError);
  });
});

describe('reverseAttributions', () => {
  test('REVERSAL négatif par attribution active, relié par reverses_id, jamais de DELETE', async () => {
    const executor = makeExecutor({
      active: [activeRow('a1', M1, '666.67'), activeRow('a2', M2, '333.33')],
    });

    const result = await reverseAttributions(
      { eventId: EVENT_ID, actorId: ACTOR_ID, reason: 'politique corrigée' },
      { executor }
    );

    expect(result.outcome).toBe(OUTCOMES.REVERSED);
    expect(executor.inserted.map((r) => [r.event_kind, r.amount_kmf, r.reverses_id, r.market_id])).toEqual([
      ['REVERSAL', '-666.67', 'a1', M1],
      ['REVERSAL', '-333.33', 'a2', M2],
    ]);
    expect(executor.inserted[0].allocation_basis).toEqual({ reversal_of: 'a1', reason: 'politique corrigée' });
    expect(executor.inserted[0].policy_version).toBe('policy-v1');
    expect(executor.inserted[0].source_event_id).toBe(EVENT_ID);
    const sqls = executor.query.mock.calls.map(([sql]) => String(sql));
    expect(sqls.some((sql) => /\b(UPDATE|DELETE)\b/i.test(sql))).toBe(false);
  });

  test('rien à annuler : noop', async () => {
    const executor = makeExecutor({ active: [] });
    const result = await reverseAttributions(
      { eventId: EVENT_ID, actorId: ACTOR_ID, reason: 'erreur de saisie' },
      { executor }
    );
    expect(result).toEqual({ outcome: OUTCOMES.NOTHING_TO_REVERSE, event_id: EVENT_ID, written: [] });
  });

  test('appel sans argument : INVALID_INPUT', async () => {
    await expect(reverseAttributions()).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  test('fait introuvable', async () => {
    await expect(
      reverseAttributions({ eventId: EVENT_ID, actorId: ACTOR_ID, reason: 'erreur de saisie' }, {
        executor: makeExecutor({ event: null }),
      })
    ).rejects.toMatchObject({ code: 'EVENT_NOT_FOUND' });
  });

  test.each([[undefined], ['ab'], ['x'.repeat(501)]])('motif invalide : %p', async (reason) => {
    await expect(
      reverseAttributions({ eventId: EVENT_ID, actorId: ACTOR_ID, reason }, { executor: makeExecutor() })
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  test('un fait ajusté reste annulable (pas de contrôle d’attribuabilité)', async () => {
    const executor = makeExecutor({
      event: eventRow({ has_adjustments: true }),
      active: [activeRow('a1', M1, '1000.00')],
    });
    const result = await reverseAttributions(
      { eventId: EVENT_ID, actorId: ACTOR_ID, reason: 'ajustement amont' },
      { executor }
    );
    expect(result.outcome).toBe(OUTCOMES.REVERSED);
  });
});

describe('correctGroupEventAttribution', () => {
  const base = { eventId: EVENT_ID, actorId: ACTOR_ID, policies: [{}], reason: 'nouvelle politique' };

  test('REVERSAL des actives puis nouvelle ATTRIBUTION dans l’ordre', async () => {
    allocateStructurePool.mockResolvedValue(allocation({
      policy: { ...allocation().policy, version: 'policy-v2' },
    }));
    const executor = makeExecutor({
      active: [activeRow('a1', M1, '700.00'), activeRow('a2', M2, '300.00')],
    });

    const result = await correctGroupEventAttribution(base, { executor });

    expect(result.outcome).toBe(OUTCOMES.CORRECTED);
    expect(executor.inserted.map((r) => [r.event_kind, r.amount_kmf, r.policy_version])).toEqual([
      ['REVERSAL', '-700.00', 'policy-v1'],
      ['REVERSAL', '-300.00', 'policy-v1'],
      ['ATTRIBUTION', '666.67', 'policy-v2'],
      ['ATTRIBUTION', '333.33', 'policy-v2'],
    ]);
  });

  test('répartition identique : noop sans écriture', async () => {
    const executor = makeExecutor({
      active: [activeRow('a1', M1, '666.67'), activeRow('a2', M2, '333.33')],
    });
    const result = await correctGroupEventAttribution(base, { executor });
    expect(result).toEqual({ outcome: OUTCOMES.NOOP_UNCHANGED, event_id: EVENT_ID, written: [] });
    expect(executor.inserted).toHaveLength(0);
  });

  test('nombre de marchés différent : correction', async () => {
    const executor = makeExecutor({ active: [activeRow('a1', M1, '1000.00')] });
    const result = await correctGroupEventAttribution(base, { executor });
    expect(result.outcome).toBe(OUTCOMES.CORRECTED);
    expect(executor.inserted).toHaveLength(3);
  });

  test('même montant mais autre politique : correction', async () => {
    const executor = makeExecutor({
      active: [activeRow('a1', M1, '666.67', 'policy-v0'), activeRow('a2', M2, '333.33', 'policy-v0')],
    });
    const result = await correctGroupEventAttribution(base, { executor });
    expect(result.outcome).toBe(OUTCOMES.CORRECTED);
  });

  test('non décisionnel : rien n’est annulé', async () => {
    allocateStructurePool.mockResolvedValue({ decisional: false, status: 'NOT_DECISIONAL_ZERO_BASIS', shares: [] });
    const executor = makeExecutor({ active: [activeRow('a1', M1, '1000.00')] });

    const result = await correctGroupEventAttribution(base, { executor });

    expect(result).toMatchObject({ outcome: OUTCOMES.NOT_DECISIONAL, reason: 'NOT_DECISIONAL_ZERO_BASIS' });
    expect(executor.inserted).toHaveLength(0);
  });

  test('aucune attribution active : NO_ACTIVE_ATTRIBUTION', async () => {
    await expect(
      correctGroupEventAttribution(base, { executor: makeExecutor({ active: [] }) })
    ).rejects.toMatchObject({ code: 'NO_ACTIVE_ATTRIBUTION' });
  });

  test('fait non attribuable : refus avant toute écriture', async () => {
    const executor = makeExecutor({ event: eventRow({ scope_kind: 'MARKET_DIRECT' }) });
    await expect(correctGroupEventAttribution(base, { executor })).rejects.toMatchObject({
      code: 'EVENT_NOT_GROUP',
    });
    expect(executor.inserted).toHaveLength(0);
  });

  test('appel sans argument : INVALID_INPUT', async () => {
    await expect(correctGroupEventAttribution()).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  test('motif obligatoire', async () => {
    await expect(
      correctGroupEventAttribution({ ...base, reason: '' }, { executor: makeExecutor() })
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});

describe('listEventAttributions', () => {
  const row = (id, kind, marketId, amount, active) => ({
    id, event_kind: kind, market_id: marketId, market_code: marketId === M1 ? 'CM' : 'CG',
    amount_kmf: amount, allocation_key: 'PROPORTIONAL:PAID_ORDER_COUNT', policy_version: 'policy-v1',
    reverses_id: null, recorded_by: ACTOR_ID, recorded_at: new Date('2026-10-03T00:00:00.000Z'), active,
  });

  test('retourne le journal avec total actif et conservation', async () => {
    const executor = makeExecutor({
      listRows: [
        row('a1', 'ATTRIBUTION', M1, '666.67', true),
        row('a2', 'ATTRIBUTION', M2, '333.33', true),
      ],
    });

    const result = await listEventAttributions({ eventId: EVENT_ID }, { executor });

    expect(result).toMatchObject({
      event_id: EVENT_ID,
      event_amount_kmf: '1000.00',
      active_total_kmf: '1000.00',
      conserved: true,
    });
    expect(result.attributions).toHaveLength(2);
    expect(result.attributions[0].market_code).toBe('CM');
  });

  test('exclut du total les attributions reversées et les REVERSAL', async () => {
    const executor = makeExecutor({
      listRows: [
        row('a1', 'ATTRIBUTION', M1, '1000.00', false),
        row('r1', 'REVERSAL', M1, '-1000.00', false),
        row('a2', 'ATTRIBUTION', M1, '600.00', true),
      ],
    });

    const result = await listEventAttributions({ eventId: EVENT_ID }, { executor });

    expect(result.active_total_kmf).toBe('600.00');
    expect(result.conserved).toBe(false);
  });

  test('aucune attribution : total 0 et non conservé', async () => {
    const result = await listEventAttributions({ eventId: EVENT_ID }, { executor: makeExecutor({ nullListRows: true }) });
    expect(result).toMatchObject({ active_total_kmf: '0.00', conserved: false, attributions: [] });
  });

  test('fait introuvable', async () => {
    await expect(
      listEventAttributions({ eventId: EVENT_ID }, { executor: makeExecutor({ event: null }) })
    ).rejects.toMatchObject({ code: 'EVENT_NOT_FOUND' });
  });

  test('eventId invalide et appel sans argument : INVALID_INPUT', async () => {
    await expect(listEventAttributions({ eventId: 'x' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(listEventAttributions()).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  test('sans executor injecté : utilise db.query', async () => {
    const ex = makeExecutor();
    db.query.mockImplementation(ex.query);
    const result = await listEventAttributions({ eventId: EVENT_ID });
    expect(result.event_id).toBe(EVENT_ID);
    expect(db.query).toHaveBeenCalled();
  });
});
