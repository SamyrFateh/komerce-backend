'use strict';

/**
 * tests/unit/shared-cart-financial-guard.test.js
 *
 * Couvre confirmContributionFromStripeSafely :
 *   ✅ Session inconnue          → null (no-op)
 *   ✅ Contribution déjà paid    → null (idempotence)
 *   ✅ Contribution status inattendu (ex: refunded) → null + event
 *   ✅ payment_status !== 'paid' → null + event
 *   ✅ Panier non ouvert         → paid_not_counted (cart_not_open_for_contribution)
 *   ✅ Fenêtre expirée           → paid_not_counted (cart_payment_window_expired)
 *   ✅ Total panier invalide     → paid_not_counted (invalid_cart_total)
 *   ✅ Montant > remaining       → paid_not_counted (amount_exceeds_remaining_at_webhook)
 *   ✅ Contribution normale      → paid + panier partially_funded
 *   ✅ Dernière contribution     → paid + panier fully_funded + event cart_fully_funded
 *
 * Strategy: mock db.getClient() via makeClient() du test-harness.
 */

const { makeClient, expectTransactionCommitted, expectTransactionRolledBack } = require('../integration/test-harness/mock-db');

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

const db = require('../../db');
const { confirmContributionFromStripeSafely } = require('../../services/shared-cart-financial-guard');

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeContribution(overrides = {}) {
  return {
    id: 'contrib-001',
    shared_cart_id: 'cart-001',
    stripe_session_id: 'cs_test_001',
    status: 'pending',
    amount_kmf: 10000,
    amount_paid: 20,
    currency_paid: 'EUR',
    fx_rate_used: 500,
    ...overrides,
  };
}

function makeCart(overrides = {}) {
  return {
    id: 'cart-001',
    status: 'closed_for_settlement',
    total_kmf_snapshot: 30000,
    contributed_kmf: 10000,
    remaining_kmf: 20000,
    payment_window_ends_at: new Date(Date.now() + 86400000).toISOString(), // +1 jour
    ...overrides,
  };
}

const SESSION_PAID = {
  id: 'cs_test_001',
  payment_status: 'paid',
  payment_intent: 'pi_test_001',
};

beforeEach(() => {
  jest.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════════
// Cas d'annulation précoce (avant SELECT panier)
// ═══════════════════════════════════════════════════════════════════════════════

describe('session inconnue', () => {
  test('retourne null sans écriture', async () => {
    const client = makeClient([
      { rows: [] }, // SELECT contributions → vide
    ]);
    db.getClient.mockResolvedValueOnce(client);

    const result = await confirmContributionFromStripeSafely(SESSION_PAID);
    expect(result).toBeNull();
    expectTransactionCommitted(client);
    // Aucune écriture (FOR UPDATE ne doit pas matcher)
    const writes = client.calls.filter(c => /^\s*(UPDATE|INSERT)\s/i.test(c.sql));
    expect(writes).toHaveLength(0);
  });
});

describe('idempotence — contribution déjà paid', () => {
  test('retourne null sans double credit', async () => {
    const client = makeClient([
      { rows: [makeContribution({ status: 'paid' })] }, // SELECT contributions
    ]);
    db.getClient.mockResolvedValueOnce(client);

    const result = await confirmContributionFromStripeSafely(SESSION_PAID);
    expect(result).toBeNull();
    expectTransactionCommitted(client);
    const writes = client.calls.filter(c => /^\s*(UPDATE|INSERT)\s/i.test(c.sql));
    expect(writes).toHaveLength(0);
  });
});

describe('contribution dans un status inattendu (ex: refunded)', () => {
  test('retourne null + insère un event stripe_unexpected_status', async () => {
    const client = makeClient([
      { rows: [makeContribution({ status: 'refunded' })] }, // SELECT contributions
      { rows: [] },                                          // INSERT event
    ]);
    db.getClient.mockResolvedValueOnce(client);

    const result = await confirmContributionFromStripeSafely(SESSION_PAID);
    expect(result).toBeNull();
    expectTransactionCommitted(client);
    const insertEvent = client.calls.find(c =>
      /INSERT INTO shared_cart_events/.test(c.sql) &&
      JSON.stringify(c.params).includes('contribution_stripe_unexpected_status')
    );
    expect(insertEvent).toBeDefined();
  });
});

describe('payment_status Stripe !== paid', () => {
  test('retourne null + insère un event stripe_pending', async () => {
    const session = { ...SESSION_PAID, payment_status: 'unpaid' };
    const client = makeClient([
      { rows: [makeContribution()] }, // SELECT contributions
      { rows: [] },                   // INSERT event
    ]);
    db.getClient.mockResolvedValueOnce(client);

    const result = await confirmContributionFromStripeSafely(session);
    expect(result).toBeNull();
    const insertEvent = client.calls.find(c =>
      /INSERT INTO shared_cart_events/.test(c.sql) &&
      JSON.stringify(c.params).includes('contribution_stripe_pending')
    );
    expect(insertEvent).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Cas paid_not_counted
// ═══════════════════════════════════════════════════════════════════════════════

describe('paid_not_counted — panier non ouvert', () => {
  test('fully_funded → paid_not_counted + flag requires_manual_refund', async () => {
    const client = makeClient([
      { rows: [makeContribution()] },               // SELECT contributions
      { rows: [makeCart({ status: 'ordered', remaining_kmf: 0 })] }, // SELECT panier
      { rows: [] },                                  // UPDATE contribution → failed
      { rows: [] },                                  // INSERT event paid_not_counted
    ]);
    db.getClient.mockResolvedValueOnce(client);

    const result = await confirmContributionFromStripeSafely(SESSION_PAID);
    expect(result).toBeNull();
    expectTransactionCommitted(client);

    const updateFailed = client.calls.find(c =>
      /UPDATE shared_cart_contributions/.test(c.sql) &&
      c.sql.includes("status = 'failed'")
    );
    expect(updateFailed).toBeDefined();
    // Le payload doit contenir requires_manual_refund=true
    const payload = JSON.parse(updateFailed.params[1]);
    expect(payload.requires_manual_refund).toBe(true);
    expect(payload.reason).toBe('cart_not_open_for_contribution');
  });
});

describe('paid_not_counted — panier expiré (statut hors settlement)', () => {
  test('retourne null + marque failed requires_manual_refund', async () => {
    // En V4, il n'y a plus de payment_window. Un panier hors settlement
    // (ex: statut 'ordered') → cart_not_open_for_contribution.
    const client = makeClient([
      { rows: [makeContribution()] },
      { rows: [makeCart({ status: 'ordered' })] },
      { rows: [] }, // UPDATE failed
      { rows: [] }, // INSERT event
    ]);
    db.getClient.mockResolvedValueOnce(client);

    const result = await confirmContributionFromStripeSafely(SESSION_PAID);
    expect(result).toBeNull();

    const updateFailed = client.calls.find(c =>
      /UPDATE shared_cart_contributions/.test(c.sql) && c.sql.includes("status = 'failed'")
    );
    const payload = JSON.parse(updateFailed.params[1]);
    expect(payload.reason).toBe('cart_not_open_for_contribution');
    expect(payload.requires_manual_refund).toBe(true);
  });
});

describe('paid_not_counted — total panier invalide (0)', () => {
  test('retourne null + marque failed', async () => {
    const client = makeClient([
      { rows: [makeContribution()] },
      { rows: [makeCart({ total_kmf_snapshot: 0, remaining_kmf: 0 })] },
      { rows: [] },
      { rows: [] },
    ]);
    db.getClient.mockResolvedValueOnce(client);

    const result = await confirmContributionFromStripeSafely(SESSION_PAID);
    expect(result).toBeNull();

    const updateFailed = client.calls.find(c =>
      /UPDATE shared_cart_contributions/.test(c.sql) && c.sql.includes("status = 'failed'")
    );
    const payload = JSON.parse(updateFailed.params[1]);
    expect(payload.reason).toBe('invalid_cart_total');
  });
});

describe('paid_not_counted — montant dépasse remaining au moment du webhook', () => {
  test('retourne null + payload contient attempted vs allowed', async () => {
    // remaining = 5000, contribution = 10000
    const client = makeClient([
      { rows: [makeContribution({ amount_kmf: 10000 })] },
      { rows: [makeCart({ remaining_kmf: 5000, contributed_kmf: 25000 })] },
      { rows: [] },
      { rows: [] },
    ]);
    db.getClient.mockResolvedValueOnce(client);

    const result = await confirmContributionFromStripeSafely(SESSION_PAID);
    expect(result).toBeNull();

    const updateFailed = client.calls.find(c =>
      /UPDATE shared_cart_contributions/.test(c.sql) && c.sql.includes("status = 'failed'")
    );
    const payload = JSON.parse(updateFailed.params[1]);
    expect(payload.reason).toBe('amount_exceeds_remaining_at_webhook');
    expect(payload.attempted_amount_kmf).toBe(10000);
    expect(payload.allowed_remaining_kmf).toBe(5000);
    expect(payload.requires_manual_refund).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Happy paths
// ═══════════════════════════════════════════════════════════════════════════════

describe('contribution normale → settlement_in_progress (V4)', () => {
  test('updates contribution + panier + insère event contribution_paid', async () => {
    const updatedContrib = makeContribution({ status: 'paid' });
    const updatedCart = makeCart({ contributed_kmf: 20000, remaining_kmf: 10000, status: 'settlement_in_progress' });

    const client = makeClient([
      { rows: [makeContribution()] },     // SELECT contributions FOR UPDATE
      { rows: [makeCart()] },             // SELECT panier FOR UPDATE
      { rows: [updatedContrib] },         // UPDATE contribution → paid RETURNING
      { rows: [updatedCart] },            // UPDATE panier RETURNING
      { rows: [] },                       // INSERT event contribution_paid
      { rows: [] },                       // INSERT event cart_partially_funded
    ]);
    db.getClient.mockResolvedValueOnce(client);

    const result = await confirmContributionFromStripeSafely(SESSION_PAID);
    expect(result).not.toBeNull();
    expect(result.contribution.status).toBe('paid');
    expect(result.cart.status).toBe('settlement_in_progress');
    expectTransactionCommitted(client);

    const updateContrib = client.calls.find(c =>
      /UPDATE shared_cart_contributions/.test(c.sql) && c.sql.includes("status = 'paid'")
    );
    expect(updateContrib).toBeDefined();
    expect(updateContrib.params[0]).toBe('pi_test_001');

    const eventPaid = client.calls.find(c =>
      /INSERT INTO shared_cart_events/.test(c.sql) &&
      JSON.stringify(c.params).includes('contribution_paid')
    );
    expect(eventPaid).toBeDefined();
  });
});

describe('dernière contribution → ready_to_finalize (V4)', () => {
  test('panier passe ready_to_finalize + event cart_fully_funded inséré', async () => {
    // Contribution = 20 000 KMF, remaining = 20 000 → fully funded
    const contribution = makeContribution({ amount_kmf: 20000 });
    const cart = makeCart({ contributed_kmf: 10000, remaining_kmf: 20000 });

    const updatedContrib = { ...contribution, status: 'paid' };
    const updatedCart = { ...cart, contributed_kmf: 30000, remaining_kmf: 0, status: 'ready_to_finalize' };

    const client = makeClient([
      { rows: [contribution] },
      { rows: [cart] },
      { rows: [updatedContrib] },
      { rows: [updatedCart] },
      { rows: [] },  // INSERT event contribution_paid
      { rows: [] },  // INSERT event cart_fully_funded
    ]);
    db.getClient.mockResolvedValueOnce(client);

    const result = await confirmContributionFromStripeSafely(SESSION_PAID);
    expect(result.cart.status).toBe('ready_to_finalize');
    expect(result.cart.remaining_kmf).toBe(0);
    expectTransactionCommitted(client);

    const eventFunded = client.calls.find(c =>
      /INSERT INTO shared_cart_events/.test(c.sql) &&
      JSON.stringify(c.params).includes('cart_fully_funded')
    );
    expect(eventFunded).toBeDefined();
  });
});

describe('rollback sur erreur inattendue', () => {
  test('rollback si SELECT panier échoue', async () => {
    const client = makeClient([
      { rows: [makeContribution()] },
      { error: new Error('DB timeout') },
    ]);
    db.getClient.mockResolvedValueOnce(client);

    await expect(confirmContributionFromStripeSafely(SESSION_PAID)).rejects.toThrow('DB timeout');
    expectTransactionRolledBack(client);
  });
});
