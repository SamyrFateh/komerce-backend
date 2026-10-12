'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @brief S4 — scan -> physical proof -> predicate -> incident resolution wiring.
 */

jest.mock('../../db', () => ({ connect: jest.fn(), query: jest.fn() }));
jest.mock('../../utils/logger', () => ({ child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }) }));
jest.mock('../../services/notification-service', () => ({ notifyParcelScan: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../services/order-status-machine', () => ({ transitionOrderStatus: jest.fn().mockResolvedValue({ success: true }) }));
jest.mock('../../services/incident-write-service', () => ({
  createScanIncident: jest.fn(),
  resolvePhysicalProofIncident: jest.fn(),
}));

const { resolvePhysicalProofIncident } = require('../../services/incident-write-service');
const { _resolvePhysicalProofIncidents } = require('../../services/scan-engine');

const PARCEL_ID = 'parcel-proof-1';

function clientWith({ incidents = [], parcel = {} } = {}) {
  return {
    query: jest.fn(async (sql) => {
      const text = String(sql);
      if (text.includes('FROM incidents')) return { rows: incidents };
      if (text.includes('expected_weight_kg')) return { rows: [{ expected_weight_kg: 10, actual_weight_kg: 10.5, ...parcel }] };
      if (text.includes('verification_status')) return { rows: [{ verification_status: 'verified', ...parcel }] };
      return { rows: [] };
    }),
  };
}

beforeEach(() => jest.clearAllMocks());

describe('S4 physical proof wiring', () => {
  test('unrelated scan never attempts terminal incident resolution', async () => {
    const client = clientWith({ incidents: [{ id: 'inc-1', incident_type: 'weight_mismatch' }] });
    await _resolvePhysicalProofIncidents(client, { parcel_id: PARCEL_ID, event_type: 'shipped' }, { event_id: 'scan-1' });
    expect(client.query).not.toHaveBeenCalled();
    expect(resolvePhysicalProofIncident).not.toHaveBeenCalled();
  });

  test('corrective weight scan delegates fresh proof and canonical predicate', async () => {
    const client = clientWith({ incidents: [{ id: 'inc-weight', incident_type: 'weight_mismatch', details: {} }] });
    resolvePhysicalProofIncident.mockImplementation(async (_db, args) => ({
      resolved: await args.revalidate(client, { incident: { incident_type: 'weight_mismatch' } }),
    }));
    const result = { event_id: 'scan-weight-fresh' };
    await _resolvePhysicalProofIncidents(client, { parcel_id: PARCEL_ID, event_type: 'weight_check', scanned_by: 'agent-1' }, result);
    expect(resolvePhysicalProofIncident).toHaveBeenCalledWith(client, expect.objectContaining({
      incidentId: 'inc-weight', proofScanEventId: 'scan-weight-fresh', resolvedBy: 'agent-1',
    }));
    expect(result.resolved_incidents).toEqual(['inc-weight']);
  });

  test('weight predicate that still fails does not report resolution', async () => {
    const client = clientWith({ incidents: [{ id: 'inc-weight', incident_type: 'weight_mismatch', details: {} }], parcel: { actual_weight_kg: 13 } });
    resolvePhysicalProofIncident.mockImplementation(async (_db, args) => ({
      resolved: await args.revalidate(client, { incident: { incident_type: 'weight_mismatch' } }),
    }));
    const result = { event_id: 'scan-weight-bad' };
    await _resolvePhysicalProofIncidents(client, { parcel_id: PARCEL_ID, event_type: 'weight_check' }, result);
    expect(result.resolved_incidents).toBeUndefined();
  });

  test('content verification closes only when durable parcel truth is verified', async () => {
    const client = clientWith({ incidents: [{ id: 'inc-content', incident_type: 'content_mismatch', details: {} }] });
    resolvePhysicalProofIncident.mockImplementation(async (_db, args) => ({
      resolved: await args.revalidate(client, { incident: { incident_type: 'content_mismatch' } }),
    }));
    const result = { event_id: 'scan-content-fresh' };
    await _resolvePhysicalProofIncidents(client, { parcel_id: PARCEL_ID, event_type: 'content_verified' }, result);
    expect(result.resolved_incidents).toEqual(['inc-content']);
  });
});
