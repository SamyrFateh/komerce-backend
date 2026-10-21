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
 *   confirmCashAndCreateParcel (délégation à payment-cash-confirm) :
 *     □ refus (404/400/409), nominal, premier visa 202, refus de l'autorité, idempotence, échec colis
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

let mockQuery = jest.fn();
jest.mock('../../db', () => ({
  getClient: (...args) => mockGetClient(...args),
  query: (...args) => mockQuery(...args),
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

  test('couverture physique incomplète (C2) : le colis n\'est pas créé silencieusement, erreur 409 PHYSICAL_RECEPTION_INCOMPLETE', async () => {
    mockTransitionOrderStatus.mockResolvedValue({ success: false, code: 'PHYSICAL_RECEPTION_INCOMPLETE', error: 'Réception physique incomplète' });
    const client = makeClient([
      { rows: [ORDER_ORDERED] },
      { rows: [] },
      { rows: [ITEM] },
      { rows: [{ max_seq: 1 }] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
    ]);
    await expect(autoCreateParcel(client, ORDER_ORDERED.id, ACTOR))
      .rejects.toMatchObject({ code: 'PHYSICAL_RECEPTION_INCOMPLETE', status: 409 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//   confirmCashAndCreateParcel
// ═══════════════════════════════════════════════════════════════════════════════

describe('confirmCashAndCreateParcel — délégation à l\'autorité unique payment-cash-confirm', () => {
  const PENDING = { ...ORDER_PAID, payment_status: 'pending', payment_mode: 'cash_relais', cash_ref_code: 'CASH-1' };
  const confirmCashByReference = jest.fn();
  const triggerPurchasing = jest.fn();
  const deps = () => ({ confirmCashByReference, triggerPurchasing });
  // autoCreateParcel nominal (queue du client transactionnel)
  const parcelScript = [
    { rows: [ORDER_PAID] }, { rows: [] }, { rows: [ITEM] }, { rows: [{ max_seq: 5 }] },
    { rows: [] }, { rows: [] }, { rows: [] },
  ];

  beforeEach(() => { jest.clearAllMocks(); mockQuery = jest.fn(); });

  test('commande introuvable → 404 order_not_found, aucune délégation', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(confirmCashAndCreateParcel('KOM-INCONNU', ACTOR, deps())).rejects.toMatchObject({ status: 404, code: 'order_not_found' });
    expect(confirmCashByReference).not.toHaveBeenCalled();
  });

  test('pas cash_relais → 400, aucune délégation', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...PENDING, payment_mode: 'stripe_eur' }] });
    await expect(confirmCashAndCreateParcel('KOM-001', ACTOR, deps())).rejects.toMatchObject({ status: 400, code: 'not_cash_relais' });
    expect(confirmCashByReference).not.toHaveBeenCalled();
  });

  test('statut de paiement non confirmable (refunded/failed) → 409, aucune délégation', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...PENDING, payment_status: 'refunded' }] });
    await expect(confirmCashAndCreateParcel('KOM-001', ACTOR, deps())).rejects.toMatchObject({ status: 409, code: 'payment_status_not_confirmable' });
    expect(confirmCashByReference).not.toHaveBeenCalled();
  });

  test('référence cash absente → 409 cash_reference_missing', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...PENDING, cash_ref_code: null }] });
    await expect(confirmCashAndCreateParcel('KOM-001', ACTOR, deps())).rejects.toMatchObject({ status: 409, code: 'cash_reference_missing' });
    expect(confirmCashByReference).not.toHaveBeenCalled();
  });

  test('nominal : l\'autorité encaisse (acteur, code et purchasing transmis), PUIS le colis est créé', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [PENDING] });
    confirmCashByReference.mockResolvedValue({ status: 200, body: { message: 'ok' } });
    const client = makeClient([...parcelScript]);
    mockGetClient.mockResolvedValue(client);

    const out = await confirmCashAndCreateParcel('KOM-001', ACTOR, deps());

    expect(out.state).toBe('confirmed');
    expect(out.parcelResult.success).toBe(true);
    expect(confirmCashByReference).toHaveBeenCalledWith(expect.objectContaining({
      cashRefCode: 'CASH-1', actor: { id: ACTOR.id, role: ACTOR.role }, triggerPurchasing,
    }));
    expect(client.calls.some(c => /^COMMIT$/i.test(c.sql))).toBe(true);
    // Aucune seconde logique d'encaissement dans ce service.
    expect(client.calls.some(c => /cash_collections|payment_status\s*=\s*'paid'/i.test(c.sql))).toBe(false);
  });

  test('premier visa (202) : aucun colis créé, aucun client transactionnel ouvert', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [PENDING] });
    confirmCashByReference.mockResolvedValue({ status: 202, body: { pending_second_approval: true, code: 'X', message: 'm', required_approvals: 2 } });
    const out = await confirmCashAndCreateParcel('KOM-001', ACTOR, deps());
    expect(out.state).toBe('pending_second_approval');
    expect(out.control.required_approvals).toBe(2);
    expect(mockGetClient).not.toHaveBeenCalled();
  });

  test.each([
    [403, { error: 'Cette commande appartient à un autre relais' }, 'cash_confirmation_rejected'],
    [409, { error: 'Stock insuffisant', code: 'STOCK' }, 'STOCK'],
    [404, { error: 'Code invalide ou paiement déjà enregistré' }, 'cash_confirmation_rejected'],
  ])('refus de l\'autorité %s → propagé, aucun colis', async (status, body, code) => {
    mockQuery.mockResolvedValueOnce({ rows: [PENDING] });
    confirmCashByReference.mockResolvedValue({ status, body });
    await expect(confirmCashAndCreateParcel('KOM-001', ACTOR, deps())).rejects.toMatchObject({ status, code, message: body.error });
    expect(mockGetClient).not.toHaveBeenCalled();
  });

  test('refus sans corps explicite → message et code par défaut', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [PENDING] });
    confirmCashByReference.mockResolvedValue({ status: 500 });
    await expect(confirmCashAndCreateParcel('KOM-001', ACTOR, deps())).rejects.toMatchObject({ status: 500, code: 'cash_confirmation_rejected', message: 'Confirmation cash refusée' });
  });

  test('idempotence : déjà payé → aucune ré-encaissement, seul le colis manquant est rattrapé', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...PENDING, payment_status: 'paid' }] });
    const client = makeClient([...parcelScript]);
    mockGetClient.mockResolvedValue(client);
    const out = await confirmCashAndCreateParcel('KOM-001', ACTOR, deps());
    expect(out.state).toBe('already_confirmed');
    expect(out.parcelResult.success).toBe(true);
    expect(confirmCashByReference).not.toHaveBeenCalled();
  });

  test('rejeu avec colis déjà existant → parcel_exists, rien de dupliqué', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...PENDING, payment_status: 'paid' }] });
    mockGetClient.mockResolvedValue(makeClient([{ rows: [ORDER_PAID] }, { rows: [{ id: 'old', reference: 'PCL-2026-0001' }] }]));
    const out = await confirmCashAndCreateParcel('KOM-001', ACTOR, deps());
    expect(out.parcelResult).toMatchObject({ success: false, reason: 'parcel_exists' });
  });

  test('échec de création du colis après encaissement : l\'encaissement n\'est jamais défait, rejouable', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [PENDING] });
    confirmCashByReference.mockResolvedValue({ status: 200, body: {} });
    const client = makeClient([]);
    mockGetClient.mockResolvedValue(client);
    const boom = new Error('db down');
    const original = client.query;
    client.query = jest.fn(async (sql, ...r) => { if (/SELECT o\.id/.test(sql)) throw boom; return original(sql, ...r); });
    const out = await confirmCashAndCreateParcel('KOM-001', ACTOR, deps());
    expect(out.state).toBe('confirmed');
    expect(out.parcelResult).toEqual({ success: false, reason: 'parcel_creation_failed' });
    expect(client.released).toBe(true);
  });

  test('dépendances par défaut : autorité réelle et purchasing résolus à l\'appel', async () => {
    jest.resetModules();
    jest.doMock('../../services/payment-cash-confirm', () => ({ confirmCashByReference: jest.fn().mockResolvedValue({ status: 202, body: { pending_second_approval: true } }) }));
    jest.doMock('../../services/purchasing-trigger-service', () => ({ triggerPurchasing: jest.fn() }));
    const fresh = require('../../services/parcel-auto-create-service');
    mockQuery.mockResolvedValueOnce({ rows: [PENDING] });
    expect((await fresh.confirmCashAndCreateParcel('KOM-001', ACTOR)).state).toBe('pending_second_approval');
    jest.dontMock('../../services/payment-cash-confirm');
    jest.dontMock('../../services/purchasing-trigger-service');
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
