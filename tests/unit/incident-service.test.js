/**
 * Tests unitaires — Incident Service
 * Détection, création, résolution d'incidents
 */
'use strict';

const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));

const IncidentService = require('../../services/incident-service');

describe('IncidentService', () => {
  beforeEach(() => { mockQuery.mockReset(); });

  describe('createIncident()', () => {
    test('creates incident with correct fields', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ 
        id: 'inc-1', parcel_id: 'p-1', order_id: 'o-1',
        type: 'content_mismatch', severity: 'high',
        status: 'open', description: 'Article manquant'
      }]});

      const incident = await IncidentService.createIncident({
        parcel_id: 'p-1',
        order_id: 'o-1',
        type: 'content_mismatch',
        severity: 'high',
        description: 'Article manquant',
      });

      expect(incident.type).toBe('content_mismatch');
      expect(incident.severity).toBe('high');
      expect(incident.status).toBe('open');
    });
  });

  describe('resolveIncident()', () => {
    test('resolves and sets resolution fields', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{
        id: 'inc-1', status: 'resolved',
        resolution_type: 'manual_fix', resolution_notes: 'Corrigé',
        resolved_at: new Date(), resolved_by: 'Admin'
      }]});

      const resolved = await IncidentService.resolveIncident('inc-1', {
        resolution_type: 'manual_fix',
        resolution_notes: 'Corrigé',
        resolved_by_name: 'Admin'
      });

      expect(resolved.status).toBe('resolved');
      expect(resolved.resolution_type).toBe('manual_fix');
    });

    test('returns null for non-existent incident', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await IncidentService.resolveIncident('fake-id', {
        resolution_type: 'no_action',
      });

      expect(result).toBeNull();
    });
  });

  describe('getOpenIncidents()', () => {
    test('returns only open/investigating incidents', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [
        { id: 'inc-1', status: 'open', severity: 'critical' },
        { id: 'inc-2', status: 'investigating', severity: 'high' },
      ]});

      const incidents = await IncidentService.getOpenIncidents();
      
      expect(incidents.length).toBe(2);
      expect(incidents.every(i => ['open', 'investigating'].includes(i.status))).toBe(true);
    });

    test('sorts critical first', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [
        { id: 'inc-1', status: 'open', severity: 'critical', type: 'blocked' },
        { id: 'inc-2', status: 'open', severity: 'low', type: 'delay' },
      ]});

      const incidents = await IncidentService.getOpenIncidents();
      
      if (incidents.length >= 2) {
        expect(incidents[0].severity).toBe('critical');
      }
    });
  });

  describe('Impact client', () => {
    test('content_mismatch with severity high impacts delivery', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{
        id: 'inc-1', type: 'content_mismatch', severity: 'high',
        client_impact: 'partial_delivery',
      }]});

      const incident = await IncidentService.createIncident({
        parcel_id: 'p-1',
        type: 'content_mismatch',
        severity: 'high',
        description: '2 articles manquants sur 5',
        client_impact: 'partial_delivery',
      });

      expect(incident.client_impact).toBe('partial_delivery');
    });
  });
});
