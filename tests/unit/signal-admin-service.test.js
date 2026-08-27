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
  expect(service.familyForType('stock_rupture')).toBe('sourcing');
  expect(service.familyForType('dispute_sensitive')).toBe('disputes');
  expect(service.familyForType('future_signal')).toBe('other');
});

test('listSignals keeps Legacy default semantics and parameterizes family/pagination', async () => {
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
  expect(sql).toContain('LIMIT $6 OFFSET $7');
  expect(params).toEqual([null, null, null, null, service.FAMILY_TYPES.ops, 200, 4]);

  const [countSql, countParams] = mockQuery.mock.calls[1];
  expect(countSql).toContain('s.signal_type = ANY($5::text[])');
  expect(countParams).toEqual([null, null, null, null, service.FAMILY_TYPES.ops]);
});

test('listSignals passes arbitrary filter values only as SQL parameters', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ count: '0' }] });

  const attack = "warning' OR 1=1 --";
  await service.listSignals({ status: 'open', severity: attack, signal_type: 'parcel_blocked', owner_role: 'admin' });

  const [sql, params] = mockQuery.mock.calls[0];
  expect(sql).not.toContain(attack);
  expect(params).toEqual(['open', attack, 'parcel_blocked', 'admin', null, 50, 0]);
});

test('acknowledgeByRef mutates by signal_ref, never browser UUID', async () => {
  mockQuery.mockResolvedValue({ rows: [{ id: 'uuid-1', signal_ref: 'KSG-000001', status: 'acknowledged' }] });

  const result = await service.acknowledgeByRef('KSG-000001');

  const [sql, params] = mockQuery.mock.calls[0];
  expect(sql).toContain('WHERE signal_ref = $1');
  expect(sql).toContain("status = 'open'");
  expect(params).toEqual(['KSG-000001']);
  expect(result.signal_ref).toBe('KSG-000001');
});

test('snooze defaults to 24h and only accepts active visible states', async () => {
  mockQuery.mockResolvedValue({ rows: [{ signal_ref: 'KSG-000002', status: 'snoozed' }] });

  await service.snoozeByRef('KSG-000002', 'invalid');

  const [sql, params] = mockQuery.mock.calls[0];
  expect(sql).toContain("status IN ('open','acknowledged')");
  expect(params).toEqual(['KSG-000002', '24']);
});

test('resolve clears snooze and resolves every active signal state', async () => {
  mockQuery.mockResolvedValue({ rows: [{ signal_ref: 'KSG-000003', status: 'resolved' }] });

  await service.resolveByRef('KSG-000003', 'admin-1');

  const [sql, params] = mockQuery.mock.calls[0];
  expect(sql).toContain("status IN ('open','acknowledged','snoozed')");
  expect(sql).toContain('snoozed_until = NULL');
  expect(params).toEqual(['KSG-000003', 'admin-1']);
});

test('reactivateExpiredSnoozes wakes only expired snoozes', async () => {
  mockQuery.mockResolvedValue({ rowCount: 2 });
  await expect(service.reactivateExpiredSnoozes()).resolves.toBe(2);
  const [sql] = mockQuery.mock.calls[0];
  expect(sql).toContain("status = 'snoozed'");
  expect(sql).toContain('snoozed_until <= NOW()');
  expect(sql).toContain("SET status = 'open'");
});

test('findActiveByEntity treats open, acknowledged and snoozed as one active lifecycle', async () => {
  mockQuery.mockResolvedValue({ rows: [{ id: 'uuid-1', status: 'snoozed' }] });
  await service.findActiveByEntity('parcel_blocked', 'parcel', 'parcel-uuid');
  const [sql, params] = mockQuery.mock.calls[0];
  expect(sql).toContain("status IN ('open','acknowledged','snoozed')");
  expect(params).toEqual(['parcel_blocked', 'parcel', 'parcel-uuid']);
});
