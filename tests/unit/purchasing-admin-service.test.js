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

// Réconciliation fournisseur : réelle par défaut, pilotable pour les cas Allegro (preuve requise).
let mockEvidence = null;
jest.mock('../../services/suppliers/purchase-order-confirmation-boundary', () => {
  const actual = jest.requireActual('../../services/suppliers/purchase-order-confirmation-boundary');
  return {
    ...actual,
    verifyProviderEvidenceForConfirmation: (...args) => (mockEvidence ? mockEvidence(...args) : actual.verifyProviderEvidenceForConfirmation(...args)),
  };
});

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
  mockEvidence = null;
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

  test('échec SQL puis ROLLBACK lui-même en échec : l\'erreur d\'origine est relayée, client libéré', async () => {
    const client = {
      released: false,
      query: jest.fn(async (sql) => {
        if (/^BEGIN/i.test(sql)) return { rows: [] };
        if (/^ROLLBACK/i.test(sql)) throw new Error('rollback failed');
        throw new Error('boom');
      }),
      release: jest.fn(() => { client.released = true; }),
    };
    mockGetClient.mockResolvedValue(client);

    await expect(deleteSupplier('sup-uuid')).rejects.toThrow('boom');
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
      { rows: [], rowCount: 0 },   // UPDATE purchase_lines ouvertes → annulées
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
      { rows: [], rowCount: 1 }, // UPDATE POs draft/pending/notified → cancelled
      { rows: [], rowCount: 4 }, // UPDATE purchase_lines ouvertes → annulées
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
      open_lines_cancelled: 4,
      mappings_deleted: 2,
    });

    // PR 7 : brouillons regroupés annulés avec les PO non engagées ; lignes ouvertes annulées avec trace
    const poUpdate = client.calls.find(c => /UPDATE purchase_orders/.test(c.sql));
    expect(poUpdate.sql).toContain("status IN ('draft', 'pending', 'notified')");
    const linesUpdate = client.calls.find(c => /UPDATE purchase_lines/.test(c.sql));
    expect(linesUpdate.sql).toContain("cancel_reason = 'supplier_deleted'");
    expect(linesUpdate.sql).toContain('purchase_order_id IS NULL AND cancelled_at IS NULL');
    expect(linesUpdate.params).toEqual(['sup-uuid']);

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
  test('PO regroupée (order_id NULL) → 409 PURCHASE_ORDER_GROUPED_USE_PO_ROUTES', async () => {
    mockQuery = makeDbQueue([{ rows: [{ id: 'po-uuid', order_id: null, status: 'draft' }] }]);

    await expect(confirmPurchaseOrder('po-uuid', 'order-uuid'))
      .rejects.toMatchObject({ status: 409, code: 'PURCHASE_ORDER_GROUPED_USE_PO_ROUTES' });
  });

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
    // double écriture : la ligne de la PO reçoit quantité/prix confirmés dans la même instruction
    const sql = mockQuery.mock.calls[1][0];
    expect(sql).toContain('UPDATE purchase_lines');
    expect(sql).toContain('confirmed_quantity IS NULL');
    expect(sql).toMatch(/SELECT \* FROM upd/);
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

  test('provider à réconciliation requise : preuve non validée → 409 sans écriture', async () => {
    const { COMMITMENT_VERDICT } = require('../../services/suppliers/purchase-order-confirmation-boundary');
    mockEvidence = jest.fn().mockResolvedValue({ required: true, provider: 'allegro', commitment_verdict: COMMITMENT_VERDICT.REJECTED, evidence: { reason: 'no_match' } });
    mockQuery = makeDbQueue([
      { rows: [{ id: 'po-uuid', status: 'notified', supplier_order_identity: { provider: 'allegro' }, supplier_unit_ref: 'U1', supplier_sku: 'S1', qty: 2 }] },
    ]);

    const err = await confirmPurchaseOrder('po-uuid', 'order-uuid', { supplier_order_id: 'RAW' }).catch(e => e);
    expect(err.status).toBe(409);
    expect(err.message).toContain('no_match');
    expect(err.current_status).toBe('notified');
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  test('preuve rejetée sans raison fournie → message générique', async () => {
    mockEvidence = jest.fn().mockResolvedValue({ required: true, provider: 'allegro', commitment_verdict: 'rejected' });
    mockQuery = makeDbQueue([{ rows: [{ id: 'po-uuid', status: 'pending', supplier_order_identity: { provider: 'allegro' }, qty: 1 }] }]);

    await expect(confirmPurchaseOrder('po-uuid', 'order-uuid', {})).rejects.toThrow('raison inconnue');
  });

  test('preuve validée : la PO snapshotte la référence vérifiée, jamais la valeur brute', async () => {
    const { COMMITMENT_VERDICT } = require('../../services/suppliers/purchase-order-confirmation-boundary');
    mockEvidence = jest.fn().mockResolvedValue({ required: true, provider: 'allegro', commitment_verdict: COMMITMENT_VERDICT.COMMITTED, external_ref: 'VERIFIED-1' });
    mockQuery = makeDbQueue([
      { rows: [{ id: 'po-uuid', status: 'notified', supplier_order_identity: { provider: 'allegro' }, qty: 1 }] },
      { rows: [{ id: 'po-uuid', order_id: 'order-uuid', supplier_id: 'sup-uuid', status: 'confirmed', supplier_order_id: 'VERIFIED-1' }] },
      { rows: [{ name: 'Allegro' }] },
      { rows: [] },
    ]);

    await confirmPurchaseOrder('po-uuid', 'order-uuid', { supplier_order_id: 'RAW' });
    expect(mockQuery.mock.calls[1][1]).toContain('VERIFIED-1');
    expect(mockQuery.mock.calls[1][1]).not.toContain('RAW');
  });

  test('fournisseur supprimé entre-temps : la confirmation n\'écrit pas de snapshot fournisseur', async () => {
    mockQuery = makeDbQueue([
      { rows: [{ id: 'po-uuid', status: 'pending' }] },
      { rows: [{ id: 'po-uuid', order_id: 'order-uuid', supplier_id: 'gone', status: 'confirmed' }] },
      { rows: [] },
    ]);

    await expect(confirmPurchaseOrder('po-uuid', 'order-uuid', {})).resolves.toMatchObject({ success: true });
    expect(mockQuery).toHaveBeenCalledTimes(3);
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
  test('PO regroupée → 409 PURCHASE_ORDER_GROUPED_USE_PO_ROUTES, rien n\'est écrit', async () => {
    mockQuery = makeDbQueue([{ rows: [{ id: 'po-uuid', order_id: null, status: 'draft' }] }]);

    await expect(cancelPurchaseOrder('po-uuid'))
      .rejects.toMatchObject({ status: 409, code: 'PURCHASE_ORDER_GROUPED_USE_PO_ROUTES' });
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

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
