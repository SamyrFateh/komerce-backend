'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
// H2 : distributeOrder ouvre sa transaction ; le verrou FOR UPDATE de la commande est absorbé par le client simulé
// (les autres requêtes restent sur db.query pour garder les séquences de réponses historiques).
jest.mock('../../db', () => {
  const query = jest.fn();
  const client = { query: (sql, params) => (/FROM orders WHERE id = \$1 FOR UPDATE/.test(sql) ? Promise.resolve({ rows: [] }) : query(sql, params)) };
  return { query, withTransaction: jest.fn(async (work) => work(client)) };
});
const mockTransition = jest.fn();
jest.mock('../../services/parcel-operations', () => ({ transitionParcelStatus: (...a) => mockTransition(...a) }));

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
  // Une ligne IMPORT ne peut être colisée que reçue ; sans provenance, refus fermé.
  return { id: 'oi-001', quantity: 2, product_id: 'product-001', fulfillment_source: 'IMPORT', received: 2, ...overrides };
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
        .mockResolvedValueOnce({ rows: [{ seq: '42' }] }) // nextval('parcel_ref_seq')
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

    it('LOCAL_STOCK : aucune distribution Hub ni INSERT colis avant attestation relais', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [makeOrder()] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [makeItem({ fulfillment_source: 'LOCAL_STOCK', received: 0 })] });
      const result = await distributeOrder('order-001');
      expect(result).toMatchObject({ success: true, nothing_eligible: true, local_direct_items: 1 });
      expect(db.query.mock.calls.some(([sql]) => /INSERT INTO (parcels|parcel_items)/.test(sql))).toBe(false);
    });

    it('provenance inconnue : échec fermé sans création physique', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [makeOrder()] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [makeItem({ fulfillment_source: null })] });
      await expect(distributeOrder('order-001')).rejects.toThrow('AUTO_PARCEL_FULFILLMENT_SOURCE_UNKNOWN');
      expect(db.query.mock.calls.some(([sql]) => /INSERT INTO (parcels|parcel_items)/.test(sql))).toBe(false);
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

    it('H2 : sans client fourni, la repartition ouvre une transaction et verrouille la commande (FOR UPDATE)', async () => {
      const locks = [];
      db.withTransaction.mockImplementationOnce(async (work) => work({
        query: (sql, params) => { if (/FOR UPDATE/.test(sql)) { locks.push(params[0]); return Promise.resolve({ rows: [] }); } return db.query(sql, params); },
      }));
      db.query.mockResolvedValueOnce({ rows: [] });
      await distributeOrder('order-lock');
      expect(db.withTransaction).toHaveBeenCalledTimes(1);
      expect(locks).toEqual(['order-lock']);
    });

    it('H2 : avec un client fourni, la commande est verrouillee sur ce client (transaction de l\'appelant)', async () => {
      const query = jest.fn()
        .mockResolvedValueOnce({ rows: [] }) // verrou
        .mockResolvedValueOnce({ rows: [] }); // commande introuvable
      await distributeOrder('order-x', { query });
      expect(query.mock.calls[0][0]).toMatch(/FROM orders WHERE id = \$1 FOR UPDATE/);
      expect(db.withTransaction).not.toHaveBeenCalled();
    });

    it('H2 : deux repartitions concurrentes de la meme commande -> un seul colis cree, l\'autre sort en already_assigned', async () => {
      // Simulation d'un verrou de ligne : la 2e transaction attend la fin de la 1re, puis relit l'etat committe.
      let assigned = false; let chain = Promise.resolve(); let parcelsCreated = 0;
      db.withTransaction.mockImplementation((work) => {
        const run = chain.then(() => work({ query: (sql) => {
          if (/FOR UPDATE/.test(sql)) return Promise.resolve({ rows: [] });
          if (/FROM orders o/.test(sql)) return Promise.resolve({ rows: [makeOrder()] });
          if (/SELECT 1 AS assigned/.test(sql)) return Promise.resolve({ rows: assigned ? [{ assigned: 1 }] : [] });
          if (/SELECT oi.id, oi.quantity/.test(sql)) return Promise.resolve({ rows: [makeItem()] });
          if (/FROM parcels p/.test(sql)) return Promise.resolve({ rows: [] });
          if (/nextval/.test(sql)) return Promise.resolve({ rows: [{ seq: '1' }] });
          if (/INSERT INTO parcels/.test(sql)) { parcelsCreated += 1; return Promise.resolve({ rows: [{ id: 'p1', reference: 'KOM-P-2026-000001' }] }); }
          if (/INSERT INTO parcel_items/.test(sql)) { assigned = true; return Promise.resolve({ rows: [], rowCount: 1 }); }
          return Promise.resolve({ rows: [] });
        } }));
        chain = run.catch(() => {});
        return run;
      });
      const [a, b] = await Promise.all([distributeOrder('order-001'), distributeOrder('order-001')]);
      db.withTransaction.mockImplementation(async (work) => work({ query: (sql, params) => (/FROM orders WHERE id = \$1 FOR UPDATE/.test(sql) ? Promise.resolve({ rows: [] }) : db.query(sql, params)) }));
      expect(parcelsCreated).toBe(1);
      expect([a, b].filter((r) => r.already_assigned)).toHaveLength(1);
      expect([a, b].filter((r) => r.parcel_created)).toHaveLength(1);
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
        .mockResolvedValueOnce({ rows: [{ seq: '1' }] })
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
    it('annule (jamais DELETE) les colis fantomes auto via le SSOT de transition et retourne { cancelled, references }', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ id: 'ghost-1', reference: 'KOM-P-2026-000100' }, { id: 'ghost-2', reference: 'KOM-P-2026-000101' }] });
      mockTransition.mockResolvedValue({ ok: true });

      const result = await cleanupGhostParcels();

      expect(result).toEqual({ cancelled: 2, references: ['KOM-P-2026-000100', 'KOM-P-2026-000101'] });
      expect(mockTransition).toHaveBeenCalledWith(db, 'ghost-1', 'cancelled', { cancelReason: 'ghost_auto_parcel_cleanup' });
      expect(db.query).toHaveBeenCalledTimes(1);
      expect(db.query.mock.calls[0][0]).toContain("p.label LIKE 'Auto-%'");
      expect(db.query.mock.calls[0][0]).not.toMatch(/KOM-P-%|DELETE/);
      expect(db.query.mock.calls[0][1]).toEqual([24]);
      for (const proof of ['scan_events', 'scans', 'hub_box_bags', 'customs_shipment_parcels', 'incidents', 'invoices', 'order_item_real_cost_allocations']) {
        expect(db.query.mock.calls[0][0]).toMatch(new RegExp(`NOT EXISTS \\(SELECT 1 FROM ${proof} `));
      }
    });
  });
});
