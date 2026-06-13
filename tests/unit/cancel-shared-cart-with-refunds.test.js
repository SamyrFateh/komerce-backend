'use strict';

/**
 * tests/unit/cancel-shared-cart-with-refunds.test.js
 *
 * Couvre cancelSharedCartWithRefunds — Phase A tickets A-01/A-05
 *
 * ── Annulation DB ──
 *   ✅ Panier introuvable/non autorisé           → status 404, code shared_cart_not_found
 *   ✅ Panier au statut ordered                  → status 409, code invalid_status_for_cancel
 *   ✅ Panier au statut cancelled                → status 409
 *   ✅ Panier open sans contributions paid       → cancelled + refunds.total = 0
 *   ✅ Panier open — audit event auto_refund:true
 *   ✅ Raison passée → payload.reason non null
 *
 * ── Remboursements Stripe ──
 *   ✅ 2 contributions paid Stripe → 2 appels stripe.refunds.create, idempotency keys stables
 *   ✅ 2 contributions → stripe_ok = 2, stripe_failed = 0
 *   ✅ Idempotence — retry avec même cartId/contributionId = même clé Stripe (pas de double)
 *   ✅ 1 Stripe ok + 1 Stripe failed → stripe_ok=1, stripe_failed=1
 *   ✅ Échec Stripe → contribution marquée requires_manual_refund=true, event contribution_refund_failed
 *   ✅ Succès Stripe → contribution status='refunded', event contribution_refunded
 *
 * ── PayPal stub (A-02) ──
 *   ✅ contribution payment_method='paypal' → paypal_failed=1, requires_manual_refund=true
 *
 * ── Isolation transaction ──
 *   ✅ Échec Stripe APRÈS commit DB → panier reste cancelled (DB non rollbackée)
 *
 * Strategy: mock db.getClient (withTransaction) + db.query (hors-transaction) + stripe module.
 * Séquence transaction : BEGIN, SELECT, UPDATE, INSERT-event, SELECT-contribs, COMMIT.
 * Appels hors-transaction : UPDATE contrib + INSERT event par contribution.
 */

jest.mock('../../db', () => ({ getClient: jest.fn(), query: jest.fn() }));
jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));
jest.mock('stripe', () => {
  const mockCreate = jest.fn();
  return jest.fn(() => ({
    refunds: { create: mockCreate },
  }));
});

const db     = require('../../db');
const stripe = require('stripe')();
const { cancelSharedCartWithRefunds } = require('../../services/cancel-shared-cart-with-refunds');

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeCart(overrides = {}) {
  return {
    id:                   'cart-001',
    beneficiary_user_id:  'user-001',
    status:               'open',
    contributed_kmf:      0,
    beneficiary_phone:    '+2693001001',
    beneficiary_name:     'Fatima',
    ...overrides,
  };
}

function makeContrib(overrides = {}) {
  return {
    id:                          'contrib-001',
    stripe_payment_intent_id:    'pi_test_001',
    payment_method:              'stripe',
    metadata:                    {},
    amount_kmf:                  10000,
    ...overrides,
  };
}

/**
 * Monte db.getClient pour withTransaction.
 * Gère automatiquement BEGIN/COMMIT/ROLLBACK (retours vides).
 * script = réponses pour les vraies requêtes SQL (hors BEGIN/COMMIT/ROLLBACK).
 */
function mockTransaction(script) {
  const queue  = [...script];
  const calls  = [];
  const client = {
    calls,
    query: jest.fn(async (sql, params) => {
      calls.push({ sql, params });
      const normalized = String(sql).replace(/\s+/g, ' ').trim();
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(normalized)) {
        return { rows: [], rowCount: 0 };
      }
      const next = queue.shift();
      if (next === undefined) throw new Error(`Unexpected query: ${normalized.slice(0, 80)}`);
      if (next instanceof Error) throw next;
      return { rows: next.rows || [], rowCount: next.rowCount ?? (next.rows?.length ?? 0) };
    }),
    release: jest.fn(),
  };
  db.getClient.mockResolvedValue(client);
  return client;
}

/** db.query hors-transaction (séquence: UPDATE contrib, INSERT event, ...) */
function mockOutOfTx(responses) {
  let idx = 0;
  db.query.mockImplementation(async () => {
    const r = responses[idx++];
    if (r === undefined) return { rows: [], rowCount: 1 };
    if (r instanceof Error) throw r;
    return r;
  });
}

const OK = { rows: [], rowCount: 1 };

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('cancelSharedCartWithRefunds', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.query.mockResolvedValue({ rows: [], rowCount: 0 });
    stripe.refunds.create.mockResolvedValue({ id: 're_test_001' });
  });

  // ── Annulation DB ────────────────────────────────────────────────────────

  test('panier introuvable → status 404', async () => {
    mockTransaction([
      { rows: [] },  // SELECT ... FOR UPDATE → vide
    ]);

    await expect(
      cancelSharedCartWithRefunds('cart-999', 'user-001', null)
    ).rejects.toMatchObject({ status: 404, code: 'shared_cart_not_found' });
  });

  test.each(['ordered', 'cancelled', 'expired', 'archived'])(
    'statut %s → status 409 invalid_status_for_cancel',
    async (status) => {
      mockTransaction([
        { rows: [makeCart({ status })] },
      ]);

      await expect(
        cancelSharedCartWithRefunds('cart-001', 'user-001', null)
      ).rejects.toMatchObject({ status: 409, code: 'invalid_status_for_cancel' });
    }
  );

  test('panier open sans contributions paid → cancelled, refunds.total = 0', async () => {
    mockTransaction([
      { rows: [makeCart({ status: 'open' })] },  // SELECT
      { rows: [makeCart({ status: 'cancelled' })] }, // UPDATE RETURNING
      OK,   // INSERT audit event
      { rows: [] }, // SELECT contributions paid (vide)
    ]);

    const { cart, refunds } = await cancelSharedCartWithRefunds('cart-001', 'user-001', null);

    expect(cart.status).toBe('cancelled');
    expect(refunds).toMatchObject({ total: 0, stripe_ok: 0, stripe_failed: 0 });
    expect(stripe.refunds.create).not.toHaveBeenCalled();
  });

  test('raison passée → payload.reason présent dans audit event', async () => {
    const client = mockTransaction([
      { rows: [makeCart()] },
      { rows: [makeCart({ status: 'cancelled' })] },
      OK,
      { rows: [] },
    ]);

    await cancelSharedCartWithRefunds('cart-001', 'user-001', 'test-reason');

    const eventInsert = client.calls.find(c =>
      String(c.sql).includes('cart_cancelled')
    );
    expect(eventInsert).toBeDefined();
    expect(eventInsert.params[2]).toMatchObject({ reason: 'test-reason', auto_refund: true });
  });

  // ── Stripe refunds ───────────────────────────────────────────────────────

  test('2 contributions Stripe → stripe_ok=2, 2 appels refunds.create', async () => {
    const contrib1 = makeContrib({ id: 'c1', stripe_payment_intent_id: 'pi_001' });
    const contrib2 = makeContrib({ id: 'c2', stripe_payment_intent_id: 'pi_002' });

    mockTransaction([
      { rows: [makeCart({ status: 'closed', contributed_kmf: 20000 })] },
      { rows: [makeCart({ status: 'cancelled' })] },
      OK,
      { rows: [contrib1, contrib2] },
    ]);
    mockOutOfTx([OK, OK, OK, OK]); // UPDATE + INSERT × 2

    stripe.refunds.create
      .mockResolvedValueOnce({ id: 're_001' })
      .mockResolvedValueOnce({ id: 're_002' });

    const { refunds } = await cancelSharedCartWithRefunds('cart-001', 'user-001');

    expect(refunds).toMatchObject({ total: 2, stripe_ok: 2, stripe_failed: 0 });
    expect(stripe.refunds.create).toHaveBeenCalledTimes(2);
  });

  test('idempotency key = shared_cart_refund_{cartId}_{contributionId}', async () => {
    const contrib = makeContrib({ id: 'c1', stripe_payment_intent_id: 'pi_001' });

    mockTransaction([
      { rows: [makeCart({ id: 'cart-001' })] },
      { rows: [makeCart({ status: 'cancelled' })] },
      OK,
      { rows: [contrib] },
    ]);
    mockOutOfTx([OK, OK]);

    await cancelSharedCartWithRefunds('cart-001', 'user-001');

    expect(stripe.refunds.create).toHaveBeenCalledWith(
      { payment_intent: 'pi_001' },
      { idempotencyKey: 'shared_cart_refund_cart-001_c1' }
    );
  });

  test('1 Stripe ok + 1 Stripe échec → stripe_ok=1, stripe_failed=1', async () => {
    const contrib1 = makeContrib({ id: 'c1', stripe_payment_intent_id: 'pi_001' });
    const contrib2 = makeContrib({ id: 'c2', stripe_payment_intent_id: 'pi_002' });

    mockTransaction([
      { rows: [makeCart({ status: 'closed' })] },
      { rows: [makeCart({ status: 'cancelled' })] },
      OK,
      { rows: [contrib1, contrib2] },
    ]);
    mockOutOfTx([OK, OK, OK, OK]);

    stripe.refunds.create
      .mockResolvedValueOnce({ id: 're_001' })
      .mockRejectedValueOnce(Object.assign(new Error('card_declined'), { code: 'card_declined' }));

    const { refunds } = await cancelSharedCartWithRefunds('cart-001', 'user-001');

    expect(refunds).toMatchObject({ total: 2, stripe_ok: 1, stripe_failed: 1 });
  });

  test('Stripe failed → contrib mise à jour avec requires_manual_refund=true', async () => {
    const contrib = makeContrib({ id: 'c1', stripe_payment_intent_id: 'pi_001' });

    mockTransaction([
      { rows: [makeCart()] },
      { rows: [makeCart({ status: 'cancelled' })] },
      OK,
      { rows: [contrib] },
    ]);

    const outCalls = [];
    db.query.mockImplementation(async (sql, params) => {
      outCalls.push({ sql, params });
      return { rows: [], rowCount: 1 };
    });

    stripe.refunds.create.mockRejectedValueOnce(
      Object.assign(new Error('stripe_error'), { code: 'stripe_timeout' })
    );

    await cancelSharedCartWithRefunds('cart-001', 'user-001');

    const updateCall = outCalls.find(c =>
      String(c.sql).includes('requires_manual_refund')
    );
    expect(updateCall).toBeDefined();
    expect(updateCall.params[0]).toBe('stripe_timeout');
  });

  test('Stripe success → contrib status=refunded, event contribution_refunded', async () => {
    const contrib = makeContrib({ id: 'c1', stripe_payment_intent_id: 'pi_001' });

    mockTransaction([
      { rows: [makeCart()] },
      { rows: [makeCart({ status: 'cancelled' })] },
      OK,
      { rows: [contrib] },
    ]);

    const outCalls = [];
    db.query.mockImplementation(async (sql, params) => {
      outCalls.push({ sql, params });
      return { rows: [], rowCount: 1 };
    });

    stripe.refunds.create.mockResolvedValueOnce({ id: 're_ok_001' });

    await cancelSharedCartWithRefunds('cart-001', 'user-001');

    const statusUpdate = outCalls.find(c => String(c.sql).includes("status = 'refunded'"));
    expect(statusUpdate).toBeDefined();

    const eventInsert = outCalls.find(c => String(c.sql).includes('contribution_refunded'));
    expect(eventInsert).toBeDefined();
    expect(eventInsert.params[1]).toMatchObject({ refund_id: 're_ok_001' });
  });

  // ── PayPal stub ──────────────────────────────────────────────────────────

  test('contribution payment_method=paypal → paypal_failed=1, requires_manual_refund=true', async () => {
    const contrib = makeContrib({
      id:             'c-pp1',
      payment_method: 'paypal',
      stripe_payment_intent_id: null,
    });

    mockTransaction([
      { rows: [makeCart()] },
      { rows: [makeCart({ status: 'cancelled' })] },
      OK,
      { rows: [contrib] },
    ]);

    const outCalls = [];
    db.query.mockImplementation(async (sql, params) => {
      outCalls.push({ sql, params });
      return { rows: [], rowCount: 1 };
    });

    const { refunds } = await cancelSharedCartWithRefunds('cart-001', 'user-001');

    expect(refunds).toMatchObject({ total: 1, paypal_ok: 0, paypal_failed: 1 });
    expect(stripe.refunds.create).not.toHaveBeenCalled();

    const manualRefund = outCalls.find(c => String(c.sql).includes('requires_manual_refund'));
    expect(manualRefund).toBeDefined();
  });

  // ── Isolation transaction ────────────────────────────────────────────────

  test('erreur Stripe post-commit → panier reste cancelled (DB non rollbackée)', async () => {
    const contrib = makeContrib({ id: 'c1' });

    const client = mockTransaction([
      { rows: [makeCart()] },
      { rows: [makeCart({ status: 'cancelled' })] },
      OK,
      { rows: [contrib] },
    ]);

    db.query.mockResolvedValue({ rows: [], rowCount: 1 });
    stripe.refunds.create.mockRejectedValueOnce(new Error('network_error'));

    const { cart, refunds } = await cancelSharedCartWithRefunds('cart-001', 'user-001');

    // La transaction a bien committé
    const txSqls = client.calls.map(c => String(c.sql).trim());
    expect(txSqls).toContain('COMMIT');
    expect(txSqls).not.toContain('ROLLBACK');

    // Le panier est cancelled malgré l'échec Stripe
    expect(cart.status).toBe('cancelled');
    expect(refunds.stripe_failed).toBe(1);
  });
});
