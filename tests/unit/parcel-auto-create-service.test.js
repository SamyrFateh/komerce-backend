'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * Tests unitaires — parcel-auto-create-service.js (R7)
 *
 * Chemins couverts :
 *
 *   autoCreateParcel :
 *     □ commande introuvable            → { success: false, reason: 'order_not_found' }
 *     □ commande non payée             → { success: false, reason: 'not_paid' }
 *     □ colis déjà existant            → { success: false, reason: 'parcel_exists' }
 *     □ aucun item                     → { success: false, reason: 'no_items' }
 *     □ cas nominal                    → parcels INSERT + parcel_items + scan_events + transitions
 *     □ INSERT parcel_item échoue      → SAVEPOINT rollback, colis quand même créé
 *     □ commande déjà 'ordered'        → transition preparation seulement (pas confirmed→ordered)
 *
 *   confirmCashAndCreateParcel :
 *     □ commande introuvable            → throw 404
 *     □ pas cash_relais                → throw 400
 *     □ déjà payé                      → throw 400
 *     □ nominal                        → UPDATE payment_status + autoCreateParcel + COMMIT
 *     □ autoCreateParcel échoue        → COMMIT quand même (résultat success: false)
 *
 *   createParcelManually :
 *     □ commande introuvable            → throw 404
 *     □ paiement non confirmé          → throw 400 + rule
 *     □ statut incompatible            → throw 400
 *     □ nominal                        → autoCreateParcel + COMMIT + { order, parcel }
 *     □ autoCreateParcel.success=false → ROLLBACK + throw 400
 */

// ─── Mocks globaux ────────────────────────────────────────────────────────────

let mockGetClient = jest.fn();

jest.mock('../../db', () => ({
  getClient: (...args) => mockGetClient(...args),
}));

jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const mockTransitionOrderStatus = jest.fn();
jest.mock('../../services/order-status-machine', () => ({
  transitionOrderStatus: (...args) => mockTransitionOrderStatus(...args),
}));

// ─── Require après les mocks ──────────────────────────────────────────────────

const {
  autoCreateParcel,
  confirmCashAndCreateParcel,
  createParcelManually,
} = require('../../services/parcel-auto-create-service');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Crée un faux client transactionnel avec une file de réponses.
 * BEGIN / COMMIT / ROLLBACK / SAVEPOINT sont absorbés sans consommer la file.
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
      if (/^(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT)/i.test(s)) {
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

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ORDER_PAID = {
  id: 'order-uuid',
  reference: 'KOM-001',
  status: 'confirmed',
  payment_status: 'paid',
  payment_mode: 'cash_relais',
  total_kmf: 25000,
  user_id: 'user-uuid',
  relais_id: 'relais-uuid',
  destination_island: 'Grande Comore',
  customer_name: 'Fatima Ali',
  customer_phone: '+269600001',
  relais_name: 'Relais Moroni',
  relais_island: 'Grande Comore',
};

const ORDER_UNPAID = { ...ORDER_PAID, payment_status: 'pending' };
const ORDER_ORDERED = { ...ORDER_PAID, status: 'ordered' };

const ITEM = {
  id: 'item-uuid',
  product_id: 'prod-uuid',
  quantity: 2,
  price_kmf: 12500,
  product_name: 'Casque Bluetooth',
  product_weight: 0.4,
};

const ACTOR = { id: 'admin-uuid', name: 'Admin CT', role: 'admin' };

beforeEach(() => {
  jest.clearAllMocks();
  mockTransitionOrderStatus.mockResolvedValue({ success: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
//   autoCreateParcel
// ═══════════════════════════════════════════════════════════════════════════════

describe('autoCreateParcel', () => {
  test('commande introuvable → success: false, reason: order_not_found', async () => {
    const client = makeClient([{ rows: [] }]);
    const result = await autoCreateParcel(client, 'unknown-id', ACTOR);
    expect(result).toEqual({ success: false, reason: 'order_not_found' });
  });

  test('commande non payée → success: false, reason: not_paid', async () => {
    const client = makeClient([{ rows: [ORDER_UNPAID] }]);
    const result = await autoCreateParcel(client, ORDER_UNPAID.id, ACTOR);
    expect(result).toEqual({ success: false, reason: 'not_paid' });
  });

  test('colis déjà existant → success: false, reason: parcel_exists', async () => {
    const client = makeClient([
      { rows: [ORDER_PAID] },
      { rows: [{ id: 'parcel-old', reference: 'PCL-2026-0001' }] }, // parcels existants
    ]);
    const result = await autoCreateParcel(client, ORDER_PAID.id, ACTOR);
    expect(result).toEqual({ success: false, reason: 'parcel_exists', parcel_ref: 'PCL-2026-0001' });
  });

  test('aucun item → success: false, reason: no_items', async () => {
    const client = makeClient([
      { rows: [ORDER_PAID] },
      { rows: [] },              // pas de colis existant
      { rows: [] },              // pas d'items
    ]);
    const result = await autoCreateParcel(client, ORDER_PAID.id, ACTOR);
    expect(result).toEqual({ success: false, reason: 'no_items' });
  });

  test('cas nominal → colis créé, transitions appliquées', async () => {
    const client = makeClient([
      { rows: [ORDER_PAID] },                       // SELECT order
      { rows: [] },                                 // pas de colis existant
      { rows: [ITEM] },                             // items
      { rows: [{ max_seq: 3 }] },                   // séquence PCL
      // INSERT parcels (pas de rows attendu ici)
      { rows: [] },
      // INSERT parcel_items × 1
      { rows: [] },
      // INSERT scan_events
      { rows: [] },
    ]);

    const result = await autoCreateParcel(client, ORDER_PAID.id, ACTOR);

    expect(result.success).toBe(true);
    expect(result.parcel).toMatchObject({
      reference: 'PCL-2026-0004',
      status: 'preparation',
      nb_items: 1,
      total_qty: 2,
    });
    expect(result.parcel.pickup_code).toMatch(/^[A-Z0-9]{6}$/);

    // Vérifier les INSERT
    const inserts = client.calls.filter(c => c.sql.startsWith('INSERT INTO parcels'));
    expect(inserts).toHaveLength(1);

    // Vérifier les transitions
    expect(mockTransitionOrderStatus).toHaveBeenCalledWith(
      expect.objectContaining({ newStatus: 'ordered' })
    );
    expect(mockTransitionOrderStatus).toHaveBeenCalledWith(
      expect.objectContaining({ newStatus: 'preparation' })
    );
  });

  test('INSERT parcel_item échoue → SAVEPOINT rollback, colis quand même créé', async () => {
    const client = makeClient([
      { rows: [ORDER_PAID] },
      { rows: [] },
      { rows: [ITEM] },
      { rows: [{ max_seq: 0 }] },
      { rows: [] },                            // INSERT parcels OK
      { error: new Error('fk_violation') },    // INSERT parcel_item → crash → SAVEPOINT
      { rows: [] },                            // INSERT scan_events
    ]);

    const result = await autoCreateParcel(client, ORDER_PAID.id, ACTOR);
    expect(result.success).toBe(true);

    const rbSp = client.calls.find(c => /ROLLBACK TO SAVEPOINT sp_pi/i.test(c.sql));
    expect(rbSp).toBeDefined();
  });

  test('commande déjà ordered → transition preparation seulement, pas confirmed→ordered', async () => {
    const client = makeClient([
      { rows: [ORDER_ORDERED] },
      { rows: [] },
      { rows: [ITEM] },
      { rows: [{ max_seq: 1 }] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
    ]);

    await autoCreateParcel(client, ORDER_ORDERED.id, ACTOR);

    const toOrdered = mockTransitionOrderStatus.mock.calls.filter(
      ([args]) => args.newStatus === 'ordered'
    );
    expect(toOrdered).toHaveLength(0);

    const toPrep = mockTransitionOrderStatus.mock.calls.filter(
      ([args]) => args.newStatus === 'preparation'
    );
    expect(toPrep).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//   confirmCashAndCreateParcel
// ═══════════════════════════════════════════════════════════════════════════════

describe('confirmCashAndCreateParcel', () => {
  test('commande introuvable → throw 404', async () => {
    const client = makeClient([{ rows: [] }]);
    mockGetClient.mockResolvedValue(client);

    await expect(confirmCashAndCreateParcel('KOM-INCONNU', ACTOR))
      .rejects.toMatchObject({ status: 404 });

    expect(client.released).toBe(true);
  });

  test('pas cash_relais → throw 400', async () => {
    const orderStripe = { ...ORDER_PAID, payment_mode: 'stripe_eur', payment_status: 'pending' };
    const client = makeClient([{ rows: [orderStripe] }]);
    mockGetClient.mockResolvedValue(client);

    await expect(confirmCashAndCreateParcel('KOM-001', ACTOR))
      .rejects.toMatchObject({ status: 400 });

    expect(client.released).toBe(true);
  });

  test('déjà payé → throw 400', async () => {
    const orderAlreadyPaid = { ...ORDER_PAID, payment_status: 'paid' };
    const client = makeClient([{ rows: [orderAlreadyPaid] }]);
    mockGetClient.mockResolvedValue(client);

    await expect(confirmCashAndCreateParcel('KOM-001', ACTOR))
      .rejects.toMatchObject({ status: 400 });

    expect(client.released).toBe(true);
  });

  test('nominal → payment_status mis à jour + colis créé + COMMIT', async () => {
    const orderPending = { ...ORDER_PAID, payment_status: 'pending' };

    const client = makeClient([
      { rows: [orderPending] },       // SELECT order (confirmCash)
      { rows: [], rowCount: 1 },      // UPDATE payment_status = paid
      // autoCreateParcel queries :
      { rows: [ORDER_PAID] },         // SELECT order (autoCreateParcel)
      { rows: [] },                   // pas de colis existant
      { rows: [ITEM] },               // items
      { rows: [{ max_seq: 5 }] },     // séquence PCL
      { rows: [] },                   // INSERT parcels
      { rows: [] },                   // INSERT parcel_items
      { rows: [] },                   // INSERT scan_events
      { rows: [{}] },                 // ensureSecretGenerated: SELECT pickup_secret_hash/last4 (aucun existant)
      { rows: [] },                   // generateAndStoreSecret: SELECT id anti-collision (pas de doublon)
      { rows: [] },                   // generateAndStoreSecret: UPDATE orders (stockage du secret)
    ]);
    mockGetClient.mockResolvedValue(client);

    const { order, parcelResult } = await confirmCashAndCreateParcel('KOM-001', ACTOR);

    expect(order.reference).toBe('KOM-001');
    expect(parcelResult.success).toBe(true);
    expect(parcelResult.parcel.reference).toBe('PCL-2026-0006');

    const commit = client.calls.find(c => /^COMMIT$/i.test(c.sql));
    expect(commit).toBeDefined();
    expect(client.released).toBe(true);
  });

  test('autoCreateParcel → success: false → COMMIT quand même, résultat propagé', async () => {
    const orderPending = { ...ORDER_PAID, payment_status: 'pending' };

    const client = makeClient([
      { rows: [orderPending] },
      { rows: [], rowCount: 1 },    // UPDATE payment_status
      { rows: [ORDER_PAID] },       // SELECT order (autoCreateParcel)
      { rows: [{ id: 'old-parcel', reference: 'PCL-2026-0001' }] }, // colis déjà existant
      { rows: [{}] },               // ensureSecretGenerated: SELECT pickup_secret_hash/last4 (aucun existant)
      { rows: [] },                 // generateAndStoreSecret: SELECT id anti-collision (pas de doublon)
      { rows: [] },                 // generateAndStoreSecret: UPDATE orders (stockage du secret)
    ]);
    mockGetClient.mockResolvedValue(client);

    const { parcelResult } = await confirmCashAndCreateParcel('KOM-001', ACTOR);

    expect(parcelResult.success).toBe(false);
    expect(parcelResult.reason).toBe('parcel_exists');

    const commit = client.calls.find(c => /^COMMIT$/i.test(c.sql));
    expect(commit).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//   createParcelManually
// ═══════════════════════════════════════════════════════════════════════════════

describe('createParcelManually', () => {
  test('commande introuvable → throw 404', async () => {
    const client = makeClient([{ rows: [] }]);
    mockGetClient.mockResolvedValue(client);

    await expect(createParcelManually('KOM-INCONNU', ACTOR))
      .rejects.toMatchObject({ status: 404 });
    expect(client.released).toBe(true);
  });

  test('paiement non confirmé → throw 400 + rule', async () => {
    const orderUnpaid = { ...ORDER_PAID, payment_status: 'pending' };
    const client = makeClient([{ rows: [orderUnpaid] }]);
    mockGetClient.mockResolvedValue(client);

    const err = await createParcelManually('KOM-001', ACTOR).catch(e => e);
    expect(err.status).toBe(400);
    expect(err.rule).toBeDefined();
    expect(client.released).toBe(true);
  });

  test('statut incompatible (ex: cancelled) → throw 400', async () => {
    const orderCancelled = { ...ORDER_PAID, status: 'cancelled' };
    const client = makeClient([{ rows: [orderCancelled] }]);
    mockGetClient.mockResolvedValue(client);

    await expect(createParcelManually('KOM-001', ACTOR))
      .rejects.toMatchObject({ status: 400 });
    expect(client.released).toBe(true);
  });

  test('nominal (statut confirmed) → { order, parcel } + COMMIT', async () => {
    const client = makeClient([
      { rows: [ORDER_PAID] },         // SELECT order
      // autoCreateParcel queries :
      { rows: [ORDER_PAID] },
      { rows: [] },
      { rows: [ITEM] },
      { rows: [{ max_seq: 10 }] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
    ]);
    mockGetClient.mockResolvedValue(client);

    const { order, parcel } = await createParcelManually('KOM-001', ACTOR);

    expect(order.reference).toBe('KOM-001');
    expect(parcel.reference).toBe('PCL-2026-0011');
    expect(parcel.status).toBe('preparation');

    const commit = client.calls.find(c => /^COMMIT$/i.test(c.sql));
    expect(commit).toBeDefined();
    expect(client.released).toBe(true);
  });

  test('nominal (statut ordered) → accepté', async () => {
    const client = makeClient([
      { rows: [ORDER_ORDERED] },
      { rows: [ORDER_ORDERED] },
      { rows: [] },
      { rows: [ITEM] },
      { rows: [{ max_seq: 2 }] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
    ]);
    mockGetClient.mockResolvedValue(client);

    const { order } = await createParcelManually('KOM-001', ACTOR);
    expect(order.status).toBe('ordered');
    expect(client.released).toBe(true);
  });

  test('autoCreateParcel.success=false → ROLLBACK + throw 400', async () => {
    const client = makeClient([
      { rows: [ORDER_PAID] },        // SELECT order (createParcelManually)
      { rows: [ORDER_PAID] },        // SELECT order (autoCreateParcel)
      { rows: [{ id: 'x', reference: 'PCL-2026-0001' }] }, // colis déjà existant
    ]);
    mockGetClient.mockResolvedValue(client);

    await expect(createParcelManually('KOM-001', ACTOR))
      .rejects.toMatchObject({ status: 400 });

    const rollback = client.calls.find(c => /^ROLLBACK$/i.test(c.sql));
    expect(rollback).toBeDefined();
    expect(client.released).toBe(true);
  });
});
