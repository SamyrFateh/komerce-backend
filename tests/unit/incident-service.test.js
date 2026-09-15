'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
const { makeClient, expectTransactionRolledBack } = require('../integration/test-harness/mock-db');

jest.mock('../../db', () => ({ query: jest.fn(), connect: jest.fn() }));
const pool = require('../../db');
const { listIncidents, getIncident, resolveIncident, escalateIncident, getIncidentDashboard } = require('../../services/incident-service');

describe('incident-service', () => {
  beforeEach(() => jest.clearAllMocks());

  test('listIncidents applies filters and pagination', async () => {
    const incidents = [{ id: 'inc-001', status: 'open', severity: 'high' }];
    pool.query.mockResolvedValueOnce({ rows: incidents }).mockResolvedValueOnce({ rows: [{ total: '1' }] });
    await expect(listIncidents({ status: ['open', 'investigating'], severity: 'high', client_impact: 'any', limit: 20, offset: 5 }))
      .resolves.toEqual({ incidents, total: 1, limit: 20, offset: 5 });
    expect(pool.query.mock.calls[0][1]).toEqual([['open', 'investigating'], 'high']);
  });

  test('listIncidents supports simple domain filters', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: '0' }] });
    await listIncidents({ incident_type: 'missing_item', parcel_id: 'p1', order_id: 'o1', client_impact: 'blocked' });
    expect(pool.query.mock.calls[0][0]).toContain('i.incident_type = $1');
    expect(pool.query.mock.calls[0][0]).toContain('i.parcel_id = $2');
    expect(pool.query.mock.calls[0][0]).toContain('i.order_id = $3');
    expect(pool.query.mock.calls[0][0]).toContain('i.client_impact = $4');
  });

  test('getIncident returns null if missing', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    await expect(getIncident('missing')).resolves.toBeNull();
  });

  test('getIncident includes related incidents and scans', async () => {
    const incident = { id: 'inc-001', parcel_id: 'p1', order_id: 'o1' };
    pool.query
      .mockResolvedValueOnce({ rows: [incident] })
      .mockResolvedValueOnce({ rows: [{ id: 'inc-2' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'scan-1' }] });
    await expect(getIncident('inc-001')).resolves.toEqual({
      ...incident, related: [{ id: 'inc-2' }], recentScans: [{ id: 'scan-1' }],
    });
  });

  test('PHYSICAL_PROOF cannot close through generic manual_fix', async () => {
    const client = makeClient([{
      rows: [{ id: 'inc-001', status: 'open', incident_type: 'weight_mismatch', resolution_class: 'PHYSICAL_PROOF', resolver_domain: 'LOGISTICS', parcel_id: null, order_item_id: null }],
    }]);
    pool.connect.mockResolvedValue(client);
    await expect(resolveIncident('inc-001', { resolution_type: 'manual_fix', resolved_by: 'admin-1' }))
      .rejects.toThrow(/PHYSICAL_PROOF/);
    expectTransactionRolledBack(client);
    expect(client.calls.some(c => String(c.sql).includes('UPDATE incidents SET'))).toBe(false);
  });

  test.each(['manual_fix', 'auto_resolved', 'reship', 'refund', 'dismissed'])(
    'UPSTREAM_TRUTH cannot close through %s', async (resolution_type) => {
      const client = makeClient([{
        rows: [{ id: 'inc-up', status: 'open', incident_type: 'payment_issue', resolution_class: 'UPSTREAM_TRUTH', resolver_domain: 'PAYMENTS' }],
      }]);
      pool.connect.mockResolvedValue(client);
      await expect(resolveIncident('inc-up', { resolution_type })).rejects.toThrow(/UPSTREAM_TRUTH/);
      expectTransactionRolledBack(client);
      expect(client.calls.some(c => String(c.sql).includes('UPDATE incidents SET'))).toBe(false);
    }
  );

  test('historical UNCLASSIFIED cannot close generically', async () => {
    const client = makeClient([{
      rows: [{ id: 'inc-legacy', status: 'open', incident_type: 'reconciliation_error', details: { type: 'legacy' }, resolution_class: 'UNCLASSIFIED', resolver_domain: 'UNCLASSIFIED' }],
    }]);
    pool.connect.mockResolvedValue(client);
    await expect(resolveIncident('inc-legacy', { resolution_type: 'auto_resolved' })).rejects.toThrow(/UNCLASSIFIED/);
    expectTransactionRolledBack(client);
  });

  test('PHYSICAL_PROOF cannot create reship follow-up through generic terminal path', async () => {
    const client = makeClient([{
      rows: [{ id: 'inc-001', status: 'open', incident_type: 'missing_item', resolution_class: 'PHYSICAL_PROOF', resolver_domain: 'LOGISTICS', parcel_id: 'p1', order_id: 'o1', order_item_id: 'oi1', details: { note: 'x' } }],
    }]);
    pool.connect.mockResolvedValue(client);
    await expect(resolveIncident('inc-001', { resolution_type: 'reship', resolved_by: 'admin-1' }))
      .rejects.toThrow(/PHYSICAL_PROOF/);
    expectTransactionRolledBack(client);
    expect(client.calls.some(c => String(c.sql).includes('INSERT INTO incidents'))).toBe(false);
  });

  test('missing incident rolls back', async () => {
    const client = makeClient([{ rows: [] }]);
    pool.connect.mockResolvedValue(client);
    await expect(resolveIncident('missing', { resolution_type: 'manual_fix' })).rejects.toThrow('Incident introuvable');
    expectTransactionRolledBack(client);
  });

  test('already resolved incident rolls back', async () => {
    const client = makeClient([{ rows: [{ id: 'inc-001', status: 'resolved' }] }]);
    pool.connect.mockResolvedValue(client);
    await expect(resolveIncident('inc-001', { resolution_type: 'manual_fix' })).rejects.toThrow('Incident déjà résolu');
    expectTransactionRolledBack(client);
  });

  test('escalate marks investigating', async () => {
    pool.query.mockResolvedValueOnce({ rowCount: 1 });
    await expect(escalateIncident('inc-001', { new_severity: 'critical', escalated_by: 'admin', reason: 'risk' }))
      .resolves.toEqual({ success: true });
    expect(pool.query.mock.calls[0][0]).toContain("status = 'investigating'");
  });

  test('dashboard assembles status/type/recent/resolution', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ status: 'open', severity: 'high', count: '2' }] })
      .mockResolvedValueOnce({ rows: [{ incident_type: 'missing_item', count: '2', client_impacting: '1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'inc-001' }] })
      .mockResolvedValueOnce({ rows: [{ avg_hours: '2.25', resolved_count: '3' }] });
    const result = await getIncidentDashboard();
    expect(result.resolution).toEqual({ avg_hours: '2.3', resolved_7d: 3 });
  });
});
