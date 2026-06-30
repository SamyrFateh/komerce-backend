'use strict';

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
jest.mock('../../db', () => ({ get query() { return mockQuery; } }));

function loadService() {
  jest.resetModules();
  jest.mock('../../db', () => ({ query: (...a) => mockQuery(...a) }));
  return require('../../services/inventory-service');
}

beforeEach(() => {
  mockQuery = jest.fn();
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
      // 1. SELECT order_items JOIN products
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
describe("scanIntoParcel", () => {
  test("throw si item introuvable ou déjà assigné", async () => {
    mockQuery = jest.fn().mockResolvedValue({ rows: [] }); // item absent
    const svc = loadService();
    await expect(svc.scanIntoParcel('inv-x', 'pcl-x')).rejects.toThrow('introuvable');
  });

  test("throw si parcel introuvable", async () => {
    const item = { id: 'inv-4', order_id: 'ord-1', order_item_id: 'oi-4', proposed_parcel_id: null, status: 'proposed' };
    mockQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [item] }) // item
      .mockResolvedValueOnce({ rows: [] });    // parcel introuvable
    const svc = loadService();
    await expect(svc.scanIntoParcel('inv-4', 'pcl-ghost')).rejects.toThrow('Colis introuvable');
  });

  test("nominal matched_proposal:true si parcel = proposed_parcel_id", async () => {
    const item = { id: 'inv-5', order_id: 'ord-1', order_item_id: 'oi-5', proposed_parcel_id: 'pcl-5', status: 'proposed' };
    mockQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [item] })
      .mockResolvedValueOnce({ rows: [{ id: 'pcl-5', reference: 'P005', status: 'preparation' }] })
      .mockResolvedValueOnce({ rows: [] }) // UPDATE inventory_items
      .mockResolvedValueOnce({ rows: [] }) // INSERT parcel_items
      .mockResolvedValueOnce({ rows: [{ total: 1, received: 1, assigned: 1 }] }) // counts
      .mockResolvedValueOnce({ rows: [] }); // UPDATE orders

    const svc = loadService();
    const result = await svc.scanIntoParcel('inv-5', 'pcl-5');
    expect(result.assigned).toBe(true);
    expect(result.matched_proposal).toBe(true);
  });

  test("nominal matched_proposal:false si parcel différent", async () => {
    const item = { id: 'inv-6', order_id: 'ord-1', order_item_id: 'oi-6', proposed_parcel_id: 'pcl-original', status: 'proposed' };
    mockQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [item] })
      .mockResolvedValueOnce({ rows: [{ id: 'pcl-other', reference: 'P006', status: 'preparation' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: 1, received: 1, assigned: 1 }] })
      .mockResolvedValueOnce({ rows: [] });

    const svc = loadService();
    const result = await svc.scanIntoParcel('inv-6', 'pcl-other');
    expect(result.matched_proposal).toBe(false);
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
