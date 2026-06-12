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
    status: 'open',
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
    const cart = makeCart({ status: 'open' });
    const client = mockWithTransaction([
      OK,          // BEGIN
      { rows: [cart] },  // SELECT FOR UPDATE
      OK,          // UPDATE shared_carts
      OK,          // INSERT shared_cart_events (addEvent)
      OK,          // COMMIT
    ]);

    const result = await cancelSharedCart('cart-001', 'user-001', null);

    expect(result).toMatchObject({ id: 'cart-001', status: 'open' });

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
    const cart = makeCart({ status: 'closed', contributed_kmf: 5000 });
    const client = mockWithTransaction([OK, { rows: [cart] }, OK, OK, OK]);

    await cancelSharedCart('cart-001', 'user-001', null);

    const eventPayload = client._calls[3].params[4];
    expect(eventPayload.contributed_kmf).toBe(5000);
  });

  test('panier fully_funded → cancelled', async () => {
    const cart = makeCart({ status: 'closed', contributed_kmf: 30000 });
    const client = mockWithTransaction([OK, { rows: [cart] }, OK, OK, OK]);

    await cancelSharedCart('cart-001', 'user-001', "acheteur a changé d'avis");

    const eventPayload = client._calls[3].params[4];
    expect(eventPayload.reason).toBe("acheteur a changé d'avis");
    expect(eventPayload.contributed_kmf).toBe(30000);
  });

  test('raison null → payload.reason null', async () => {
    const cart = makeCart({ status: 'open' });
    const client = mockWithTransaction([OK, { rows: [cart] }, OK, OK, OK]);

    await cancelSharedCart('cart-001', 'user-001', null);

    const eventPayload = client._calls[3].params[4];
    expect(eventPayload.reason).toBeNull();
  });
});

// ── expireOldCarts ───────────────────────────────────────────────────────────

describe('expireOldCarts — alias V4.1 vers runSharedCartStateMachineTick', () => {
  beforeEach(() => jest.clearAllMocks());

  test('aucune transition → retourne 0, aucun INSERT event', async () => {
    db.query.mockResolvedValue({ rows: [] });

    const count = await expireOldCarts();

    expect(count).toBe(0);
    const sqls = db.query.mock.calls.map(([sql]) => String(sql));
    expect(sqls.some(sql => /INSERT INTO shared_cart_events/.test(sql))).toBe(false);
    // Le tick couvre bien T1 (auto-close), T2 (awaiting), T4 (expired)
    expect(sqls.some(sql => /status = 'closed'/.test(sql))).toBe(true);
    expect(sqls.some(sql => /status = 'awaiting_choice'/.test(sql))).toBe(true);
    expect(sqls.some(sql => /status = 'expired'/.test(sql))).toBe(true);
  });

  test('2 paniers AWAITING_CHOICE dépassés → expired + INSERT event chacun', async () => {
    const expiredCarts = [
      { id: 'cart-exp-1', contributed_kmf: 10000 },
      { id: 'cart-exp-2', contributed_kmf: 0 },
    ];

    db.query.mockImplementation(async (sql) => {
      const text = String(sql);
      if (/SET status = 'expired'/.test(text)) {
        return { rows: expiredCarts };
      }
      return { rows: [] };
    });

    const count = await expireOldCarts();
    expect(count).toBe(2);

    const eventCalls = db.query.mock.calls.filter(
      ([sql]) => /INSERT INTO shared_cart_events/.test(String(sql))
    );
    expect(eventCalls).toHaveLength(2);
    eventCalls.forEach(([sql, params]) => {
      expect(sql).toMatch(/cart_expired/);
      expect(['cart-exp-1', 'cart-exp-2']).toContain(params[0]);
    });
  });
});
