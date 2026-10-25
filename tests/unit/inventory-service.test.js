'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * Tests unitaires — inventory-service.js
 *
 * Invariants couverts :
 *   receiveItem           : article introuvable → throw ; nominal → insère + propose
 *   proposeAssignment     : colis compatible trouvé → status proposed ;
 *                           aucun colis → status buffered
 *   scanIntoParcel        : item déjà assigné → throw ; parcel introuvable → throw ;
 *                           nominal → assigned, matched_proposal distingué
 *   updateOrderCompletion : mise à jour du ratio (received / total)
 *   shouldDispatch        : ratio 1 → dispatch_full ; deadline passée + ratio ≥ 0.5 → partial ;
 *                           deadline passée + ratio < 0.5 → wait_or_cancel
 *   getStats / listProposals / listOpenParcels : délèguent à db.query, retournent les rows
 *
 * DB mockée — aucune connexion Postgres.
 */

// ─── Mock db ─────────────────────────────────────────────────────────────────
let mockQuery;
let mockConnect;
jest.mock('../../db', () => ({ get query() { return mockQuery; }, connect: (...args) => mockConnect(...args) }));
jest.mock('../../services/parcel-item-mutation-service', () => ({
  addParcelItemTraced: jest.fn().mockResolvedValue({ row: { id: 'parcel-item' } }),
  reassignParcelItem: jest.fn().mockResolvedValue({ moved: { id: 'parcel-item' } }),
}));

function loadService() {
  jest.resetModules();
  jest.mock('../../db', () => ({ query: (...a) => mockQuery(...a), connect: (...a) => mockConnect(...a) }));
  return require('../../services/inventory-service');
}

beforeEach(() => {
  mockQuery = jest.fn();
  mockConnect = jest.fn().mockResolvedValue({ query: (...args) => mockQuery(...args), release: jest.fn() });
});

// ─── receiveItem ─────────────────────────────────────────────────────────────
describe("receiveItem", () => {
  test("throw si article introuvable", async () => {
    mockQuery = jest.fn().mockResolvedValue({ rows: [] }); // oi not found
    const svc = loadService();
    await expect(svc.receiveItem({ order_item_id: 'unk' })).rejects.toThrow('introuvable');
  });

  test("nominal : INSERT inventory_item + propose + updateOrderCompletion", async () => {
    const oi = { id: 'oi-1', order_id: 'ord-1', product_id: 'p-1', quantity: 1, product_name: 'Riz' };
    const inv = { id: 'inv-1', order_item_id: 'oi-1', order_id: 'ord-1', status: 'received', destination_island: 'Grande Comore' };

    mockQuery = jest.fn()
      // 1. BEGIN — la réception est atomique
      .mockResolvedValueOnce({ rows: [] })
      // 2. SELECT order_items JOIN products sous verrou
      .mockResolvedValueOnce({ rows: [oi] })
      // 2. INSERT inventory_items
      .mockResolvedValueOnce({ rows: [inv] })
      // 3. proposeAssignment → SELECT inventory_items
      .mockResolvedValueOnce({ rows: [{ ...inv, destination_island: 'Grande Comore' }] })
      // 4. proposeAssignment → SELECT parcels
      .mockResolvedValueOnce({ rows: [{ id: 'pcl-1', reference: 'P001', order_id: 'ord-1', priority: 0, item_count: 0 }] })
      // 5. proposeAssignment → UPDATE inventory_items
      .mockResolvedValueOnce({ rows: [] })
      // 6. updateOrderCompletion → SELECT counts
      .mockResolvedValueOnce({ rows: [{ total: 1, received: 1, assigned: 0 }] })
      // 7. updateOrderCompletion → UPDATE orders
      .mockResolvedValueOnce({ rows: [] });

    const svc = loadService();
    const result = await svc.receiveItem({ order_item_id: 'oi-1' });
    expect(result.item).toBeDefined();
    expect(result.proposal).toBeDefined();
  });
});

// ─── proposeAssignment ────────────────────────────────────────────────────────
describe("proposeAssignment", () => {
  test("retourne null si item déjà assigné (status non éligible)", async () => {
    mockQuery = jest.fn().mockResolvedValue({ rows: [] }); // item absent → already assigned
    const svc = loadService();
    const result = await svc.proposeAssignment('inv-already');
    expect(result).toBeNull();
  });

  test("status proposed si un colis compatible existe", async () => {
    const item = { id: 'inv-2', order_id: 'ord-1', destination_island: 'Grande Comore', status: 'received' };
    mockQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [item] })   // SELECT inventory_items
      .mockResolvedValueOnce({ rows: [{ id: 'pcl-2', reference: 'P002', order_id: 'ord-1', priority: 0, item_count: 0 }] }) // SELECT parcels
      .mockResolvedValueOnce({ rows: [] });       // UPDATE inventory_items

    const svc = loadService();
    const result = await svc.proposeAssignment('inv-2');
    expect(result.status).toBe('proposed');
    expect(result.parcel_id).toBe('pcl-2');
  });

  test("status buffered si aucun colis compatible", async () => {
    const item = { id: 'inv-3', order_id: 'ord-1', destination_island: 'Mohéli', status: 'received' };
    mockQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [item] })  // SELECT inventory_items
      .mockResolvedValueOnce({ rows: [] })       // SELECT parcels → aucun
      .mockResolvedValueOnce({ rows: [] });      // UPDATE inventory_items (buffered)

    const svc = loadService();
    const result = await svc.proposeAssignment('inv-3');
    expect(result.status).toBe('buffered');
    expect(result.reason).toBe('no_compatible_parcel');
  });
});

// ─── scanIntoParcel ───────────────────────────────────────────────────────────
describe("scanIntoParcel — atomicité RC-1", () => {
  function fixture({ itemMissing = false, parcelMissing = false, existingParcelId = null, itemOrder = 'ord-1' } = {}) {
    const item = {
      id: 'inv-1', order_id: 'ord-1', order_item_id: 'oi-1',
      proposed_parcel_id: 'pcl-1', status: 'proposed',
    };
    const client = { query: (...args) => mockQuery(...args), release: jest.fn() };
    mockConnect.mockResolvedValue(client);
    const sql = [];
    mockQuery = jest.fn(async (statement) => {
      sql.push(statement);
      if (statement.includes('FROM inventory_items') && statement.includes('FOR UPDATE')) {
        return { rows: itemMissing ? [] : [item] };
      }
      if (statement.includes('SELECT order_id FROM order_items')) return { rows: [{ order_id: itemOrder }] };
      if (statement.includes('SELECT parcel_id FROM parcel_items')) {
        return { rows: existingParcelId ? [{ parcel_id: existingParcelId }] : [] };
      }
      if (statement.includes('SELECT id FROM parcel_items')) {
        return { rows: parcelMissing ? [] : [{ id: 'pi-1' }] };
      }
      if (statement.includes('UPDATE inventory_items')) return { rows: [{ id: item.id }] };
      if (statement.includes('AS total')) return { rows: [{ total: 1, received: 1, assigned: 1 }] };
      if (statement.includes('SELECT reference FROM parcels')) return { rows: [{ reference: 'P001' }] };
      return { rows: [] };
    });
    return { client, sql };
  }

  test('nominal : ajoute puis vérifie le lien avant d affecter, même transaction COMMIT', async () => {
    const { client, sql } = fixture();
    const svc = loadService();
    const result = await svc.scanIntoParcel('inv-1', 'pcl-1');
    expect(result).toMatchObject({ assigned: true, matched_proposal: true, parcel_ref: 'P001' });
    const { addParcelItemTraced } = require('../../services/parcel-item-mutation-service');
    expect(addParcelItemTraced).toHaveBeenCalledWith(client,
      expect.objectContaining({ parcelId: 'pcl-1', orderItemId: 'oi-1', quantity: 1 }));
    expect(sql[0]).toBe('BEGIN');
    expect(sql.at(-1)).toBe('COMMIT');
    expect(sql.findIndex(x => x.includes('SELECT id FROM parcel_items')))
      .toBeLessThan(sql.findIndex(x => x.includes('UPDATE inventory_items')));
    expect(client.release).toHaveBeenCalled();
  });

  test('une affectation sans appartenance réelle doit échouer avec ROLLBACK', async () => {
    const { client, sql } = fixture({ parcelMissing: true });
    const svc = loadService();
    await expect(svc.scanIntoParcel('inv-1', 'pcl-1')).rejects.toMatchObject({
      code: 'PARCEL_MEMBERSHIP_NOT_PERSISTED', status: 409,
    });
    expect(sql).toContain('ROLLBACK');
    expect(sql.some(x => x.includes('UPDATE inventory_items'))).toBe(false);
    expect(client.release).toHaveBeenCalled();
  });

  test('aucune modification après refus de la règle marché / relais / état', async () => {
    const { client, sql } = fixture();
    const svc = loadService();
    const m = require('../../services/parcel-item-mutation-service');
    const error = Object.assign(new Error('Autre marché'), { code: 'MARKET_MISMATCH', status: 409 });
    m.addParcelItemTraced.mockRejectedValueOnce(error);
    await expect(svc.scanIntoParcel('inv-1', 'pcl-1')).rejects.toMatchObject({ code: 'MARKET_MISMATCH' });
    expect(sql).toContain('ROLLBACK');
    expect(sql.some(x => x.includes('UPDATE inventory_items'))).toBe(false);
    expect(client.release).toHaveBeenCalled();
  });

  test('colis expédié ou indisponible : refus 409 et rollback', async () => {
    const { sql } = fixture();
    const svc = loadService();
    const m = require('../../services/parcel-item-mutation-service');
    m.addParcelItemTraced.mockRejectedValueOnce(
      Object.assign(new Error('Colis déjà expédié'), { code: 'PARCEL_NOT_MUTABLE', status: 409 })
    );
    await expect(svc.scanIntoParcel('inv-1', 'pcl-1')).rejects.toMatchObject({
      code: 'PARCEL_NOT_MUTABLE', status: 409,
    });
    expect(sql).toContain('ROLLBACK');
    expect(sql.some(x => x.includes('UPDATE inventory_items'))).toBe(false);
  });

  test('item déjà attribué ou provenance incohérente : refus avant mutation', async () => {
    const first = fixture({ itemMissing: true });
    let svc = loadService();
    await expect(svc.scanIntoParcel('inv-1', 'pcl-1')).rejects.toThrow('introuvable');
    expect(first.sql).toContain('ROLLBACK');
    const second = fixture({ itemOrder: 'ord-autre' });
    svc = loadService();
    await expect(svc.scanIntoParcel('inv-1', 'pcl-1')).rejects.toMatchObject({
      code: 'INVENTORY_ORDER_MISMATCH',
    });
    expect(second.sql.some(x => x.includes('UPDATE inventory_items'))).toBe(false);
  });

  test('réaffectation explicite via le service canonique, pas un INSERT ignoré', async () => {
    const { client, sql } = fixture({ existingParcelId: 'pcl-old' });
    const svc = loadService();
    const result = await svc.scanIntoParcel('inv-1', 'pcl-new');
    expect(result.matched_proposal).toBe(false);
    const m = require('../../services/parcel-item-mutation-service');
    expect(m.reassignParcelItem).toHaveBeenCalledWith(client,
      expect.objectContaining({ fromParcelId: 'pcl-old', toParcelId: 'pcl-new', orderItemId: 'oi-1' }));
    expect(sql.at(-1)).toBe('COMMIT');
  });
});

// ─── shouldDispatch ───────────────────────────────────────────────────────────
describe("shouldDispatch", () => {
  test("throw si commande introuvable", async () => {
    mockQuery = jest.fn().mockResolvedValue({ rows: [] });
    const svc = loadService();
    await expect(svc.shouldDispatch('ord-ghost')).rejects.toThrow('Commande introuvable');
  });

  test("dispatch_full si ratio >= 1", async () => {
    mockQuery = jest.fn().mockResolvedValue({
      rows: [{ id: 'ord-1', completion_ratio: 1, deadline_dispatch: null }]
    });
    const svc = loadService();
    const r = await svc.shouldDispatch('ord-1');
    expect(r.decision).toBe('dispatch_full');
  });

  test("dispatch_partial si deadline passée et ratio >= 0.5", async () => {
    const past = new Date(Date.now() - 86400000).toISOString(); // hier
    mockQuery = jest.fn().mockResolvedValue({
      rows: [{ id: 'ord-2', completion_ratio: 0.7, deadline_dispatch: past }]
    });
    const svc = loadService();
    const r = await svc.shouldDispatch('ord-2');
    expect(r.decision).toBe('dispatch_partial');
  });

  test("wait_or_cancel si deadline passée et ratio < 0.5", async () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    mockQuery = jest.fn().mockResolvedValue({
      rows: [{ id: 'ord-3', completion_ratio: 0.3, deadline_dispatch: past }]
    });
    const svc = loadService();
    const r = await svc.shouldDispatch('ord-3');
    expect(r.decision).toBe('wait_or_cancel');
  });

  test("wait si rien de spécial", async () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    mockQuery = jest.fn().mockResolvedValue({
      rows: [{ id: 'ord-4', completion_ratio: 0.5, deadline_dispatch: future }]
    });
    const svc = loadService();
    const r = await svc.shouldDispatch('ord-4');
    expect(r.decision).toBe('wait');
  });
});

// ─── updateOrderCompletion ────────────────────────────────────────────────────
describe("updateOrderCompletion", () => {
  test("retourne null si commande absente", async () => {
    mockQuery = jest.fn().mockResolvedValue({ rows: [] }); // no counts
    const svc = loadService();
    const r = await svc.updateOrderCompletion('ord-ghost');
    expect(r).toBeUndefined(); // early return if !counts
  });

  test("calcule le ratio et met à jour orders", async () => {
    mockQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [{ total: 4, received: 2, assigned: 1 }] })
      .mockResolvedValueOnce({ rows: [] });
    const svc = loadService();
    const r = await svc.updateOrderCompletion('ord-5');
    expect(r.ratio).toBeCloseTo(0.5);
    expect(r.total).toBe(4);
  });
});

// ─── getStats ─────────────────────────────────────────────────────────────────
describe("getStats", () => {
  test("merge inventory_items et parcels stats", async () => {
    mockQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [{ received: 3, proposed: 2, assigned: 1, buffered: 0, overdue: 0, avg_assign_minutes: 15 }] })
      .mockResolvedValueOnce({ rows: [{ open_parcels: 5, shipped_parcels: 2 }] });
    const svc = loadService();
    const stats = await svc.getStats();
    expect(stats.received).toBe(3);
    expect(stats.open_parcels).toBe(5);
  });
});

// ─── Lot A, branches manquantes ───────────────────────────────────────────────

describe("inventory-service — Lot A, branches manquantes", () => {
  describe("receiveItem — autorité de la ligne", () => {
    test("order_id contradictoire est rejeté 409 avant toute écriture", async () => {
      const oi = { id: 'oi-9', order_id: 'ord-oi', product_id: 'p-9', quantity: 1, product_name: 'Sucre' };
      mockQuery = jest.fn(async (sql) => {
        if (sql.includes('FROM order_items oi')) return { rows: [oi] };
        return { rows: [] };
      });

      const svc = loadService();
      await expect(svc.receiveItem({ order_item_id: 'oi-9', order_id: 'ord-explicit' }))
        .rejects.toMatchObject({ status: 409, code: 'INVENTORY_ORDER_MISMATCH' });

      const executed = mockQuery.mock.calls.map(([sql]) => sql);
      expect(executed[0]).toBe('BEGIN');
      expect(executed).toContain('ROLLBACK');
      expect(executed).not.toContain('COMMIT');
      expect(executed.some(sql => /INSERT INTO inventory_items|UPDATE inventory_items|SET items_received/.test(sql))).toBe(false);
    });
  });

  describe("proposeAssignment — alternatives", () => {
    test("plusieurs colis compatibles → alternatives contient les suivants", async () => {
      const item = { id: 'inv-alt', order_id: 'ord-1', destination_island: 'Grande Comore', status: 'received' };
      mockQuery = jest.fn()
        .mockResolvedValueOnce({ rows: [item] })
        .mockResolvedValueOnce({ rows: [
          { id: 'pcl-a', reference: 'PA', order_id: 'ord-1', priority: 0, item_count: 0 },
          { id: 'pcl-b', reference: 'PB', order_id: 'ord-1', priority: 0, item_count: 1 },
          { id: 'pcl-c', reference: 'PC', order_id: 'ord-1', priority: 1, item_count: 0 },
        ] })
        .mockResolvedValueOnce({ rows: [] });

      const svc = loadService();
      const result = await svc.proposeAssignment('inv-alt');
      expect(result.parcel_id).toBe('pcl-a');
      expect(result.alternatives).toHaveLength(2);
      expect(result.alternatives[0].id).toBe('pcl-b');
    });
  });

  describe("proposeAll", () => {
    test("compte proposed/buffered/errors sur plusieurs items", async () => {
      mockQuery = jest.fn()
        // SELECT items éligibles
        .mockResolvedValueOnce({ rows: [{ id: 'inv-p1' }, { id: 'inv-p2' }, { id: 'inv-p3' }] })
        // item 1 → proposeAssignment: SELECT item, SELECT parcels (compatible) → UPDATE
        .mockResolvedValueOnce({ rows: [{ id: 'inv-p1', order_id: 'ord-1', destination_island: 'GC', status: 'received' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'pcl-x', reference: 'PX', order_id: 'ord-1', priority: 0, item_count: 0 }] })
        .mockResolvedValueOnce({ rows: [] })
        // item 2 → proposeAssignment: SELECT item, SELECT parcels (aucun) → UPDATE buffered
        .mockResolvedValueOnce({ rows: [{ id: 'inv-p2', order_id: 'ord-2', destination_island: 'Mohéli', status: 'buffered' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        // item 3 → proposeAssignment throws (db error) → catch → errors++
        .mockRejectedValueOnce(new Error('db timeout'));

      const svc = loadService();
      const result = await svc.proposeAll();
      expect(result).toEqual({ proposed: 1, buffered: 1, errors: 1 });
    });

    test("aucun item éligible → tous les compteurs à zéro", async () => {
      mockQuery = jest.fn().mockResolvedValueOnce({ rows: [] });
      const svc = loadService();
      const result = await svc.proposeAll();
      expect(result).toEqual({ proposed: 0, buffered: 0, errors: 0 });
    });
  });

  describe("shouldDispatch — branches supplémentaires", () => {
    test("completion_ratio absent/null → ratio par défaut 0", async () => {
      mockQuery = jest.fn().mockResolvedValue({
        rows: [{ id: 'ord-9', completion_ratio: null, deadline_dispatch: null }]
      });
      const svc = loadService();
      const r = await svc.shouldDispatch('ord-9');
      expect(r.decision).toBe('wait');
      expect(r.ratio).toBe(0);
    });

    test("deadline_dispatch absent → deadlinePassed toujours false", async () => {
      mockQuery = jest.fn().mockResolvedValue({
        rows: [{ id: 'ord-10', completion_ratio: 0.3, deadline_dispatch: null }]
      });
      const svc = loadService();
      const r = await svc.shouldDispatch('ord-10');
      expect(r.decision).toBe('wait');
    });
  });

  describe("listProposals", () => {
    test("retourne les rows tels que renvoyés par la requête", async () => {
      const rows = [{ id: 'inv-1', product_name: 'Riz', order_ref: 'K-1' }];
      mockQuery = jest.fn().mockResolvedValueOnce({ rows });
      const svc = loadService();
      const result = await svc.listProposals();
      expect(result).toBe(rows);
      expect(mockQuery.mock.calls[0][0]).toContain('FROM inventory_items ii');
    });
  });

  describe("updateOrderCompletion — total à zéro", () => {
    test("counts.total = 0 → ratio forcé à 0 (pas de division par zéro)", async () => {
      mockQuery = jest.fn()
        .mockResolvedValueOnce({ rows: [{ total: 0, received: 0, assigned: 0 }] })
        .mockResolvedValueOnce({ rows: [] });
      const svc = loadService();
      const r = await svc.updateOrderCompletion('ord-empty');
      expect(r.ratio).toBe(0);
    });
  });

  describe("listOpenParcels", () => {
    test("retourne les colis ouverts (draft/preparation)", async () => {
      const rows = [{ id: 'pcl-1', reference: 'P001', status: 'draft' }];
      mockQuery = jest.fn().mockResolvedValueOnce({ rows });
      const svc = loadService();
      const result = await svc.listOpenParcels();
      expect(result).toBe(rows);
      expect(mockQuery.mock.calls[0][0]).toContain("'draft', 'preparation'");
    });
  });
});
