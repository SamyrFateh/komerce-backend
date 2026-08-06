'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
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

  it('listIncidents applique le filtre status en valeur simple (non tableau)', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: '0' }] });

    await listIncidents({ status: 'open' });

    expect(pool.query.mock.calls[0][0]).toContain('i.status = $1');
    expect(pool.query.mock.calls[0][1]).toEqual(['open']);
  });

  it('listIncidents applique le filtre incident_type', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: '0' }] });

    await listIncidents({ incident_type: 'missing_item' });

    expect(pool.query.mock.calls[0][0]).toContain('i.incident_type = $1');
    expect(pool.query.mock.calls[0][1]).toEqual(['missing_item']);
  });

  it('listIncidents applique le filtre parcel_id', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: '0' }] });

    await listIncidents({ parcel_id: 'parcel-001' });

    expect(pool.query.mock.calls[0][0]).toContain('i.parcel_id = $1');
    expect(pool.query.mock.calls[0][1]).toEqual(['parcel-001']);
  });

  it('listIncidents applique le filtre order_id', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: '0' }] });

    await listIncidents({ order_id: 'order-001' });

    expect(pool.query.mock.calls[0][0]).toContain('i.order_id = $1');
    expect(pool.query.mock.calls[0][1]).toEqual(['order-001']);
  });

  it('listIncidents applique le filtre client_impact avec une valeur precise (pas "any"/"all")', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: '0' }] });

    await listIncidents({ client_impact: 'blocked' });

    expect(pool.query.mock.calls[0][0]).toContain('i.client_impact = $1');
    expect(pool.query.mock.calls[0][1]).toEqual(['blocked']);
  });

  it('listIncidents sans aucun filtre : pas de WHERE, valeurs par defaut limit/offset', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: '0' }] });

    await listIncidents({});

    expect(pool.query.mock.calls[0][0]).not.toContain('WHERE');
    expect(pool.query.mock.calls[0][0]).toContain('LIMIT 50 OFFSET 0');
    expect(pool.query.mock.calls[0][1]).toEqual([]);
  });

  it('listIncidents sans argument (filtres par defaut = {})', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: '0' }] });

    await expect(listIncidents()).resolves.toEqual({ incidents: [], total: 0, limit: 50, offset: 0 });
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

  it('getIncident sans parcel_id → recentScans reste vide, pas de requete scan_events supplementaire', async () => {
    const incident = { id: 'inc-001', parcel_id: null, order_id: 'order-001' };
    const related = [];
    pool.query
      .mockResolvedValueOnce({ rows: [incident] })
      .mockResolvedValueOnce({ rows: related });

    const result = await getIncident('inc-001');

    expect(result.recentScans).toEqual([]);
    expect(pool.query).toHaveBeenCalledTimes(2);
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

  it('resolveIncident : resolution_type=reship avec parcel_id et order_item_id → cree un incident de reexpedition', async () => {
    const client = makeClient([
      { rows: [{ id: 'inc-001', status: 'open', parcel_id: 'parcel-001', order_id: 'order-001', order_item_id: 'item-001', details: { note: 'x' } }] },
      { rows: [], rowCount: 1 }, // UPDATE incidents
      { rows: [{ id: 'inc-002' }], rowCount: 1 }, // INSERT nouvel incident reship
    ]);
    pool.connect.mockResolvedValue(client);

    await expect(resolveIncident('inc-001', { resolution_type: 'reship', resolved_by: 'admin-001' }))
      .resolves.toEqual({ success: true, incident_id: 'inc-001', resolution_type: 'reship' });

    const insertCall = client.calls.find(c => String(c.sql).includes('INSERT INTO incidents'));
    expect(insertCall).toBeDefined();
    expect(insertCall.params).toEqual(expect.arrayContaining(['parcel-001', 'order-001', 'item-001']));
    expectTransactionCommitted(client);
  });

  it('resolveIncident : reship sans parcel_id/order_item_id → pas de creation d\'incident secondaire', async () => {
    const client = makeClient([
      { rows: [{ id: 'inc-001', status: 'open', parcel_id: null, order_item_id: null }] },
      { rows: [], rowCount: 1 },
    ]);
    pool.connect.mockResolvedValue(client);

    await resolveIncident('inc-001', { resolution_type: 'reship' });

    const insertCall = client.calls.find(c => String(c.sql).includes('INSERT INTO incidents'));
    expect(insertCall).toBeUndefined();
  });

  it('resolveIncident : incident introuvable → rollback et throw', async () => {
    const client = makeClient([{ rows: [] }]);
    pool.connect.mockResolvedValue(client);

    await expect(resolveIncident('inc-missing', { resolution_type: 'manual_fix' })).rejects.toThrow('Incident introuvable');
    expectTransactionRolledBack(client);
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

  it('resolveIncident : sans resolved_by → NULL passe en parametre (fallback ||)', async () => {
    const client = makeClient([
      { rows: [{ id: 'inc-001', status: 'open', parcel_id: null, order_item_id: null }] },
      { rows: [], rowCount: 1 },
    ]);
    pool.connect.mockResolvedValue(client);

    await resolveIncident('inc-001', { resolution_type: 'dismissed' });

    const updateCall = client.calls.find(c => String(c.sql).includes('UPDATE incidents SET'));
    expect(updateCall.params[4]).toBeNull();
    expect(updateCall.params[1]).toBe('dismissed');
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

  it('getIncidentDashboard : pas de resolution moyenne (avgRes vide) → avg_hours null, resolved_7d 0', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ avg_hours: null, resolved_count: '0' }] });

    const result = await getIncidentDashboard();

    expect(result.resolution).toEqual({ avg_hours: null, resolved_7d: 0 });
  });

  it('getIncidentDashboard : resolved_count absent (undefined) → fallback a 0', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ avg_hours: null, resolved_count: undefined }] });

    const result = await getIncidentDashboard();

    expect(result.resolution.resolved_7d).toBe(0);
  });
});
