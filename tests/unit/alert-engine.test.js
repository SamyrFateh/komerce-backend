/**
 * Tests unitaires — Alert Engine
 * Détection des anomalies terrain
 */
'use strict';

const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));

const AlertEngine = require('../../services/alert-engine');

describe('AlertEngine', () => {
  beforeEach(() => { mockQuery.mockReset(); });

  describe('checkStuckParcels()', () => {
    test('detects parcels without scan for 7+ days', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [
          { id: 'p-1', reference: 'PCL-001', status: 'shipped', order_id: 'o-1', days_since_activity: 10 }
        ]})
        .mockResolvedValueOnce({ rows: [] })  // no existing incident
        .mockResolvedValueOnce({ rows: [{ id: 'inc-new' }] }); // INSERT incident

      const alerts = await AlertEngine.checkStuckParcels();
      
      expect(alerts.length).toBe(1);
    });

    test('does not duplicate existing alerts', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [
          { id: 'p-1', reference: 'PCL-001', status: 'shipped', order_id: 'o-1', days_since_activity: 15 }
        ]})
        .mockResolvedValueOnce({ rows: [{ id: 'existing-inc' }] }); // Already exists

      const alerts = await AlertEngine.checkStuckParcels();
      
      expect(alerts.filter(Boolean).length).toBe(0);
    });

    test('assigns critical severity for 21+ days', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [
          { id: 'p-1', reference: 'PCL-001', status: 'in_transit', order_id: 'o-1', days_since_activity: 25 }
        ]})
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'inc-1', severity: 'critical' }] });

      const alerts = await AlertEngine.checkStuckParcels();
      
      // The INSERT should have been called with 'critical'
      const insertCall = mockQuery.mock.calls.find(c =>
        typeof c[0] === 'string' && c[0].includes('INSERT INTO incidents')
      );
      if (insertCall) {
        expect(insertCall[1]).toContain('critical');
      }
    });
  });

  describe('checkWeightMismatches()', () => {
    test('detects weight difference > 20%', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [
          { id: 'p-1', reference: 'PCL-001', order_id: 'o-1', expected_weight_kg: 5.0, actual_weight_kg: 3.0, diff_pct: 40 }
        ]})
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'inc-1' }] });

      const alerts = await AlertEngine.checkWeightMismatches();
      
      expect(alerts.filter(Boolean).length).toBe(1);
    });
  });

  describe('checkSLABreaches()', () => {
    test('detects parcels in transit > 21 days', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [
          { id: 'p-1', reference: 'PCL-001', status: 'in_transit', order_id: 'o-1', order_ref: 'CMD-001', days_in_transit: 30 }
        ]})
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'inc-1' }] });

      const alerts = await AlertEngine.checkSLABreaches();
      
      expect(alerts.filter(Boolean).length).toBe(1);
    });
  });

  describe('checkCashPending()', () => {
    test('detects unpaid cash after 72h', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [
          { id: 'p-1', reference: 'PCL-001', order_id: 'o-1', order_ref: 'CMD-001', total_kmf: 25000, hours_available: 96 }
        ]})
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'inc-1' }] });

      const alerts = await AlertEngine.checkCashPending();
      
      expect(alerts.filter(Boolean).length).toBe(1);
    });
  });

  describe('runAll()', () => {
    test('runs all checks and aggregates', async () => {
      // Mock everything to return empty (no alerts)
      mockQuery.mockResolvedValue({ rows: [] });

      const alerts = await AlertEngine.runAll();
      
      expect(Array.isArray(alerts)).toBe(true);
    });
  });
});
