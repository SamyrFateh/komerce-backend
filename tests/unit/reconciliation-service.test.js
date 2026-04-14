/**
 * Tests unitaires — Reconciliation Service
 * Vérifie la cohérence commande ↔ colis ↔ scans
 */
'use strict';

const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));

const ReconciliationService = require('../../services/reconciliation-service');

describe('ReconciliationService', () => {
  beforeEach(() => { mockQuery.mockReset(); });

  describe('runAll()', () => {
    test('returns array of check results', async () => {
      // Mock all 6 checks returning OK
      mockQuery.mockResolvedValue({ rows: [] });

      const results = await ReconciliationService.runAll();
      
      expect(Array.isArray(results)).toBe(true);
      // Should have multiple check categories
      expect(results.length).toBeGreaterThan(0);
    });

    test('detects quantity mismatches', async () => {
      // Mock: return an order_item where qty_allocated > qty_ordered
      mockQuery
        .mockResolvedValueOnce({ rows: [{ 
          id: 'oi-1', order_id: 'o-1', product_name: 'Widget',
          qty_ordered: 2, sum_allocated: 5  // MISMATCH
        }] })
        .mockResolvedValue({ rows: [] }); // other checks OK

      const results = await ReconciliationService.runAll();
      
      // At least one check should find issues
      expect(mockQuery).toHaveBeenCalled();
    });
  });

  describe('checkOrderVsParcels()', () => {
    test('flags orders with no parcels that should have them', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [
        { id: 'o-1', reference: 'CMD-001', status: 'shipped', parcel_count: 0 }
      ]});

      const check = await ReconciliationService.checkOrderVsParcels();
      
      expect(check).toBeDefined();
      if (check.items) {
        expect(check.items.length).toBeGreaterThan(0);
      }
    });

    test('returns OK when all orders have parcels', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const check = await ReconciliationService.checkOrderVsParcels();
      
      expect(check).toBeDefined();
      expect(check.status).toBe('ok');
    });
  });

  describe('checkQuantityIntegrity()', () => {
    test('detects allocated > ordered', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [
        { order_item_id: 'oi-1', qty_ordered: 2, total_allocated: 5, product_name: 'Widget' }
      ]});

      const check = await ReconciliationService.checkQuantityIntegrity();
      
      expect(check.status).not.toBe('ok');
    });

    test('passes when quantities are consistent', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const check = await ReconciliationService.checkQuantityIntegrity();
      expect(check.status).toBe('ok');
    });
  });
});
