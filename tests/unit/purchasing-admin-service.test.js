'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * Tests unitaires — purchasing-admin-service.js (R7)
 *
 * Chemins couverts :
 *
 *   deleteSupplier :
 *     □ fournisseur introuvable / déjà deleted  → throw 404
 *     □ POs confirmées sans force               → throw 409
 *     □ fournisseur [TEST] avec force           → forcer annulation toutes POs
 *     □ cas nominal                             → soft-delete + annulation pending POs
 *
 *   confirmPurchaseOrder :
 *     □ PO introuvable / mauvais order_id       → throw 404
 *     □ statut non confirmable (ex: cancelled)  → throw 409
 *     □ nominal (pending → confirmed)           → UPDATE + UPDATE orders supplier_name
 *     □ nominal (notified → confirmed)          → idem
 *
 *   cancelPurchaseOrder :
 *     □ PO introuvable                          → throw 404
 *     □ statut reçu sans force                  → throw 409
 *     □ statut reçu avec force                  → UPDATE → cancelled
 *     □ nominal (pending → cancelled)           → UPDATE + { cancelled: true }
 */

// ─── Mocks globaux ─────────────────────────────────────────────────────────────

let mockQuery    = jest.fn();
let mockGetClient = jest.fn();

jest.mock('../../db', () => ({
  query:     (...args) => mockQuery(...args),
  getClient: (...args) => mockGetClient(...args),
}));

jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

// ─── Require après les mocks ──────────────────────────────────────────────────

const {
  deleteSupplier,
  confirmPurchaseOrder,
  cancelPurchaseOrder,
} = require('../../services/purchasing-admin-service');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Client transactionnel (BEGIN/COMMIT/ROLLBACK absorbés, file de réponses).
 */
function makeClient(script = []) {
  const queue = [...script];
  const calls = [];
  const client = {
    calls,
    released: false,
    query: jest.fn(async (sql, params = []) => {
      const s = String(sql).replace(/\s+/g, ' ').trim();
      calls.push({ sql: s, params });
      if (/^(BEGIN|COMMIT|ROLLBACK)/i.test(s)) {
        return { rows: [], rowCount: 0 };
      }
      const next = queue.shift();
      if (!next) throw new Error(`No mock for: ${s.slice(0, 80)}`);
      if (next.error) throw next.error;
      return { rows: next.rows || [], rowCount: next.rowCount ?? (next.rows?.length ?? 0) };
    }),
    release: jest.fn(() => { client.released = true; }),
  };
  return client;
}

/**
 * db.query simple (hors transaction) — file de réponses.
 */
function makeDbQueue(script = []) {
  const queue = [...script];
  return jest.fn(async (sql, _params) => {
    const next = queue.shift();
    if (!next) throw new Error(`No db.query mock for: ${String(sql).slice(0, 60)}`);
    if (next.error) throw next.error;
    return { rows: next.rows || [], rowCount: next.rowCount ?? (next.rows?.length ?? 0) };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════════
//   deleteSupplier
// ═══════════════════════════════════════════════════════════════════════════════

describe('deleteSupplier', () => {
  test('fournisseur introuvable → throw 404', async () => {
    const client = makeClient([
      { rows: [] }, // SELECT suppliers → vide
    ]);
    mockGetClient.mockResolvedValue(client);

    await expect(deleteSupplier('unknown-uuid'))
      .rejects.toMatchObject({ status: 404 });
    expect(client.released).toBe(true);
  });

  test('POs confirmées sans forceDelete → throw 409', async () => {
    const client = makeClient([
      { rows: [{ id: 'sup-uuid', name: 'AliExpress' }] }, // SELECT supplier
      { rows: [{ id: 'po-uuid' }] },                        // SELECT confirmed POs
    ]);
    mockGetClient.mockResolvedValue(client);

    await expect(deleteSupplier('sup-uuid', false))
      .rejects.toMatchObject({ status: 409 });
    expect(client.released).toBe(true);
  });

  test('fournisseur [TEST] avec forceDelete → annule toutes POs, soft-delete', async () => {
    const client = makeClient([
      { rows: [{ id: 'sup-test', name: 'FournisseurDev [TEST]' }] }, // SELECT supplier
      { rows: [{ id: 'po-conf' }] },                                   // SELECT confirmed POs
      { rows: [], rowCount: 2 },   // UPDATE POs → cancelled (force, toutes)
      { rows: [], rowCount: 3 },   // UPDATE product_suppliers mappings
      { rows: [] },                // UPDATE suppliers deleted_at
    ]);
    mockGetClient.mockResolvedValue(client);

    const result = await deleteSupplier('sup-test', true);
    expect(result.deleted).toBe(true);
    expect(result.pos_cancelled).toBe(2);
    expect(result.mappings_deleted).toBe(3);
    expect(client.released).toBe(true);
  });

  test('cas nominal (pas de PO confirmée) → soft-delete + annulation pending', async () => {
    const client = makeClient([
      { rows: [{ id: 'sup-uuid', name: 'Noon Wholesale' }] }, // SELECT supplier
      { rows: [] },              // SELECT confirmed POs → aucune
      { rows: [], rowCount: 1 }, // UPDATE POs pending/notified → cancelled
      { rows: [], rowCount: 2 }, // UPDATE product_suppliers
      { rows: [] },              // UPDATE suppliers deleted_at
    ]);
    mockGetClient.mockResolvedValue(client);

    const result = await deleteSupplier('sup-uuid');
    expect(result).toMatchObject({
      deleted: true,
      id: 'sup-uuid',
      name: 'Noon Wholesale',
      pos_cancelled: 1,
      mappings_deleted: 2,
    });

    const rollback = client.calls.find(c => /^ROLLBACK$/i.test(c.sql));
    expect(rollback).toBeUndefined(); // pas de rollback sur le chemin nominal
    const commit = client.calls.find(c => /^COMMIT$/i.test(c.sql));
    expect(commit).toBeDefined();
    expect(client.released).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//   confirmPurchaseOrder
// ═══════════════════════════════════════════════════════════════════════════════

describe('confirmPurchaseOrder', () => {
  test('PO introuvable → throw 404', async () => {
    mockQuery = makeDbQueue([
      { rows: [] }, // SELECT PO → vide
    ]);

    await expect(confirmPurchaseOrder('po-uuid', 'order-uuid'))
      .rejects.toMatchObject({ status: 404 });
  });

  test('statut "cancelled" → throw 409', async () => {
    mockQuery = makeDbQueue([
      { rows: [{ id: 'po-uuid', status: 'cancelled' }] }, // SELECT PO
    ]);

    await expect(confirmPurchaseOrder('po-uuid', 'order-uuid'))
      .rejects.toMatchObject({ status: 409 });
  });

  test('statut "received" → throw 409', async () => {
    mockQuery = makeDbQueue([
      { rows: [{ id: 'po-uuid', status: 'received' }] },
    ]);

    await expect(confirmPurchaseOrder('po-uuid', 'order-uuid'))
      .rejects.toMatchObject({ status: 409 });
  });

  test('nominal (pending → confirmed) → UPDATE PO + UPDATE orders supplier_name', async () => {
    const updatedPo = {
      id: 'po-uuid', order_id: 'order-uuid', supplier_id: 'sup-uuid',
      status: 'confirmed', supplier_order_id: 'SUP-123',
    };
    mockQuery = makeDbQueue([
      { rows: [{ id: 'po-uuid', status: 'pending' }] },  // SELECT PO check
      { rows: [updatedPo] },                               // UPDATE PO RETURNING *
      { rows: [{ name: 'Noon Wholesale' }] },             // SELECT supplier name
      { rows: [] },                                        // UPDATE orders supplier_name
    ]);

    const result = await confirmPurchaseOrder('po-uuid', 'order-uuid', {
      supplier_order_id: 'SUP-123',
    });

    expect(result).toMatchObject({ success: true });
    expect(result.purchase_order.status).toBe('confirmed');
  });

  test('nominal (notified → confirmed) → idem', async () => {
    const updatedPo = {
      id: 'po-uuid', order_id: 'order-uuid', supplier_id: 'sup-uuid',
      status: 'confirmed',
    };
    mockQuery = makeDbQueue([
      { rows: [{ id: 'po-uuid', status: 'notified' }] },
      { rows: [updatedPo] },
      { rows: [{ name: 'AliExpress' }] },
      { rows: [] },
    ]);

    const result = await confirmPurchaseOrder('po-uuid', 'order-uuid', {});
    expect(result.success).toBe(true);
  });

  test('UPDATE PO retourne vide → throw 404', async () => {
    mockQuery = makeDbQueue([
      { rows: [{ id: 'po-uuid', status: 'pending' }] }, // SELECT PO OK
      { rows: [] },                                       // UPDATE → vide (race condition)
    ]);

    await expect(confirmPurchaseOrder('po-uuid', 'order-uuid'))
      .rejects.toMatchObject({ status: 404 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//   cancelPurchaseOrder
// ═══════════════════════════════════════════════════════════════════════════════

describe('cancelPurchaseOrder', () => {
  test('PO introuvable → throw 404', async () => {
    mockQuery = makeDbQueue([{ rows: [] }]);

    await expect(cancelPurchaseOrder('unknown-po'))
      .rejects.toMatchObject({ status: 404 });
  });

  test('statut "received" sans forceDelete → throw 409 avec current_status', async () => {
    mockQuery = makeDbQueue([
      { rows: [{ id: 'po-uuid', status: 'received' }] },
    ]);

    const err = await cancelPurchaseOrder('po-uuid', false).catch(e => e);
    expect(err.status).toBe(409);
    expect(err.current_status).toBe('received');
  });

  test('statut "partially_received" sans force → throw 409', async () => {
    mockQuery = makeDbQueue([
      { rows: [{ id: 'po-uuid', status: 'partially_received' }] },
    ]);

    await expect(cancelPurchaseOrder('po-uuid'))
      .rejects.toMatchObject({ status: 409 });
  });

  test('statut "received" avec forceDelete → UPDATE → cancelled', async () => {
    mockQuery = makeDbQueue([
      { rows: [{ id: 'po-uuid', status: 'received' }] }, // SELECT PO
      { rows: [] },                                        // UPDATE → cancelled
    ]);

    const result = await cancelPurchaseOrder('po-uuid', true);
    expect(result).toMatchObject({
      cancelled: true,
      po_id: 'po-uuid',
      previous_status: 'received',
    });
  });

  test('statut "pending" (nominal) → { cancelled: true }', async () => {
    mockQuery = makeDbQueue([
      { rows: [{ id: 'po-uuid', status: 'pending' }] },
      { rows: [] },
    ]);

    const result = await cancelPurchaseOrder('po-uuid');
    expect(result).toEqual({
      cancelled: true,
      po_id: 'po-uuid',
      previous_status: 'pending',
    });
  });

  test('statut "hub_received" avec force → annulé', async () => {
    mockQuery = makeDbQueue([
      { rows: [{ id: 'po-uuid', status: 'hub_received' }] },
      { rows: [] },
    ]);

    const result = await cancelPurchaseOrder('po-uuid', true);
    expect(result.previous_status).toBe('hub_received');
    expect(result.cancelled).toBe(true);
  });
});
