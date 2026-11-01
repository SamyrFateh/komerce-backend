'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));

const service = require('../../services/signal-admin-service');

beforeEach(() => jest.clearAllMocks());

test('family mapping is server-owned', () => {
  expect(service.familyForType('parcel_blocked')).toBe('ops');
  expect(service.familyForType('margin_drift')).toBe('eco');
  expect(service.familyForType('supplier_payment_review')).toBe('eco');
  expect(service.familyForType('stock_rupture')).toBe('sourcing');
  expect(service.familyForType('best_seller_local_unavailable')).toBe('sourcing');
  expect(service.familyForType('dispute_sensitive')).toBe('disputes');
  expect(service.familyForType('future_signal')).toBe('other');
});

test('listSignals defaults to global NULL scope and parameterizes family/pagination', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: 'uuid-1', signal_ref: 'KSG-000001' }] })
    .mockResolvedValueOnce({ rows: [{ count: '1' }] });

  const result = await service.listSignals({ family: 'ops', limit: 9999, offset: 4 });

  expect(result.limit).toBe(200);
  expect(result.offset).toBe(4);
  expect(result.total).toBe(1);
  const [sql, params] = mockQuery.mock.calls[0];
  expect(sql).toContain("s.status IN ('open','acknowledged')");
  expect(sql).toContain('s.signal_type = ANY($5::text[])');
  expect(sql).toContain('s.market_id IS NOT DISTINCT FROM $6::uuid');
  expect(sql).toContain('LIMIT $7 OFFSET $8');
  expect(params).toEqual([null, null, null, null, service.FAMILY_TYPES.ops, null, 200, 4]);

  const [countSql, countParams] = mockQuery.mock.calls[1];
  expect(countSql).toContain('s.market_id IS NOT DISTINCT FROM $6::uuid');
  expect(countParams).toEqual([null, null, null, null, service.FAMILY_TYPES.ops, null]);
});

test('listSignals accepts only a server supplied exact market parameter', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ count: '0' }] });
  await service.listSignals({ market_id: 'market-cm', severity: 'warning' });
  const [sql, params] = mockQuery.mock.calls[0];
  expect(sql).toContain('s.market_id IS NOT DISTINCT FROM $6::uuid');
  expect(params[5]).toBe('market-cm');
});

test('listSignals passes arbitrary filter values only as SQL parameters', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ count: '0' }] });
  const attack = "warning' OR 1=1 --";
  await service.listSignals({ status: 'open', severity: attack, signal_type: 'parcel_blocked', owner_role: 'admin' });
  const [sql, params] = mockQuery.mock.calls[0];
  expect(sql).not.toContain(attack);
  // severity est désormais une liste (support de plusieurs valeurs, ex.
  // ?severity=critical,urgent) — toujours liée en paramètre PostgreSQL via
  // ANY($2::text[]), jamais concaténée dans le texte SQL. La valeur malveillante
  // finit dans un tableau à un seul élément, jamais interprétée comme SQL.
  expect(params).toEqual(['open', [attack], 'parcel_blocked', 'admin', null, null, 50, 0]);
});

test('acknowledgeByRef is global-only by default', async () => {
  mockQuery.mockResolvedValue({ rows: [{ id: 'uuid-1', signal_ref: 'KSG-000001', status: 'acknowledged' }] });
  const result = await service.acknowledgeByRef('KSG-000001');
  const [sql, params] = mockQuery.mock.calls[0];
  expect(sql).toContain('WHERE signal_ref = $1');
  expect(sql).toContain('market_id IS NOT DISTINCT FROM $2::uuid');
  expect(sql).toContain("status = 'open'");
  expect(params).toEqual(['KSG-000001', null]);
  expect(result.signal_ref).toBe('KSG-000001');
});

test('acknowledgeByRef market scope cannot mutate a global or another market signal', async () => {
  mockQuery.mockResolvedValue({ rows: [{ signal_ref: 'KSG-000010', status: 'acknowledged' }] });
  await service.acknowledgeByRef('KSG-000010', 'market-cm');
  const [, params] = mockQuery.mock.calls[0];
  expect(params).toEqual(['KSG-000010', 'market-cm']);
});

test('snooze defaults to 24h and keeps exact scope', async () => {
  mockQuery.mockResolvedValue({ rows: [{ signal_ref: 'KSG-000002', status: 'snoozed' }] });
  await service.snoozeByRef('KSG-000002', 'invalid', 'market-cg');
  const [sql, params] = mockQuery.mock.calls[0];
  expect(sql).toContain("status IN ('open','acknowledged')");
  expect(sql).toContain('market_id IS NOT DISTINCT FROM $3::uuid');
  expect(params).toEqual(['KSG-000002', '24', 'market-cg']);
});

test('resolve clears snooze and resolves only the exact market lifecycle', async () => {
  mockQuery.mockResolvedValue({ rows: [{ signal_ref: 'KSG-000003', status: 'resolved' }] });
  await service.resolveByRef('KSG-000003', 'admin-1', 'market-km', undefined, ' Fait ');
  const [sql, params] = mockQuery.mock.calls[0];
  expect(sql).toContain("status IN ('open','acknowledged','snoozed')");
  expect(sql).toContain('snoozed_until = NULL');
  expect(sql).toContain('market_id IS NOT DISTINCT FROM $3::uuid');
  expect(sql).toContain('signal_type <> ALL($5::text[])');
  expect(sql).toContain("'resolution_note'");
  expect(params).toEqual(['KSG-000003', 'admin-1', 'market-km', 'Fait', service.AUTO_RESOLVED_TYPES]);
});

test('auto-resolved types are never manually resolvable and note is bounded', () => {
  expect(service.isAutoResolved('parcel_blocked')).toBe(true);
  expect(service.isAutoResolved('margin_drift')).toBe(false);
  expect(service.normalizeResolutionNote('ab')).toBeNull();
  expect(service.normalizeResolutionNote('x'.repeat(501))).toBeNull();
  expect(service.normalizeResolutionNote(null)).toBeNull();
});

test('reactivateExpiredSnoozes is scoped too', async () => {
  mockQuery.mockResolvedValue({ rowCount: 2 });
  await expect(service.reactivateExpiredSnoozes('market-cm')).resolves.toBe(2);
  const [sql, params] = mockQuery.mock.calls[0];
  expect(sql).toContain("status = 'snoozed'");
  expect(sql).toContain('snoozed_until <= NOW()');
  expect(sql).toContain("SET status = 'open'");
  expect(sql).toContain('market_id IS NOT DISTINCT FROM $1::uuid');
  expect(params).toEqual(['market-cm']);
});

test('findActiveByEntity includes market in active fact identity', async () => {
  mockQuery.mockResolvedValue({ rows: [{ id: 'uuid-1', status: 'snoozed' }] });
  await service.findActiveByEntity('parcel_blocked', 'parcel', 'parcel-uuid', 'market-cm');
  const [sql, params] = mockQuery.mock.calls[0];
  expect(sql).toContain("status IN ('open','acknowledged','snoozed')");
  expect(sql).toContain('market_id IS NOT DISTINCT FROM $4::uuid');
  expect(params).toEqual(['parcel_blocked', 'parcel', 'parcel-uuid', 'market-cm']);
});

test('financial_close_economic_facts_pending est classé dans la famille eco', () => {
  expect(require('../../services/signal-admin-service').familyForType('financial_close_economic_facts_pending')).toBe('eco');
});

describe('signaux de commandes de simulation (RCT1) exclus des lectures Action Center', () => {
  beforeEach(() => { mockQuery.mockReset(); mockQuery.mockResolvedValue({ rows: [{ count: '0' }] }); });

  test('listSignals : liste et total appliquent le prédicat réel/RCT1', async () => {
    await service.listSignals({});
    const sqls = mockQuery.mock.calls.map(c => String(c[0]));
    expect(sqls).toHaveLength(2);
    for (const sql of sqls) expect(sql).toMatch(/simulation_scope IS NOT NULL/);
  });

  test('getStats : sévérité, type et famille appliquent le prédicat réel/RCT1', async () => {
    await service.getStats({});
    const sqls = mockQuery.mock.calls.map(c => String(c[0]));
    expect(sqls).toHaveLength(3);
    for (const sql of sqls) expect(sql).toMatch(/simulation_scope IS NOT NULL/);
  });
});

test('« À traiter » liste uniquement les signaux bloquants avec statistiques du même périmètre',async()=>{
  mockQuery.mockResolvedValue({rows:[{count:'0'}]});
  await service.listSignals({business_only:true,market_id:'market-id'});
  expect(mockQuery).toHaveBeenCalledTimes(2);
  for(const [sql,params] of mockQuery.mock.calls){
    expect(sql).toContain('s.signal_type = ANY($7::text[])');
    expect(params[6]).toEqual(service.BUSINESS_BLOCKER_TYPES);
  }
  expect(mockQuery.mock.calls[0][0]).toContain('LIMIT $8 OFFSET $9');
  mockQuery.mockClear();
  await service.getStats({business_only:true,market_id:'market-id'});
  expect(mockQuery).toHaveBeenCalledTimes(3);
  expect(mockQuery.mock.calls[0][0]).toContain('s.signal_type = ANY($2::text[])');
  expect(mockQuery.mock.calls[1][0]).toContain('s.signal_type = ANY($2::text[])');
  expect(mockQuery.mock.calls[2][0]).toContain('s.signal_type = ANY($6::text[])');
  expect(mockQuery.mock.calls[2][1][5]).toEqual(service.BUSINESS_BLOCKER_TYPES);
  expect(service.BUSINESS_BLOCKER_TYPES).not.toContain('margin_drift');
  expect(service.BUSINESS_BLOCKER_TYPES).not.toContain('loyalty_pending');
  expect(service.BUSINESS_BLOCKER_TYPES).toContain('parcel_blocked');
});
