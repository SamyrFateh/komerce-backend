'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  createScanIncident,
  createReconciliationIncident,
  createAlertEngineIncidentIfNew,
  acknowledgeAlertEngineIncident,
  resolveOpsIncident,
  detachUserFromIncidents,
  seedIncident,
} = require('../../services/incident-write-service');

describe('incident-write-service', () => {
  test('createScanIncident preserves caller executor and payload mapping', async () => {
    const executor = {
      query: jest.fn().mockResolvedValue({ rows: [{ id: 'inc-1' }] }),
    };

    const incident = await createScanIncident(executor, {
      parcel_id: 'p1',
      order_id: 'o1',
      incident_type: 'sequence_violation',
      severity: 'high',
      title: 'Sequence',
      details: { step: 'shipped' },
      detected_source: 'system',
    });

    expect(incident).toEqual({ id: 'inc-1' });
    expect(executor.query).toHaveBeenCalledTimes(1);
    expect(executor.query.mock.calls[0][0]).toContain('INSERT INTO incidents');
    expect(executor.query.mock.calls[0][1]).toEqual([
      'p1', 'o1', null, null,
      'sequence_violation', 'high', 'Sequence', null,
      JSON.stringify({ step: 'shipped' }),
      'none', null, 'system',
    ]);
  });

  test('createReconciliationIncident preserves dedupe before insert', async () => {
    const executor = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'inc-2' }] }),
    };

    const incident = await createReconciliationIncident(
      executor,
      'o1',
      'p1',
      'oi1',
      { type: 'stale_parcel', severity: 'medium', message: 'stale', details: { days: 8 } }
    );

    expect(incident).toEqual({ id: 'inc-2' });
    expect(executor.query).toHaveBeenCalledTimes(2);
    expect(executor.query.mock.calls[0][0]).toContain("details->>'type' = $3");
    expect(executor.query.mock.calls[1][0]).toContain("'reconciliation_error'");
    expect(executor.query.mock.calls[1][1]).toEqual([
      'p1', 'o1', 'oi1', 'medium', 'stale', 'stale',
      JSON.stringify({ days: 8, type: 'stale_parcel' }),
    ]);
  });

  test('createReconciliationIncident returns existing row without insert', async () => {
    const executor = {
      query: jest.fn().mockResolvedValue({ rows: [{ id: 'existing' }] }),
    };

    const incident = await createReconciliationIncident(
      executor,
      'o1',
      null,
      null,
      { type: 'order_status_drift', severity: 'medium', message: 'drift', details: {} }
    );

    expect(incident).toEqual({ id: 'existing' });
    expect(executor.query).toHaveBeenCalledTimes(1);
  });

  test('createAlertEngineIncidentIfNew preserves legacy alert-engine contract', async () => {
    const executor = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'inc-3' }] }),
    };

    const incident = await createAlertEngineIncidentIfNew(executor, {
      type: 'stuck_parcel',
      parcelId: 'p1',
      orderId: 'o1',
      severity: 'high',
      description: 'stuck',
      metadata: { days: 10 },
    });

    expect(incident).toEqual({ id: 'inc-3' });
    expect(executor.query.mock.calls[1][0]).toContain('metadata, detected_by');
    expect(executor.query.mock.calls[1][0]).toContain("'alert_engine'");
    expect(executor.query.mock.calls[1][1]).toEqual([
      'p1', 'o1', 'stuck_parcel', 'high', 'stuck', JSON.stringify({ days: 10 }),
    ]);
  });

  test('acknowledgeAlertEngineIncident preserves guarded update', async () => {
    const executor = {
      query: jest.fn().mockResolvedValue({ rows: [{ id: 'inc-4', status: 'investigating' }] }),
    };

    const updated = await acknowledgeAlertEngineIncident(executor, 'inc-4', 'admin-1');

    expect(updated).toEqual({ id: 'inc-4', status: 'investigating' });
    expect(executor.query.mock.calls[0][0]).toContain("WHERE id = $1 AND status = 'open'");
    expect(executor.query.mock.calls[0][1]).toEqual(['inc-4', 'admin-1']);
  });

  test('resolveOpsIncident and detachUserFromIncidents preserve exact mutation intent', async () => {
    const executor = { query: jest.fn().mockResolvedValue({ rowCount: 1 }) };

    await resolveOpsIncident(executor, {
      incidentId: 'inc-5',
      resolution: '{"type":"acknowledged"}',
    });
    await detachUserFromIncidents(executor, 'user-1');

    expect(executor.query).toHaveBeenCalledTimes(3);
    expect(executor.query.mock.calls[0][0]).toContain("status = 'resolved'");
    expect(executor.query.mock.calls[0][1]).toEqual(['{"type":"acknowledged"}', 'inc-5']);
    expect(executor.query.mock.calls[1]).toEqual([
      'UPDATE incidents SET detected_by = NULL WHERE detected_by = $1::uuid',
      ['user-1'],
    ]);
    expect(executor.query.mock.calls[2]).toEqual([
      'UPDATE incidents SET resolved_by = NULL WHERE resolved_by = $1::uuid',
      ['user-1'],
    ]);
  });

  test('seedIncident keeps the 16-value seed contract and rejects malformed calls', async () => {
    const executor = { query: jest.fn().mockResolvedValue({ rowCount: 1 }) };
    const values = Array.from({ length: 16 }, (_, i) => `v${i + 1}`);

    await seedIncident(executor, values);
    expect(executor.query).toHaveBeenCalledTimes(1);
    expect(executor.query.mock.calls[0][0]).toContain('INSERT INTO incidents');
    expect(executor.query.mock.calls[0][1]).toBe(values);

    await expect(seedIncident(executor, ['too-short'])).rejects.toThrow(/16 positional values/);
  });

  test('rejects executor without query', async () => {
    await expect(createScanIncident({}, { incident_type: 'x', title: 'x' }))
      .rejects.toThrow(/requires an executor/);
  });
});
