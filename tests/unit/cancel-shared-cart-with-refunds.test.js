'use strict';

/**
 * tests/unit/cancel-shared-cart-with-refunds.test.js
 *
 * Couvre cancelSharedCartWithRefunds (GAP-A / Phase A) :
 *
 *   ✅ Panier introuvable/non autorisé        → throw
 *   ✅ Panier au statut inéligible (cancelled) → throw
 *   ✅ 2 contributions Stripe `paid`           → 2 stripe.refunds.create,
 *                                                 idempotency key stable,
 *                                                 contributions → 'refunded'
 *   ✅ Idempotence retry — idempotencyKey identique pour un même couple
 *      (cartId, contributionId), pas de double appel logique
 *   ✅ Contribution `cash` paid                → routée file remboursement
 *      manuel (status='failed', metadata.requires_manual_refund=true),
 *      pas d'appel Stripe
 *   ✅ Échec API Stripe                        → routée file remboursement
 *      manuel, n'interrompt pas le traitement des autres contributions
 *   ✅ Panier sans contribution payée          → cart cancelled, refunds: []
 */

const { makeClient, expectTransactionCommitted, expectTransactionRolledBack } = require('../integration/test-harness/mock-db');

const mockRefundsCreate = jest.fn();

jest.mock('../../db', () => {
  const getClient = jest.fn();
  return {
    getClient,
    query: jest.fn(),
    // P5-N3 : primitive partagée, calquée sur l'implémentation réelle (db.js).
    withTransaction: async (callback) => {
      const client = await getClient();
      try {
        await client.query('BEGIN');
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
  };
});
jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));
jest.mock('../../services/whatsapp-meta', () => ({
  sendTemplateWhatsApp: jest.fn().mockResolvedValue({ success: true, skipped: false }),
}));
jest.mock('stripe', () => {
  return jest.fn(() => ({
    refunds: { create: mockRefundsCreate },
  }));
});

const db = require('../../db');
const { cancelSharedCartWithRefunds, refundOneContribution } = require('../../services/cancel-shared-cart-with-refunds');

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeCart(overrides = {}) {
  return {
    id: 'cart-001',
    beneficiary_user_id: 'user-001',
    status: 'closed',
    title: 'Anniversaire Aicha',
    contributed_kmf: 30000,
    total_kmf_snapshot: 30000,
    ...overrides,
  };
}

function makeContribution(overrides = {}) {
  return {
    id: 'contrib-001',
    shared_cart_id: 'cart-001',
    contributor_name: 'Ali Said',
    contributor_phone: '+33699000001',
    amount_kmf: 15000,
    amount_paid: 30,
    currency_paid: 'EUR',
    status: 'paid',
    payment_method: 'stripe',
    stripe_payment_intent_id: 'pi_test_001',
    metadata: {},
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════
// Validation
// ═══════════════════════════════════════════════════════════════════════════

describe('cancelSharedCartWithRefunds — validation', () => {
  test('panier introuvable/non autorisé → throw', async () => {
    const client = makeClient([
      { rows: [] }, // SELECT FOR UPDATE → vide
    ]);
    db.getClient.mockResolvedValueOnce(client);

    await expect(cancelSharedCartWithRefunds('cart-999', 'user-001', null))
      .rejects.toThrow('Panier introuvable ou non autorisé');
    expectTransactionRolledBack(client);
  });

  test('panier au statut cancelled → throw (statut inéligible)', async () => {
    const client = makeClient([
      { rows: [makeCart({ status: 'cancelled' })] },
    ]);
    db.getClient.mockResolvedValueOnce(client);

    await expect(cancelSharedCartWithRefunds('cart-001', 'user-001', null))
      .rejects.toThrow(/Impossible d'annuler/);
    expectTransactionRolledBack(client);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Remboursement automatique Stripe
// ═══════════════════════════════════════════════════════════════════════════

describe('cancelSharedCartWithRefunds — remboursement Stripe', () => {
  test('2 contributions paid Stripe → 2 refunds.create, idempotency key stable, status=refunded', async () => {
    const cart = makeCart();
    const contribA = makeContribution({ id: 'contrib-A', stripe_payment_intent_id: 'pi_aaa' });
    const contribB = makeContribution({ id: 'contrib-B', stripe_payment_intent_id: 'pi_bbb', contributor_phone: '+33699000002' });

    const client = makeClient([
      { rows: [cart] },                  // SELECT cart FOR UPDATE
      { rows: [contribA, contribB] },    // SELECT contributions paid FOR UPDATE
      { rowCount: 1 },                    // UPDATE shared_carts → cancelled
      { rows: [] },                       // INSERT event cart_cancelled
    ]);
    db.getClient.mockResolvedValueOnce(client);

    mockRefundsCreate
      .mockResolvedValueOnce({ id: 're_aaa', status: 'succeeded' })
      .mockResolvedValueOnce({ id: 're_bbb', status: 'succeeded' });

    // refundOneContribution fait des appels db.query() directs (hors transaction) :
    // UPDATE contribution → refunded, puis INSERT refunds (trace comptable,
    // doctrine "refund_confirmed → ligne refunds 'completed'"), puis INSERT event.
    db.query
      .mockResolvedValueOnce({ rows: [{ ...contribA, status: 'refunded' }] }) // UPDATE contribA → refunded
      .mockResolvedValueOnce({ rows: [{ id: 'refund-row-A' }] })                // INSERT refunds A
      .mockResolvedValueOnce({ rows: [] })                                     // INSERT event contribution_refunded A
      .mockResolvedValueOnce({ rows: [{ ...contribB, status: 'refunded' }] }) // UPDATE contribB → refunded
      .mockResolvedValueOnce({ rows: [{ id: 'refund-row-B' }] })                // INSERT refunds B
      .mockResolvedValueOnce({ rows: [] });                                    // INSERT event contribution_refunded B

    const result = await cancelSharedCartWithRefunds('cart-001', 'user-001', 'changement de plan');

    expect(result.cart.status).toBe('cancelled');
    expect(result.refunds).toHaveLength(2);
    expect(result.refunds.every(r => r.status === 'refunded')).toBe(true);

    expectTransactionCommitted(client);

    expect(mockRefundsCreate).toHaveBeenCalledTimes(2);
    expect(mockRefundsCreate).toHaveBeenNthCalledWith(
      1,
      { payment_intent: 'pi_aaa' },
      { idempotencyKey: 'shared_cart_refund_cart-001_contrib-A' }
    );
    expect(mockRefundsCreate).toHaveBeenNthCalledWith(
      2,
      { payment_intent: 'pi_bbb' },
      { idempotencyKey: 'shared_cart_refund_cart-001_contrib-B' }
    );

    // L'UPDATE de chaque contribution doit poser status='refunded'
    const updateCalls = db.query.mock.calls.filter(([sql]) =>
      /UPDATE shared_cart_contributions/.test(sql) && /status = 'refunded'/.test(sql));
    expect(updateCalls).toHaveLength(2);
  });

  test('idempotency key stable pour un même couple (cartId, contributionId) sur retry', async () => {
    const cart = makeCart();
    const contrib = makeContribution({ id: 'contrib-A', stripe_payment_intent_id: 'pi_aaa' });

    mockRefundsCreate.mockResolvedValue({ id: 're_aaa', status: 'succeeded' });
    db.query.mockResolvedValue({ rows: [{ ...contrib, status: 'refunded' }] });

    await refundOneContribution(cart, contrib);
    await refundOneContribution(cart, contrib); // retry (ex: tick de rattrapage)

    expect(mockRefundsCreate).toHaveBeenNthCalledWith(
      1, { payment_intent: 'pi_aaa' }, { idempotencyKey: 'shared_cart_refund_cart-001_contrib-A' }
    );
    expect(mockRefundsCreate).toHaveBeenNthCalledWith(
      2, { payment_intent: 'pi_aaa' }, { idempotencyKey: 'shared_cart_refund_cart-001_contrib-A' }
    );
    // Même clé sur les deux appels → Stripe garantit la non-duplication côté serveur
    const [, opts1] = mockRefundsCreate.mock.calls[0];
    const [, opts2] = mockRefundsCreate.mock.calls[1];
    expect(opts1.idempotencyKey).toBe(opts2.idempotencyKey);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Contributions cash → file de remboursement manuel
// ═══════════════════════════════════════════════════════════════════════════

describe('cancelSharedCartWithRefunds — contribution cash', () => {
  test('contribution cash paid → file manuelle, pas d\'appel Stripe', async () => {
    const cart = makeCart();
    const cashContrib = makeContribution({
      id: 'contrib-cash', payment_method: 'cash', stripe_payment_intent_id: null,
    });

    const client = makeClient([
      { rows: [cart] },
      { rows: [cashContrib] },
      { rowCount: 1 },
      { rows: [] },
    ]);
    db.getClient.mockResolvedValueOnce(client);

    db.query
      .mockResolvedValueOnce({ rows: [{ ...cashContrib, status: 'failed' }] }) // UPDATE → failed/manual
      .mockResolvedValueOnce({ rows: [] });                                     // INSERT event

    const result = await cancelSharedCartWithRefunds('cart-001', 'user-001', null);

    expect(result.refunds).toHaveLength(1);
    expect(result.refunds[0].status).toBe('manual_refund_queue');
    expect(mockRefundsCreate).not.toHaveBeenCalled();

    const updateCall = db.query.mock.calls.find(([sql]) => /UPDATE shared_cart_contributions/.test(sql));
    expect(updateCall[0]).toMatch(/status = 'failed'/);
    const metaPayload = JSON.parse(updateCall[1][1]);
    expect(metaPayload.requires_manual_refund).toBe(true);
    expect(metaPayload.cancellation_refund).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Échec API Stripe → file manuelle, sans bloquer l'annulation
// ═══════════════════════════════════════════════════════════════════════════

describe('cancelSharedCartWithRefunds — échec Stripe', () => {
  test('stripe.refunds.create rejette → routé en file manuelle, traitement continue', async () => {
    const cart = makeCart();
    const contrib = makeContribution({ id: 'contrib-fail', stripe_payment_intent_id: 'pi_fail' });

    const client = makeClient([
      { rows: [cart] },
      { rows: [contrib] },
      { rowCount: 1 },
      { rows: [] },
    ]);
    db.getClient.mockResolvedValueOnce(client);

    mockRefundsCreate.mockRejectedValueOnce(new Error('stripe_unreachable'));
    db.query
      .mockResolvedValueOnce({ rows: [{ ...contrib, status: 'failed' }] }) // UPDATE → manual queue
      .mockResolvedValueOnce({ rows: [] });                                 // INSERT event

    const result = await cancelSharedCartWithRefunds('cart-001', 'user-001', null);

    expect(result.cart.status).toBe('cancelled');
    expect(result.refunds[0].status).toBe('manual_refund_queue');
    expect(result.refunds[0].reason).toBe('stripe_refund_api_error');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Aucune contribution payée
// ═══════════════════════════════════════════════════════════════════════════

describe('cancelSharedCartWithRefunds — aucune contribution payée', () => {
  test('cart cancelled, refunds vide, aucun appel Stripe', async () => {
    const cart = makeCart({ contributed_kmf: 0 });
    const client = makeClient([
      { rows: [cart] },
      { rows: [] },     // aucune contribution paid
      { rowCount: 1 },
      { rows: [] },
    ]);
    db.getClient.mockResolvedValueOnce(client);

    const result = await cancelSharedCartWithRefunds('cart-001', 'user-001', null);

    expect(result.cart.status).toBe('cancelled');
    expect(result.refunds).toEqual([]);
    expect(mockRefundsCreate).not.toHaveBeenCalled();
  });
});
