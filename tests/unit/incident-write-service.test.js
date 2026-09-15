'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
const {
  createScanIncident,
  createReconciliationIncident,
  createAlertEngineIncidentIfNew,
  acknowledgeAlertEngineIncident,
  resolveOpsIncident,
  resolvePhysicalProofIncident,
  resolveUpstreamTruthIncident,
  detachUserFromIncidents,
  seedIncident,
} = require('../../services/incident-write-service');

describe('incident-write-service — F2/F3', () => {
  test('scan creation resolves canonical governance and persists due_at', async () => {
    const executor = { query: jest.fn().mockResolvedValue({ rows: [{ id: 'inc-1' }] }) };
    const incident = await createScanIncident(executor, {
      parcel_id: 'p1', order_id: 'o1', incident_type: 'sequence_violation', severity: 'high',
      title: 'Sequence', details: { step: 'shipped' }, detected_source: 'system',
    });
    expect(incident).toEqual({ id: 'inc-1' });
    expect(executor.query.mock.calls[0][0]).toContain('origin_domain, resolver_domain, resolution_class, due_at');
    const values = executor.query.mock.calls[0][1];
    expect(values.slice(-4, -1)).toEqual(['LOGISTICS', 'LOGISTICS', 'PHYSICAL_PROOF']);
    expect(values.at(-1)).toBeInstanceOf(Date);
  });

  test('scan creation unknown type fails closed before SQL', async () => {
    const executor = { query: jest.fn() };
    await expect(createScanIncident(executor, { incident_type: 'future_type', title: 'x' }))
      .rejects.toThrow(/UNKNOWN_INCIDENT_TYPE/);
    expect(executor.query).not.toHaveBeenCalled();
  });

  test('reconciliation Logistics subtype gets Logistics authority + due_at', async () => {
    const executor = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'inc-2' }] }) };
    await expect(createReconciliationIncident(executor, 'o1', 'p1', 'oi1', {
      type: 'over_allocation', severity: 'high', message: 'over', details: {},
    })).resolves.toEqual({ id: 'inc-2' });
    const values = executor.query.mock.calls[1][1];
    expect(values.slice(-4, -1)).toEqual(['LOGISTICS', 'LOGISTICS', 'PHYSICAL_PROOF']);
    expect(values.at(-1)).toBeInstanceOf(Date);
  });

  test('reconciliation Orders subtype gets Orders/UPSTREAM_TRUTH + due_at', async () => {
    const executor = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'inc-3' }] }) };
    await createReconciliationIncident(executor, 'o1', null, null, {
      type: 'order_status_drift', severity: 'medium', message: 'drift', details: {},
    });
    const values = executor.query.mock.calls[1][1];
    expect(values.slice(-4, -1)).toEqual(['ORDERS', 'ORDERS', 'UPSTREAM_TRUTH']);
    expect(values.at(-1)).toBeInstanceOf(Date);
  });

  test('unknown reconciliation subtype fails closed', async () => {
    const executor = { query: jest.fn() };
    await expect(createReconciliationIncident(executor, 'o1', 'p1', null, {
      type: 'future_subtype', severity: 'medium', message: 'x', details: {},
    })).rejects.toThrow(/UNKNOWN_RECONCILIATION_SUBTYPE/);
    expect(executor.query).not.toHaveBeenCalled();
  });

  test('Alert Engine maps stuck_parcel to canonical delay and persists SLA', async () => {
    const executor = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'inc-4' }] }) };
    await expect(createAlertEngineIncidentIfNew(executor, {
      type: 'stuck_parcel', parcelId: 'p1', orderId: 'o1', severity: 'high',
      description: 'stuck', metadata: { days: 10 },
    })).resolves.toEqual({ id: 'inc-4' });
    expect(executor.query.mock.calls[0][1]).toEqual(['p1', 'delay', 'stuck_parcel']);
    const values = executor.query.mock.calls[1][1];
    expect(values.slice(0, 10)).toEqual([
      'p1', 'o1', 'delay', 'high', 'stuck', 'stuck',
      JSON.stringify({ days: 10, alert_type: 'stuck_parcel' }),
      'LOGISTICS', 'LOGISTICS', 'PHYSICAL_PROOF',
    ]);
    expect(values[10]).toBeInstanceOf(Date);
  });

  test('acknowledge keeps guarded open -> investigating update', async () => {
    const executor = { query: jest.fn().mockResolvedValue({ rows: [{ id: 'inc-5', status: 'investigating' }] }) };
    await expect(acknowledgeAlertEngineIncident(executor, 'inc-5', 'admin-1'))
      .resolves.toEqual({ id: 'inc-5', status: 'investigating' });
    expect(executor.query.mock.calls[0][0]).toContain("WHERE id = $1 AND status = 'open'");
  });

  test('generic resolveOpsIncident cannot close PHYSICAL_PROOF anymore', async () => {
    const executor = { query: jest.fn().mockResolvedValueOnce({ rows: [{
      incident_type: 'weight_mismatch', details: {}, resolution_class: 'PHYSICAL_PROOF', resolver_domain: 'LOGISTICS',
    }] }) };
    await expect(resolveOpsIncident(executor, { incidentId: 'inc-6', resolution: '{}' }))
      .rejects.toThrow(/PHYSICAL_PROOF/);
    expect(executor.query).toHaveBeenCalledTimes(1);
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

  test('PHYSICAL_PROOF remains active when fresh proof does not satisfy predicate', async () => {
    const executor = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [{
        id: 'inc-p', status: 'open', parcel_id: 'parcel-1', created_at: '2026-09-15T10:00:00Z',
        trigger_scan_created_at: '2026-09-15T10:00:00Z', origin_domain: 'LOGISTICS',
        resolver_domain: 'LOGISTICS', resolution_class: 'PHYSICAL_PROOF', incident_type: 'weight_mismatch',
      }] })
      .mockResolvedValueOnce({ rows: [{
        id: 'scan-2', parcel_id: 'parcel-1', event_type: 'weigh', status: 'applied',
        created_at: '2026-09-15T11:00:00Z', corrects_event_id: null, photo_urls: [], notes: null,
      }] }) };
    const revalidate = jest.fn().mockResolvedValue(false);

    await expect(resolvePhysicalProofIncident(executor, {
      incidentId: 'inc-p', proofScanEventId: 'scan-2', revalidate,
    })).resolves.toMatchObject({ resolved: false, reason: 'PREDICATE_STILL_FAILS' });

    expect(revalidate).toHaveBeenCalledWith(executor, expect.objectContaining({
      incident: expect.objectContaining({ id: 'inc-p' }),
      proof: expect.objectContaining({ id: 'scan-2' }),
    }));
    expect(executor.query).toHaveBeenCalledTimes(2);
  });

  test('stale physical proof is rejected before predicate revalidation', async () => {
    const executor = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [{
        id: 'inc-p', status: 'open', parcel_id: 'parcel-1', created_at: '2026-09-15T10:00:00Z',
        trigger_scan_created_at: '2026-09-15T10:00:00Z', origin_domain: 'LOGISTICS',
        resolver_domain: 'LOGISTICS', resolution_class: 'PHYSICAL_PROOF', incident_type: 'weight_mismatch',
      }] })
      .mockResolvedValueOnce({ rows: [{
        id: 'scan-old', parcel_id: 'parcel-1', event_type: 'weigh', status: 'applied',
        created_at: '2026-09-15T09:59:00Z', corrects_event_id: null, photo_urls: [], notes: null,
      }] }) };
    const revalidate = jest.fn();

    await expect(resolvePhysicalProofIncident(executor, {
      incidentId: 'inc-p', proofScanEventId: 'scan-old', revalidate,
    })).rejects.toMatchObject({ code: 'STALE_PHYSICAL_PROOF' });
    expect(revalidate).not.toHaveBeenCalled();
  });

  test('fresh physical proof + satisfied predicate resolves incident without mutating scan_events', async () => {
    const executor = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [{
        id: 'inc-p', status: 'investigating', parcel_id: 'parcel-1', created_at: '2026-09-15T10:00:00Z',
        trigger_scan_created_at: null, origin_domain: 'LOGISTICS', resolver_domain: 'LOGISTICS',
        resolution_class: 'PHYSICAL_PROOF', incident_type: 'quantity_mismatch',
      }] })
      .mockResolvedValueOnce({ rows: [{
        id: 'scan-new', parcel_id: 'parcel-1', event_type: 'content_verified', status: 'applied',
        created_at: '2026-09-15T11:00:00Z', corrects_event_id: null, photo_urls: [], notes: 'verified',
      }] })
      .mockResolvedValueOnce({ rows: [{ id: 'inc-p', status: 'resolved' }] }) };

    const result = await resolvePhysicalProofIncident(executor, {
      incidentId: 'inc-p', proofScanEventId: 'scan-new', revalidate: async () => true,
      resolvedBy: null, notes: 'count verified',
    });
    expect(result).toMatchObject({ resolved: true, proof_scan_event_id: 'scan-new' });
    expect(executor.query).toHaveBeenCalledTimes(3);
    const allSql = executor.query.mock.calls.map(([sql]) => String(sql)).join('\n');
    expect(allSql).not.toMatch(/(?:UPDATE|DELETE)\s+scan_events/i);
    expect(executor.query.mock.calls[2][0]).toContain("status = 'resolved'");
  });

  test('physical proof cannot be borrowed from another parcel', async () => {
    const executor = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [{
        id: 'inc-p', status: 'open', parcel_id: 'parcel-1', created_at: '2026-09-15T10:00:00Z',
        trigger_scan_created_at: null, origin_domain: 'LOGISTICS', resolver_domain: 'LOGISTICS',
        resolution_class: 'PHYSICAL_PROOF', incident_type: 'scan_anomaly',
      }] })
      .mockResolvedValueOnce({ rows: [] }) };
    await expect(resolvePhysicalProofIncident(executor, {
      incidentId: 'inc-p', proofScanEventId: 'foreign-scan', revalidate: async () => true,
    })).rejects.toMatchObject({ code: 'PHYSICAL_PROOF_SCOPE_MISMATCH' });
  });

  test('UPSTREAM_TRUTH remains active when authoritative predicate still fails', async () => {
    const executor = { query: jest.fn().mockResolvedValueOnce({ rows: [{
      id: 'inc-up', status: 'open', incident_type: 'payment_issue', origin_domain: 'PAYMENTS',
      resolver_domain: 'PAYMENTS', resolution_class: 'UPSTREAM_TRUTH', details: {},
    }] }) };
    const revalidate = jest.fn().mockResolvedValue(false);
    await expect(resolveUpstreamTruthIncident(executor, {
      incidentId: 'inc-up', revalidate,
    })).resolves.toMatchObject({ resolved: false, reason: 'PREDICATE_STILL_FAILS' });
    expect(revalidate).toHaveBeenCalledWith(executor, expect.objectContaining({
      incident: expect.objectContaining({ id: 'inc-up', resolver_domain: 'PAYMENTS' }),
    }));
    expect(executor.query).toHaveBeenCalledTimes(1);
  });

  test('UPSTREAM_TRUTH resolves only after authoritative truth revalidates', async () => {
    const executor = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [{
        id: 'inc-up', status: 'investigating', incident_type: 'reconciliation_error',
        origin_domain: 'ORDERS', resolver_domain: 'ORDERS', resolution_class: 'UPSTREAM_TRUTH',
        details: { type: 'order_status_drift' },
      }] })
      .mockResolvedValueOnce({ rows: [{ id: 'inc-up', status: 'resolved' }] }) };
    const result = await resolveUpstreamTruthIncident(executor, {
      incidentId: 'inc-up', revalidate: async () => true, notes: 'orders truth corrected',
    });
    expect(result).toMatchObject({ resolved: true, resolver_domain: 'ORDERS' });
    expect(executor.query).toHaveBeenCalledTimes(2);
    expect(executor.query.mock.calls[1][0]).toContain("status = 'resolved'");
  });

  test('UPSTREAM_TRUTH revalidation boundary rejects physical incidents', async () => {
    const executor = { query: jest.fn().mockResolvedValueOnce({ rows: [{
      id: 'inc-p', status: 'open', incident_type: 'weight_mismatch', origin_domain: 'LOGISTICS',
      resolver_domain: 'LOGISTICS', resolution_class: 'PHYSICAL_PROOF', details: {},
    }] }) };
    await expect(resolveUpstreamTruthIncident(executor, {
      incidentId: 'inc-p', revalidate: async () => true,
    })).rejects.toMatchObject({ code: 'INCIDENT_RESOLVER_AUTHORITY_MISMATCH' });
  });

  test('detachUserFromIncidents preserves both detach operations', async () => {
    const executor = { query: jest.fn().mockResolvedValue({ rowCount: 1 }) };
    await detachUserFromIncidents(executor, 'u1');
    expect(executor.query).toHaveBeenCalledTimes(2);
  });

  test('seed contract accepts governed 19-value input and persists canonical due_at', async () => {
    const executor = { query: jest.fn().mockResolvedValue({ rowCount: 1 }) };
    const values = [
      '00000000-0000-0000-0000-000000000001', null, null, 'weight_mismatch', 'medium',
      'open', 'Weight', 'Mismatch', '{}', 'none', false, null,
      'system', null, null, null,
      'LOGISTICS', 'LOGISTICS', 'PHYSICAL_PROOF',
    ];
    await seedIncident(executor, values);
    const [sql, params] = executor.query.mock.calls[0];
    expect(sql).toContain('origin_domain, resolver_domain, resolution_class, due_at');
    expect(params.slice(-4, -1)).toEqual(['LOGISTICS', 'LOGISTICS', 'PHYSICAL_PROOF']);
    expect(params.at(-1)).toBeInstanceOf(Date);
  });

  test('legacy 16-value seed derives governance and persists due_at', async () => {
    const executor = { query: jest.fn().mockResolvedValue({ rowCount: 1 }) };
    const values = [
      '00000000-0000-0000-0000-000000000001', null, null, 'weight_mismatch', 'medium',
      'open', 'Weight', 'Mismatch', '{}', 'none', false, null,
      'system', null, null, null,
    ];
    await seedIncident(executor, values);
    const params = executor.query.mock.calls[0][1];
    expect(params.slice(-4, -1)).toEqual(['LOGISTICS', 'LOGISTICS', 'PHYSICAL_PROOF']);
    expect(params.at(-1)).toBeInstanceOf(Date);
  });

  test('governed seed rejects caller-invented authority', async () => {
    const executor = { query: jest.fn() };
    const values = [
      '00000000-0000-0000-0000-000000000001', null, null, 'weight_mismatch', 'medium',
      'open', 'Weight', 'Mismatch', '{}', 'none', false, null,
      'system', null, null, null,
      'LOGISTICS', 'ORDERS', 'UPSTREAM_TRUTH',
    ];
    await expect(seedIncident(executor, values)).rejects.toThrow(/RESOLVER_DOMAIN_MISMATCH|RESOLUTION_CLASS_MISMATCH/);
    expect(executor.query).not.toHaveBeenCalled();
  });

  test('seed contract rejects unsupported arity', async () => {
    const executor = { query: jest.fn() };
    await expect(seedIncident(executor, ['short']))
      .rejects.toThrow(/16 legacy or 19 governed positional values/);
  });
});
