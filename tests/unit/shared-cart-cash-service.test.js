'use strict';

const { makeClient, expectTransactionCommitted, expectTransactionRolledBack } = require('../integration/test-harness/mock-db');

jest.mock('../../db', () => ({ getClient: jest.fn() }));
jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const db = require('../../db');
const { createPendingCashContribution, confirmCashContribution } = require('../../services/shared-cart-cash-service');

function cart(overrides = {}) {
  return {
    id: 'cart-001', token: 'token-001', status: 'closed', remaining_kmf: 10000,
    contributed_kmf: 0, total_kmf_snapshot: 10000,
    payment_window_ends_at: new Date(Date.now() + 3600_000).toISOString(),
    ...overrides,
  };
}

describe('shared-cart-cash-service', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('createPendingCashContribution', () => {
    it('cree une contribution cash pending et un event', async () => {
      const contribution = { id: 'cash-001', shared_cart_id: 'cart-001', status: 'pending_cash', cash_reference: 'SCASH-TEST' };
      const client = makeClient([
        { rows: [cart()] },
        { rows: [] },
        { rows: [contribution] },
        { rows: [], rowCount: 1 },
      ]);
      db.getClient.mockResolvedValue(client);

      const result = await createPendingCashContribution('token-001', {
        contributor_name: 'User', amount_kmf: 5000, relais_id: 'relais-001',
      });

      expect(result.cart.id).toBe('cart-001');
      expect(result.contribution).toBe(contribution);
      expect(client.calls[3].sql).toContain('INSERT INTO shared_cart_contributions');
      expect(client.calls[4].sql).toContain('INSERT INTO shared_cart_events');
      expectTransactionCommitted(client);
    });

    it('refuse un panier non ferme', async () => {
      const client = makeClient([{ rows: [cart({ status: 'open' })] }]);
      db.getClient.mockResolvedValue(client);

      await expect(createPendingCashContribution('token-001', { contributor_name: 'User', amount_kmf: 5000 })).rejects.toMatchObject({ code: 'cart_not_closed' });
      expectTransactionRolledBack(client);
    });

    it('refuse un montant inferieur au minimum', async () => {
      const client = makeClient([{ rows: [cart()] }]);
      db.getClient.mockResolvedValue(client);

      await expect(createPendingCashContribution('token-001', { contributor_name: 'User', amount_kmf: 1000 })).rejects.toThrow('Contribution minimum');
      expectTransactionRolledBack(client);
    });
  });

  describe('confirmCashContribution', () => {
    it('retourne already_confirmed si la contribution est deja payee', async () => {
      const paid = { id: 'cash-001', status: 'paid', payment_method: 'cash' };
      const client = makeClient([{ rows: [paid] }]);
      db.getClient.mockResolvedValue(client);

      await expect(confirmCashContribution('cash-001')).resolves.toEqual({ contribution: paid, already_confirmed: true });
      expectTransactionCommitted(client);
    });

    it('confirme une contribution cash et met a jour le panier', async () => {
      const contribution = { id: 'cash-001', shared_cart_id: 'cart-001', status: 'pending_cash', payment_method: 'cash', amount_kmf: 5000, cash_reference: 'SCASH-1' };
      const updatedContribution = { ...contribution, status: 'paid' };
      const updatedCart = cart({ contributed_kmf: 5000, remaining_kmf: 5000 });
      const client = makeClient([
        { rows: [contribution] },
        { rows: [cart()] },
        { rows: [updatedContribution] },
        { rows: [], rowCount: 1 },
        { rows: [], rowCount: 1 },
        { rows: [updatedCart] },
      ]);
      db.getClient.mockResolvedValue(client);

      const result = await confirmCashContribution('cash-001', { id: 'agent-001', role: 'agent_relais', relais_id: 'relais-001' });

      expect(result).toEqual({ cart: updatedCart, contribution: updatedContribution });
      expect(client.calls[3].sql).toContain("SET status = 'paid'");
      expect(client.calls[4].sql).toContain('UPDATE shared_carts');
      expect(client.calls[5].sql).toContain('INSERT INTO shared_cart_events');
      expectTransactionCommitted(client);
    });

    it('rejette la confirmation si le montant depasse le restant', async () => {
      const contribution = { id: 'cash-001', shared_cart_id: 'cart-001', status: 'pending_cash', payment_method: 'cash', amount_kmf: 7000 };
      const failed = { ...contribution, status: 'failed' };
      const client = makeClient([
        { rows: [contribution] },
        { rows: [cart({ remaining_kmf: 4000 })] },
        { rows: [failed] },
        { rows: [], rowCount: 1 },
      ]);
      db.getClient.mockResolvedValue(client);

      const result = await confirmCashContribution('cash-001');

      expect(result).toEqual(expect.objectContaining({ rejected: true, code: 'amount_exceeds_remaining', contribution: failed }));
      expect(client.calls[3].sql).toContain("SET status = 'failed'");
      expectTransactionCommitted(client);
    });
  });
});
