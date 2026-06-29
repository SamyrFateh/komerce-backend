'use strict';

const { makeClient, expectTransactionCommitted, expectTransactionRolledBack } = require('../integration/test-harness/mock-db');

jest.mock('../../db', () => ({ query: jest.fn(), connect: jest.fn() }));

const pool = require('../../db');
const {
  listIncidents,
  getIncident,
  resolveIncident,
  escalateIncident,
  getIncidentDashboard,
} = require('../../services/incident-service');

describe('incident-service', () => {
  beforeEach(() => jest.clearAllMocks());

  it('listIncidents applique filtres, pagination et total', async () => {
    const incidents = [{ id: 'inc-001', status: 'open', severity: 'high' }];
    pool.query
      .mockResolvedValueOnce({ rows: incidents })
      .mockResolvedValueOnce({ rows: [{ total: '1' }] });

    await expect(listIncidents({ status: ['open', 'investigating'], severity: 'high', client_impact: 'any', limit: 20, offset: 5 }))
      .resolves.toEqual({ incidents, total: 1, limit: 20, offset: 5 });
    expect(pool.query.mock.calls[0][1]).toEqual([['open', 'investigating'], 'high']);
    expect(pool.query.mock.calls[0][0]).toContain('i.client_impact !=');
    expect(pool.query.mock.calls[0][0]).toContain('LIMIT 20 OFFSET 5');
  });

  it('getIncident retourne null si inconnu', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    await expect(getIncident('inc-missing')).resolves.toBeNull();
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('getIncident ajoute incidents lies et scans recents', async () => {
    const incident = { id: 'inc-001', parcel_id: 'parcel-001', order_id: 'order-001' };
    const related = [{ id: 'inc-002' }];
    const recentScans = [{ id: 'scan-001' }];
    pool.query
      .mockResolvedValueOnce({ rows: [incident] })
      .mockResolvedValueOnce({ rows: related })
      .mockResolvedValueOnce({ rows: recentScans });

    await expect(getIncident('inc-001')).resolves.toEqual({ ...incident, related, recentScans });
  });

  it('resolveIncident cloture explicitement et commit', async () => {
    const client = makeClient([
      { rows: [{ id: 'inc-001', status: 'open', parcel_id: null, order_item_id: null }] },
      { rows: [], rowCount: 1 },
    ]);
    pool.connect.mockResolvedValue(client);

    await expect(resolveIncident('inc-001', {
      resolution_type: 'manual_fix', resolved_by: 'admin-001', notes: 'ok', actions_taken: ['checked'], notify_client: true, client_message: 'done',
    })).resolves.toEqual({ success: true, incident_id: 'inc-001', resolution_type: 'manual_fix' });
    const updateCall = client.calls.find(c => String(c.sql).includes('UPDATE incidents SET'));
    expect(updateCall).toBeDefined();
    expect(updateCall.params[1]).toBe('resolved');
    expectTransactionCommitted(client);
  });

  it('resolveIncident rollback si deja resolu', async () => {
    const client = makeClient([{ rows: [{ id: 'inc-001', status: 'resolved' }] }]);
    pool.connect.mockResolvedValue(client);

    await expect(resolveIncident('inc-001', { resolution_type: 'manual_fix' })).rejects.toThrow('Incident déjà résolu');
    expectTransactionRolledBack(client);
  });

  it('escalateIncident passe en investigating avec nouvelle severite', async () => {
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await expect(escalateIncident('inc-001', { new_severity: 'critical', escalated_by: 'admin', reason: 'risk' })).resolves.toEqual({ success: true });
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("status = 'investigating'"), expect.arrayContaining(['inc-001', 'critical']));
  });

  it('getIncidentDashboard assemble compteurs, types, recents et resolution', async () => {
    const byStatus = [{ status: 'open', severity: 'high', count: '2' }];
    const byType = [{ incident_type: 'missing_item', count: '2', client_impacting: '1' }];
    const recent = [{ id: 'inc-001' }];
    pool.query
      .mockResolvedValueOnce({ rows: byStatus })
      .mockResolvedValueOnce({ rows: byType })
      .mockResolvedValueOnce({ rows: recent })
      .mockResolvedValueOnce({ rows: [{ avg_hours: '2.25', resolved_count: '3' }] });

    await expect(getIncidentDashboard()).resolves.toEqual({
      by_status: byStatus,
      by_type: byType,
      recent,
      resolution: { avg_hours: '2.3', resolved_7d: 3 },
    });
  });
});
