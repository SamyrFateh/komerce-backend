'use strict';

/**
 * tests/unit/shared-cart-lifecycle.test.js
 *
 * Couvre cancelSharedCart + expireOldCarts — A-BE-09 (2026-05-26)
 *
 * cancelSharedCart :
 *   ✅ Panier introuvable/non autorisé       → throw 'Panier introuvable ou non autorisé'
 *   ✅ Panier au statut cancelled            → throw (statut inéligible)
 *   ✅ Panier au statut expired              → throw (statut inéligible)
 *   ✅ Panier active                         → statut → cancelled, event cart_cancelled
 *   ✅ Panier partially_funded               → statut → cancelled, event cart_cancelled
 *   ✅ Panier fully_funded                   → statut → cancelled, event cart_cancelled
 *   ✅ Raison passée → payload.reason non null
 *   ✅ Raison null → payload.reason null
 *
 * expireOldCarts :
 *   ✅ Aucun panier expiré                   → retourne 0, zéro INSERT event
 *   ✅ 2 paniers expirés                     → UPDATE + 2 INSERT events, retourne 2
 *
 * Strategy: mock db.getClient() (withTransaction) + db.query (expireOldCarts).
 * withTransaction émet BEGIN + COMMIT : les queryResponses en tiennent compte.
 * Séquence cancelSharedCart : [BEGIN, SELECT, UPDATE, addEvent INSERT, COMMIT]
 */

jest.mock('../../db', () => ({ getClient: jest.fn(), query: jest.fn() }));
jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const db = require('../../db');
const { cancelSharedCart, expireOldCarts } = require('../../services/shared-cart-engine');

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeCart(overrides = {}) {
  return {
    id: 'cart-001',
    beneficiary_user_id: 'user-001',
    status: 'active',
    contributed_kmf: 15000,
    ...overrides,
  };
}

/**
 * Monte db.getClient pour withTransaction.
 * responses = liste ordonnée des valeurs retournées par client.query().
 * Séquence standard : [BEGIN, SELECT, UPDATE, INSERT-event, COMMIT]
 */
function mockWithTransaction(responses) {
  const calls = [];
  let idx = 0;
  const client = {
    query: jest.fn(async (sql, params) => {
      calls.push({ sql, params });
      const r = responses[idx++];
      if (r instanceof Error) throw r;
      return r ?? { rows: [], rowCount: 0 };
    }),
    release: jest.fn(),
    _calls: calls,
  };
  db.getClient.mockResolvedValue(client);
  return client;
}

const OK = { rows: [], rowCount: 1 };

// ── cancelSharedCart ─────────────────────────────────────────────────────────

describe('cancelSharedCart', () => {
  beforeEach(() => jest.clearAllMocks());

  test('panier introuvable → throw', async () => {
    // BEGIN, SELECT (vide), ROLLBACK
    mockWithTransaction([OK, { rows: [] }]);

    await expect(cancelSharedCart('cart-999', 'user-001', null))
      .rejects.toThrow('Panier introuvable ou non autorisé');
  });

  test('panier au statut cancelled → throw statut inéligible', async () => {
    const cart = makeCart({ status: 'cancelled' });
    // BEGIN, SELECT, ROLLBACK
    mockWithTransaction([OK, { rows: [cart] }]);

    await expect(cancelSharedCart('cart-001', 'user-001', null))
      .rejects.toThrow(/Impossible d'annuler un panier au statut cancelled/);
  });

  test('panier au statut expired → throw statut inéligible', async () => {
    const cart = makeCart({ status: 'expired' });
    mockWithTransaction([OK, { rows: [cart] }]);

    await expect(cancelSharedCart('cart-001', 'user-001', null))
      .rejects.toThrow(/Impossible d'annuler un panier au statut expired/);
  });

  test('panier active → cancelled + event cart_cancelled', async () => {
    const cart = makeCart({ status: 'active' });
    const client = mockWithTransaction([
      OK,          // BEGIN
      { rows: [cart] },  // SELECT FOR UPDATE
      OK,          // UPDATE shared_carts
      OK,          // INSERT shared_cart_events (addEvent)
      OK,          // COMMIT
    ]);

    const result = await cancelSharedCart('cart-001', 'user-001', null);

    expect(result).toMatchObject({ id: 'cart-001', status: 'active' });

    // call[2] = UPDATE
    const updateCall = client._calls[2];
    expect(updateCall.sql).toMatch(/UPDATE shared_carts/);
    expect(updateCall.sql).toMatch(/status = 'cancelled'/);

    // call[3] = addEvent INSERT ($2 = eventType, $5 = payload)
    const eventCall = client._calls[3];
    expect(eventCall.sql).toMatch(/INSERT INTO shared_cart_events/);
    expect(eventCall.params[1]).toBe('cart_cancelled');
  });

  test('panier partially_funded → cancelled, contributed_kmf dans payload', async () => {
    const cart = makeCart({ status: 'partially_funded', contributed_kmf: 5000 });
    const client = mockWithTransaction([OK, { rows: [cart] }, OK, OK, OK]);

    await cancelSharedCart('cart-001', 'user-001', null);

    const eventPayload = client._calls[3].params[4];
    expect(eventPayload.contributed_kmf).toBe(5000);
  });

  test('panier fully_funded → cancelled', async () => {
    const cart = makeCart({ status: 'fully_funded', contributed_kmf: 30000 });
    const client = mockWithTransaction([OK, { rows: [cart] }, OK, OK, OK]);

    await cancelSharedCart('cart-001', 'user-001', "acheteur a changé d'avis");

    const eventPayload = client._calls[3].params[4];
    expect(eventPayload.reason).toBe("acheteur a changé d'avis");
    expect(eventPayload.contributed_kmf).toBe(30000);
  });

  test('raison null → payload.reason null', async () => {
    const cart = makeCart({ status: 'active' });
    const client = mockWithTransaction([OK, { rows: [cart] }, OK, OK, OK]);

    await cancelSharedCart('cart-001', 'user-001', null);

    const eventPayload = client._calls[3].params[4];
    expect(eventPayload.reason).toBeNull();
  });
});

// ── expireOldCarts ───────────────────────────────────────────────────────────

describe('expireOldCarts', () => {
  beforeEach(() => jest.clearAllMocks());

  test('aucun panier expiré → retourne 0, zéro INSERT event', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const count = await expireOldCarts();

    expect(count).toBe(0);
    expect(db.query).toHaveBeenCalledTimes(1);
    const [sql] = db.query.mock.calls[0];
    expect(sql).toMatch(/UPDATE shared_carts/);
    expect(sql).toMatch(/status = 'expired'/);
  });

  test('2 paniers expirés → retourne 2, INSERT event pour chacun', async () => {
    const expiredCarts = [
      { id: 'cart-exp-1', beneficiary_user_id: 'u1', contributed_kmf: 10000 },
      { id: 'cart-exp-2', beneficiary_user_id: 'u2', contributed_kmf: 0 },
    ];

    db.query
      .mockResolvedValueOnce({ rows: expiredCarts }) // UPDATE RETURNING
      .mockResolvedValue({ rows: [] });              // INSERT events ×2

    const count = await expireOldCarts();

    expect(count).toBe(2);
    // 1 UPDATE + 2 INSERT = 3 appels total
    expect(db.query).toHaveBeenCalledTimes(3);

    // Vérifier les deux INSERT events
    const insertCalls = db.query.mock.calls.slice(1);
    insertCalls.forEach(([sql, params]) => {
      expect(sql).toMatch(/INSERT INTO shared_cart_events/);
      expect(sql).toMatch(/cart_expired/);
    });

    // cart-exp-1 : contributed_kmf = 10000
    expect(db.query.mock.calls[1][1][0]).toBe('cart-exp-1');
    expect(db.query.mock.calls[1][1][1]).toMatchObject({ contributed_kmf: 10000 });

    // cart-exp-2 : contributed_kmf = 0
    expect(db.query.mock.calls[2][1][0]).toBe('cart-exp-2');
    expect(db.query.mock.calls[2][1][1]).toMatchObject({ contributed_kmf: 0 });
  });
});
