'use strict';

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

const db = require('../../db');
const { startContribution, attachStripeSession, markContributionFailed } = require('../../services/shared-cart-contributions');

describe('shared-cart-contributions', () => {
  beforeEach(() => jest.clearAllMocks());

  it('startContribution cree une contribution pending et un event', async () => {
    const cart = {
      id: 'cart-001', token: 'token-001', status: 'closed', remaining_kmf: 10000,
      payment_window_ends_at: new Date(Date.now() + 3600_000).toISOString(),
    };
    const contribution = { id: 'contrib-001', shared_cart_id: 'cart-001', status: 'pending' };
    const client = makeClient([
      { rows: [cart] },
      { rows: [contribution] },
      { rows: [], rowCount: 1 },
    ]);
    db.getClient.mockResolvedValue(client);

    const result = await startContribution('token-001', {
      name: 'User', email: 'user@test.com', amountKmf: 5000, amountPaid: 10, currency: 'EUR', fxRate: 492,
    });

    expect(result).toEqual({ contribution, cart });
    expect(client.calls[2].sql).toContain('INSERT INTO shared_cart_contributions');
    expect(client.calls[3].sql).toContain('INSERT INTO shared_cart_events');
    expectTransactionCommitted(client);
  });

  it('startContribution refuse un panier introuvable et rollback', async () => {
    const client = makeClient([{ rows: [] }]);
    db.getClient.mockResolvedValue(client);

    await expect(startContribution('missing', { name: 'User', email: 'user@test.com', amountKmf: 5000 })).rejects.toThrow('Panier partagé introuvable');
    expectTransactionRolledBack(client);
  });

  it('attachStripeSession met a jour uniquement une contribution pending', async () => {
    db.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await attachStripeSession('contrib-001', 'cs_test_001');

    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE shared_cart_contributions'), ['cs_test_001', 'contrib-001']);
    expect(db.query.mock.calls[0][0]).toContain("WHERE id = $2 AND status = 'pending'");
  });

  it('markContributionFailed marque failed et journalise si une ligne est retournee', async () => {
    const failed = { id: 'contrib-001', shared_cart_id: 'cart-001', status: 'failed' };
    const client = makeClient([
      { rows: [failed] },
      { rows: [], rowCount: 1 },
    ]);
    db.getClient.mockResolvedValue(client);

    const result = await markContributionFailed('cs_test_001', 'expired');

    expect(result).toBe(failed);
    expect(client.calls[1].sql).toContain("SET status = 'failed'");
    expect(client.calls[2].sql).toContain('INSERT INTO shared_cart_events');
    expectTransactionCommitted(client);
  });
});
