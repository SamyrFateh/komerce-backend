'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
jest.mock('../../db', () => ({ query: jest.fn() }));

jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const db = require('../../db');
const {
  distributeOrder,
  distributeAll,
  getDistribution,
  cleanupGhostParcels,
  MAX_ITEMS_PER_PARCEL,
  MAX_OPEN_PARCELS_PER_DEST,
} = require('../../services/auto-parcel');

function makeOrder(overrides = {}) {
  return {
    id: 'order-001',
    reference: 'CMD-001',
    status: 'ordered',
    relais_id: 'relais-001',
    total_kmf: '12000',
    customer_name: 'Client Test',
    customer_phone: '000000',
    relais_name: 'Relais Mutsamudu',
    relais_island: 'Anjouan',
    ...overrides,
  };
}

function makeItem(overrides = {}) {
  return { id: 'oi-001', quantity: 2, product_id: 'product-001', ...overrides };
}

describe('auto-parcel', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('distributeOrder', () => {
    it('cree un nouveau colis si aucun colis ouvert ne peut recevoir la commande', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [makeOrder()] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [makeItem()] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ reference: 'KOM-P-2026-000041' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'parcel-001', reference: 'KOM-P-2026-000042' }] })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const result = await distributeOrder('order-001');

      expect(result).toEqual({
        success: true,
        order_ref: 'CMD-001',
        parcel_ref: 'KOM-P-2026-000042',
        parcel_id: 'parcel-001',
        items_assigned: 1,
        parcel_created: true,
        destination: 'ANJOUAN',
      });
      expect(db.query.mock.calls[5][0]).toContain('INSERT INTO parcels');
      expect(db.query.mock.calls[5][1]).toEqual(['KOM-P-2026-000042', 'order-001', 'relais-001', 'Auto-ANJOUAN']);
      expect(db.query.mock.calls[6][0]).toContain('INSERT INTO parcel_items');
    });

    it('utilise un colis ouvert existant quand il reste de la place', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [makeOrder()] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [makeItem({ quantity: 1 })] })
        .mockResolvedValueOnce({ rows: [{ id: 'parcel-open', reference: 'KOM-P-2026-000010', item_count: 5, order_count: 2 }] })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const result = await distributeOrder('order-001');

      expect(result.parcel_id).toBe('parcel-open');
      expect(result.parcel_created).toBe(false);
      expect(result.items_assigned).toBe(1);
      expect(db.query.mock.calls.some(call => String(call[0]).includes('INSERT INTO parcels'))).toBe(false);
      expect(db.query.mock.calls[4][1]).toEqual(['parcel-open', 'oi-001', 1, 'product-001']);
    });

    it('retourne already_assigned si la commande a deja des items dans un colis actif', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [makeOrder()] })
        .mockResolvedValueOnce({ rows: [{ id: 'pi-existing' }] });

      const result = await distributeOrder('order-001');

      expect(result).toEqual({ success: true, already_assigned: true, order_ref: 'CMD-001' });
      expect(db.query).toHaveBeenCalledTimes(2);
    });

    it('met la commande en file quand la destination a deja trop de colis ouverts', async () => {
      const openParcels = Array.from({ length: MAX_OPEN_PARCELS_PER_DEST }, (_, i) => ({
        id: `parcel-${i}`,
        reference: `KOM-P-2026-00000${i}`,
        item_count: MAX_ITEMS_PER_PARCEL,
        order_count: 10,
      }));
      db.query
        .mockResolvedValueOnce({ rows: [makeOrder({ reference: 'CMD-SAT' })] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [makeItem()] })
        .mockResolvedValueOnce({ rows: openParcels });

      const result = await distributeOrder('order-001');

      expect(result.success).toBe(true);
      expect(result.queued).toBe(true);
      expect(result.order_ref).toBe('CMD-SAT');
      expect(result.open_parcels).toHaveLength(MAX_OPEN_PARCELS_PER_DEST);
    });

    it('retourne une erreur claire si la commande est introuvable', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      await expect(distributeOrder('missing-order')).resolves.toEqual({ success: false, error: 'Order not found' });
    });
  });

  describe('distributeAll', () => {
    it('distribue un batch de commandes non assignees', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{ id: 'order-001', reference: 'CMD-001' }] })
        .mockResolvedValueOnce({ rows: [makeOrder()] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [makeItem()] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'parcel-001', reference: 'KOM-P-2026-000001' }] })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const result = await distributeAll();

      expect(result.distributed).toBe(1);
      expect(result.queued).toBe(0);
      expect(result.already_assigned).toBe(0);
      expect(result.errors).toBe(0);
      expect(result.details[0]).toEqual(expect.objectContaining({ success: true, parcel_created: true }));
    });
  });

  describe('getDistribution', () => {
    it('retourne les colis ouverts, les commandes non assignees et les destinations saturees', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [
          { id: 'p1', relais_island: 'ANJOUAN', items_count: 30, orders_count: 10 },
          { id: 'p2', relais_island: 'ANJOUAN', items_count: 30, orders_count: 10 },
          { id: 'p3', relais_island: 'ANJOUAN', items_count: 10, orders_count: 1 },
        ] })
        .mockResolvedValueOnce({ rows: [{ id: 'order-queued', relais_island: 'anjouan' }] });

      const result = await getDistribution();

      expect(result.parcels).toHaveLength(3);
      expect(result.unassigned).toHaveLength(1);
      expect(result.saturated).toEqual([{
        destination: 'ANJOUAN',
        open_parcels: 3,
        full_parcels: 2,
        queued_orders: 1,
        message: expect.stringContaining('ANJOUAN'),
      }]);
      expect(result.limits.MAX_ITEMS_PER_PARCEL).toBe(MAX_ITEMS_PER_PARCEL);
    });
  });

  describe('cleanupGhostParcels', () => {
    it('supprime les colis fantomes auto et retourne les references nettoyees', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{ id: 'ghost-1', reference: 'KOM-P-2026-000100' }] })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ id: 'ghost-2', reference: 'KOM-P-2026-000101' }] })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const result = await cleanupGhostParcels();

      expect(result).toEqual({ deleted: 2, ghosts: ['KOM-P-2026-000100', 'KOM-P-2026-000101'] });
      expect(db.query.mock.calls.filter(call => String(call[0]).startsWith('DELETE FROM parcels'))).toHaveLength(2);
    });
  });
});
