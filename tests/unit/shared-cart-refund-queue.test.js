'use strict';

/**
 * tests/unit/shared-cart-refund-queue.test.js
 *
 * Couvre listManualRefundQueue et markManualRefundProcessed :
 *
 * listManualRefundQueue :
 *   ✅ Retourne items + count corrects
 *   ✅ Retourne liste vide si aucune entrée
 *   ✅ clampLimit — valeur invalide → 50
 *   ✅ clampLimit — valeur max > 200 → 200
 *
 * markManualRefundProcessed :
 *   ✅ Happy path — status passe refunded + event audit inséré
 *   ✅ Contribution introuvable → erreur 404
 *   ✅ Contribution sans requires_manual_refund → erreur 400
 *   ✅ Idempotence — UPDATE rowCount=0 (déjà refunded) → erreur 409
 *   ✅ Rollback sur erreur DB
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
const {
  listManualRefundQueue,
  markManualRefundProcessed,
} = require('../../services/shared-cart-refund-queue');

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeContribRow(overrides = {}) {
  return {
    contribution_id: 'contrib-001',
    shared_cart_id: 'cart-001',
    contributor_name: 'Aicha',
    contributor_phone: '+33699000001',
    amount_kmf: 10000,
    amount_paid: 20,
    currency_paid: 'EUR',
    contribution_status: 'failed',
    stripe_session_id: 'cs_test_001',
    stripe_payment_intent_id: 'pi_test_001',
    failed_at: new Date().toISOString(),
    contribution_metadata: { requires_manual_refund: true },
    shared_cart_token: 'TOKEN123',
    shared_cart_status: 'fully_funded',
    ...overrides,
  };
}

function makeFullContribution(overrides = {}) {
  return {
    id: 'contrib-001',
    shared_cart_id: 'cart-001',
    status: 'failed',
    amount_kmf: 10000,
    amount_paid: 20,
    currency_paid: 'EUR',
    stripe_session_id: 'cs_test_001',
    stripe_payment_intent_id: 'pi_test_001',
    metadata: { requires_manual_refund: true },
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════════
// listManualRefundQueue
// ═══════════════════════════════════════════════════════════════════════════════

describe('listManualRefundQueue', () => {
  test('retourne items + count', async () => {
    const item = makeContribRow();
    db.query
      .mockResolvedValueOnce({ rows: [item] })        // SELECT items
      .mockResolvedValueOnce({ rows: [{ count: 1 }] }); // COUNT

    const result = await listManualRefundQueue({ limit: 10, offset: 0 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].contribution_id).toBe('contrib-001');
    expect(result.count).toBe(1);
    expect(result.limit).toBe(10);
    expect(result.offset).toBe(0);
  });

  test('retourne liste vide si aucune contribution', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: 0 }] });

    const result = await listManualRefundQueue();
    expect(result.items).toHaveLength(0);
    expect(result.count).toBe(0);
  });

  test('clampLimit — valeur invalide (NaN) → 50', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: 0 }] });

    const result = await listManualRefundQueue({ limit: 'abc' });
    expect(result.limit).toBe(50);
  });

  test('clampLimit — valeur > 200 → plafond 200', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: 0 }] });

    const result = await listManualRefundQueue({ limit: 9999 });
    expect(result.limit).toBe(200);
  });

  test('le SELECT items passe bien limit + offset en paramètres', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: 0 }] });

    await listManualRefundQueue({ limit: 5, offset: 10 });
    const [, params] = db.query.mock.calls[0];
    expect(params).toEqual([5, 10]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// markManualRefundProcessed
// ═══════════════════════════════════════════════════════════════════════════════

describe('markManualRefundProcessed — happy path', () => {
  test('status passe refunded + audit event inséré', async () => {
    const refunded = makeFullContribution({ status: 'refunded' });

    const client = makeClient([
      { rows: [makeFullContribution()] },  // SELECT FOR UPDATE
      { rows: [refunded] },                // UPDATE → RETURNING
      { rows: [] },                        // INSERT event
      { rows: [{ finalized_order_id: null }] }, // SELECT finalized_order_id (panier non finalisé → pas d'INSERT refunds)
    ]);
    db.getClient.mockResolvedValueOnce(client);

    const result = await markManualRefundProcessed(
      'contrib-001', 'admin-001',
      { refund_reference: 're_test_001', note: 'Remboursé manuellement' }
    );
    expect(result.contribution.status).toBe('refunded');
    expectTransactionCommitted(client);

    // L'UPDATE doit poser status = 'refunded'
    const updateCall = client.calls.find(c =>
      /UPDATE shared_cart_contributions/.test(c.sql) && c.sql.includes("status = 'refunded'")
    );
    expect(updateCall).toBeDefined();

    // La metadata doit inclure les flags de clôture
    const metaPayload = JSON.parse(updateCall.params[0]);
    expect(metaPayload.requires_manual_refund).toBe(false);
    expect(metaPayload.manual_refund_processed).toBe(true);
    expect(metaPayload.manual_refund_reference).toBe('re_test_001');

    // L'event audit doit être inséré
    const insertEvent = client.calls.find(c =>
      /INSERT INTO shared_cart_events/.test(c.sql) &&
      c.sql.includes('manual_refund_marked')
    );
    expect(insertEvent).toBeDefined();
  });
});

describe('markManualRefundProcessed — contribution introuvable', () => {
  test('lève une erreur 404', async () => {
    const client = makeClient([
      { rows: [] }, // SELECT → vide
    ]);
    db.getClient.mockResolvedValueOnce(client);

    const err = await markManualRefundProcessed('contrib-inconnu', 'admin-001').catch(e => e);
    expect(err.statusCode).toBe(404);
    expect(err.message).toMatch(/introuvable/i);
    expectTransactionRolledBack(client);
  });
});

describe('markManualRefundProcessed — contribution sans requires_manual_refund', () => {
  test('lève une erreur 400', async () => {
    // metadata sans requires_manual_refund (ex: contribution ordinaire failed)
    const contrib = makeFullContribution({
      metadata: { requires_manual_refund: false },
    });
    const client = makeClient([
      { rows: [contrib] }, // SELECT → trouvé mais not eligible
    ]);
    db.getClient.mockResolvedValueOnce(client);

    const err = await markManualRefundProcessed('contrib-001', 'admin-001').catch(e => e);
    expect(err.statusCode).toBe(400);
    expectTransactionRolledBack(client);
  });
});

describe('markManualRefundProcessed — idempotence (déjà refunded)', () => {
  test('lève une erreur 409 si UPDATE rowCount=0', async () => {
    // SELECT retourne une contrib éligible, mais l'UPDATE ne match plus
    // (race condition : un autre admin a déjà traité entre-temps)
    const client = makeClient([
      { rows: [makeFullContribution()] }, // SELECT OK
      { rows: [] },                       // UPDATE RETURNING → 0 lignes
    ]);
    db.getClient.mockResolvedValueOnce(client);

    const err = await markManualRefundProcessed('contrib-001', 'admin-001').catch(e => e);
    expect(err.statusCode).toBe(409);
    expect(err.message).toMatch(/déjà traité|incompatible/i);
    expectTransactionRolledBack(client);
  });
});

describe('markManualRefundProcessed — rollback sur erreur DB', () => {
  test('rollback si UPDATE échoue', async () => {
    const client = makeClient([
      { rows: [makeFullContribution()] },
      { error: new Error('DB timeout') },
    ]);
    db.getClient.mockResolvedValueOnce(client);

    await expect(markManualRefundProcessed('contrib-001', 'admin-001')).rejects.toThrow('DB timeout');
    expectTransactionRolledBack(client);
  });
});
