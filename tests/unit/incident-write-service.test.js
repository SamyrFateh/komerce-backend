'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
const {
  createScanIncident,
  createReconciliationIncident,
  createAlertEngineIncidentIfNew,
  acknowledgeAlertEngineIncident,
  resolveOpsIncident,
  detachUserFromIncidents,
  seedIncident,
} = require('../../services/incident-write-service');

describe('incident-write-service — F2', () => {
  test('scan creation resolves canonical governance', async () => {
    const executor = { query: jest.fn().mockResolvedValue({ rows: [{ id: 'inc-1' }] }) };
    const incident = await createScanIncident(executor, {
      parcel_id: 'p1', order_id: 'o1', incident_type: 'sequence_violation', severity: 'high',
      title: 'Sequence', details: { step: 'shipped' }, detected_source: 'system',
    });
    expect(incident).toEqual({ id: 'inc-1' });
    expect(executor.query.mock.calls[0][0]).toContain('origin_domain, resolver_domain, resolution_class');
    expect(executor.query.mock.calls[0][1].slice(-3)).toEqual(['LOGISTICS', 'LOGISTICS', 'PHYSICAL_PROOF']);
  });

  test('scan creation unknown type fails closed before SQL', async () => {
    const executor = { query: jest.fn() };
    await expect(createScanIncident(executor, { incident_type: 'future_type', title: 'x' }))
      .rejects.toThrow(/UNKNOWN_INCIDENT_TYPE/);
    expect(executor.query).not.toHaveBeenCalled();
  });

  test('reconciliation Logistics subtype gets Logistics authority', async () => {
    const executor = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'inc-2' }] }) };
    await expect(createReconciliationIncident(executor, 'o1', 'p1', 'oi1', {
      type: 'over_allocation', severity: 'high', message: 'over', details: {},
    })).resolves.toEqual({ id: 'inc-2' });
    expect(executor.query.mock.calls[1][1].slice(-3)).toEqual(['LOGISTICS', 'LOGISTICS', 'PHYSICAL_PROOF']);
  });

  test('reconciliation Orders subtype gets Orders/UPSTREAM_TRUTH', async () => {
    const executor = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'inc-3' }] }) };
    await createReconciliationIncident(executor, 'o1', null, null, {
      type: 'order_status_drift', severity: 'medium', message: 'drift', details: {},
    });
    expect(executor.query.mock.calls[1][1].slice(-3)).toEqual(['ORDERS', 'ORDERS', 'UPSTREAM_TRUTH']);
  });

  test('unknown reconciliation subtype fails closed', async () => {
    const executor = { query: jest.fn() };
    await expect(createReconciliationIncident(executor, 'o1', 'p1', null, {
      type: 'future_subtype', severity: 'medium', message: 'x', details: {},
    })).rejects.toThrow(/UNKNOWN_RECONCILIATION_SUBTYPE/);
    expect(executor.query).not.toHaveBeenCalled();
  });

  test('Alert Engine maps stuck_parcel to canonical delay and persists alert label in details', async () => {
    const executor = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'inc-4' }] }) };
    await expect(createAlertEngineIncidentIfNew(executor, {
      type: 'stuck_parcel', parcelId: 'p1', orderId: 'o1', severity: 'high',
      description: 'stuck', metadata: { days: 10 },
    })).resolves.toEqual({ id: 'inc-4' });
    expect(executor.query.mock.calls[0][1]).toEqual(['p1', 'delay', 'stuck_parcel']);
    expect(executor.query.mock.calls[1][1]).toEqual([
      'p1', 'o1', 'delay', 'high', 'stuck', 'stuck',
      JSON.stringify({ days: 10, alert_type: 'stuck_parcel' }),
      'LOGISTICS', 'LOGISTICS', 'PHYSICAL_PROOF',
    ]);
  });

  test('acknowledge keeps guarded open -> investigating update', async () => {
    const executor = { query: jest.fn().mockResolvedValue({ rows: [{ id: 'inc-5', status: 'investigating' }] }) };
    await expect(acknowledgeAlertEngineIncident(executor, 'inc-5', 'admin-1'))
      .resolves.toEqual({ id: 'inc-5', status: 'investigating' });
    expect(executor.query.mock.calls[0][0]).toContain("WHERE id = $1 AND status = 'open'");
  });

  test('resolveOpsIncident allows PHYSICAL_PROOF then updates', async () => {
    const executor = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [{ incident_type: 'weight_mismatch', details: {}, resolution_class: 'PHYSICAL_PROOF', resolver_domain: 'LOGISTICS' }] })
      .mockResolvedValueOnce({ rowCount: 1 }) };
    await resolveOpsIncident(executor, { incidentId: 'inc-6', resolution: '{"type":"ack"}' });
    expect(executor.query).toHaveBeenCalledTimes(2);
    expect(executor.query.mock.calls[0][0]).toContain('resolution_class, resolver_domain');
    expect(executor.query.mock.calls[1][0]).toContain("status = 'resolved'");
  });

  test('resolveOpsIncident cannot close UPSTREAM_TRUTH', async () => {
    const executor = { query: jest.fn().mockResolvedValueOnce({ rows: [{
      incident_type: 'payment_issue', details: {}, resolution_class: 'UPSTREAM_TRUTH', resolver_domain: 'PAYMENTS',
    }] }) };
    await expect(resolveOpsIncident(executor, { incidentId: 'inc-7', resolution: '{}' }))
      .rejects.toThrow(/UPSTREAM_TRUTH/);
    expect(executor.query).toHaveBeenCalledTimes(1);
  });

  test('resolveOpsIncident cannot close historical UNCLASSIFIED', async () => {
    const executor = { query: jest.fn().mockResolvedValueOnce({ rows: [{
      incident_type: 'reconciliation_error', details: { type: 'legacy' },
      resolution_class: 'UNCLASSIFIED', resolver_domain: 'UNCLASSIFIED',
    }] }) };
    await expect(resolveOpsIncident(executor, { incidentId: 'inc-8', resolution: '{}' }))
      .rejects.toThrow(/UNCLASSIFIED/);
    expect(executor.query).toHaveBeenCalledTimes(1);
  });

  test('detachUserFromIncidents preserves both detach operations', async () => {
    const executor = { query: jest.fn().mockResolvedValue({ rowCount: 1 }) };
    await detachUserFromIncidents(executor, 'u1');
    expect(executor.query).toHaveBeenCalledTimes(2);
  });

  test('seed contract accepts governed 19-value input', async () => {
    const executor = { query: jest.fn().mockResolvedValue({ rowCount: 1 }) };
    const values = Array.from({ length: 19 }, (_, i) => `v${i + 1}`);
    await seedIncident(executor, values);
    expect(executor.query.mock.calls[0][0]).toContain('origin_domain, resolver_domain, resolution_class');
  });

  test('legacy 16-value seed derives governance rather than writing null authority', async () => {
    const executor = { query: jest.fn().mockResolvedValue({ rowCount: 1 }) };
    const values = [
      '00000000-0000-0000-0000-000000000001', null, null, 'weight_mismatch', 'medium',
      'open', 'Weight', 'Mismatch', '{}', 'none', false, null,
      'system', null, null, null,
    ];
    await seedIncident(executor, values);
    expect(executor.query.mock.calls[0][1].slice(-3)).toEqual(['LOGISTICS', 'LOGISTICS', 'PHYSICAL_PROOF']);
  });

  test('seed contract rejects unsupported arity', async () => {
    const executor = { query: jest.fn() };
    await expect(seedIncident(executor, ['short']))
      .rejects.toThrow(/16 legacy or 19 governed positional values/);
  });
});