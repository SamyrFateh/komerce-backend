'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
jest.mock('../../db', () => ({
  query: jest.fn(),
}));

const db = require('../../db');
const {
  findOrderedWithoutPurchaseOrders,
  repairOrderedWithoutPurchaseOrders,
} = require('../../services/repair-ordered-purchasing');

describe('repair-ordered-purchasing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('findOrderedWithoutPurchaseOrders', () => {
    it('interroge la base avec la limite fournie et retourne les lignes', async () => {
      const rows = [{ id: 'o1', reference: 'K1', item_count: '2' }];
      db.query.mockResolvedValue({ rows });

      const result = await findOrderedWithoutPurchaseOrders({ limit: 10 });

      expect(result).toBe(rows);
      expect(db.query).toHaveBeenCalledTimes(1);
      const [, params] = db.query.mock.calls[0];
      expect(params).toEqual([10]);
    });

    it('clamp la limite entre 1 et 200', async () => {
      db.query.mockResolvedValue({ rows: [] });

      await findOrderedWithoutPurchaseOrders({ limit: 9999 });
      expect(db.query.mock.calls[0][1]).toEqual([200]);

      await findOrderedWithoutPurchaseOrders({ limit: -5 });
      expect(db.query.mock.calls[1][1]).toEqual([1]);

      await findOrderedWithoutPurchaseOrders({ limit: 'nope' });
      expect(db.query.mock.calls[2][1]).toEqual([50]);
    });
  });

  describe('repairOrderedWithoutPurchaseOrders', () => {
    it('mode dry-run : ne touche pas a triggerPurchasing et liste les candidats', async () => {
      db.query.mockResolvedValue({
        rows: [{ id: 'o1', reference: 'K1', item_count: '3' }],
      });
      const triggerPurchasing = jest.fn();

      const result = await repairOrderedWithoutPurchaseOrders({ dryRun: true, triggerPurchasing });

      expect(triggerPurchasing).not.toHaveBeenCalled();
      expect(result.dry_run).toBe(true);
      expect(result.candidate_count).toBe(1);
      expect(result.results[0]).toMatchObject({
        order_id: 'o1',
        action: 'would_trigger_purchasing',
        item_count: 3,
      });
    });

    it('exige triggerPurchasing quand dryRun=false', async () => {
      await expect(
        repairOrderedWithoutPurchaseOrders({ dryRun: false })
      ).rejects.toThrow('[repairOrderedWithoutPurchaseOrders] triggerPurchasing requis en mode repair');
    });

    it('mode reparation : appelle triggerPurchasing pour chaque candidat et capture le resultat', async () => {
      db.query.mockResolvedValue({
        rows: [{ id: 'o1', reference: 'K1', item_count: '1' }],
      });
      const triggerPurchasing = jest.fn().mockResolvedValue({ pos_created: 2 });

      const result = await repairOrderedWithoutPurchaseOrders({ dryRun: false, triggerPurchasing });

      expect(triggerPurchasing).toHaveBeenCalledWith('o1');
      expect(result.results[0]).toMatchObject({
        order_id: 'o1',
        action: 'triggered_purchasing',
        result: { pos_created: 2 },
      });
    });

    it('capture les erreurs de triggerPurchasing sans interrompre les autres candidats', async () => {
      db.query.mockResolvedValue({
        rows: [
          { id: 'o1', reference: 'K1', item_count: '1' },
          { id: 'o2', reference: 'K2', item_count: '1' },
        ],
      });
      const triggerPurchasing = jest.fn()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce({ pos_created: 1 });

      const result = await repairOrderedWithoutPurchaseOrders({ dryRun: false, triggerPurchasing });

      expect(result.results[0]).toMatchObject({ order_id: 'o1', action: 'error', error: 'boom' });
      expect(result.results[1]).toMatchObject({ order_id: 'o2', action: 'triggered_purchasing' });
    });
  });
});
