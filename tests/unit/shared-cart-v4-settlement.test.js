'use strict';

const { makeClient, expectTransactionCommitted, expectTransactionRolledBack } = require('../integration/test-harness/mock-db');

jest.mock('../../db', () => ({ query: jest.fn(), getClient: jest.fn() }));
jest.mock('../../services/shared-cart-commitment-service', () => ({ lockCommitmentsForSettlement: jest.fn() }));

const db = require('../../db');
const commitments = require('../../services/shared-cart-commitment-service');
const settlement = require('../../services/shared-cart-v4-settlement');

describe('shared-cart-v4-settlement', () => {
  beforeEach(() => jest.clearAllMocks());

  function cart(overrides = {}) {
    return { id: 'cart-001', token: 'tok-1', status: 'active', expires_at: new Date(Date.now() + 86400000).toISOString(), metadata: {}, ...overrides };
  }

  it('isSettlementOpen accepte metadata object/string et statuts futurs', () => {
    expect(settlement.isSettlementOpen(cart())).toBe(false);
    expect(settlement.isSettlementOpen(cart({ metadata: { settlement_open: true } }))).toBe(true);
    expect(settlement.isSettlementOpen(cart({ metadata: JSON.stringify({ settlement_open: true }) }))).toBe(true);
    expect(settlement.isSettlementOpen(cart({ metadata: 'bad-json' }))).toBe(false);
    expect(settlement.isSettlementOpen(cart({ status: 'ready_to_finalize' }))).toBe(true);
  });

  it('assertCartCanAcceptParticipantPayment bloque les cas non payables', () => {
    expect(() => settlement.assertCartCanAcceptParticipantPayment(null)).toThrow('Panier partagé introuvable');
    expect(() => settlement.assertCartCanAcceptParticipantPayment(cart({ status: 'cancelled' }))).toThrow("n'accepte plus de paiements");
    expect(() => settlement.assertCartCanAcceptParticipantPayment(cart({ expires_at: new Date(Date.now() - 1000).toISOString() }))).toThrow('a expiré');
    expect(() => settlement.assertCartCanAcceptParticipantPayment(cart({ metadata: {} }))).toThrow('encore ouvert');
    expect(() => settlement.assertCartCanAcceptParticipantPayment(cart({ status: 'weird', metadata: { settlement_open: true } }))).toThrow('Statut incompatible');
  });

  it('assertCartCanAcceptParticipantPayment accepte legacy active avec settlement_open et futurs settlement', () => {
    expect(() => settlement.assertCartCanAcceptParticipantPayment(cart({ status: 'active', metadata: { settlement_open: true } }))).not.toThrow();
    expect(() => settlement.assertCartCanAcceptParticipantPayment(cart({ status: 'settlement_in_progress' }))).not.toThrow();
  });

  it('assertCanAcceptParticipantPaymentByToken charge le panier puis applique le guard', async () => {
    const q = { query: jest.fn().mockResolvedValueOnce({ rows: [cart({ status: 'closed_for_settlement' })] }) };

    await expect(settlement.assertCanAcceptParticipantPaymentByToken('tok-1', q)).resolves.toMatchObject({ id: 'cart-001' });
    expect(q.query).toHaveBeenCalledWith(expect.stringContaining('WHERE token = $1'), ['tok-1']);
  });

  it('openSettlement refuse 404, ferme, deja ouvert et expire', async () => {
    const missing = makeClient([{ rows: [] }]);
    db.getClient.mockResolvedValueOnce(missing);
    await expect(settlement.openSettlement('missing', 'user-001')).rejects.toMatchObject({ code: 'shared_cart_not_found' });
    expectTransactionRolledBack(missing);

    const closed = makeClient([{ rows: [cart({ status: 'cancelled' })] }]);
    db.getClient.mockResolvedValueOnce(closed);
    await expect(settlement.openSettlement('cart-001', 'user-001')).rejects.toMatchObject({ code: 'shared_cart_closed' });

    const already = makeClient([{ rows: [cart({ metadata: { settlement_open: true } })] }]);
    db.getClient.mockResolvedValueOnce(already);
    await expect(settlement.openSettlement('cart-001', 'user-001')).rejects.toMatchObject({ code: 'settlement_already_open' });

    const expired = makeClient([{ rows: [cart({ expires_at: new Date(Date.now() - 1000).toISOString() })] }]);
    db.getClient.mockResolvedValueOnce(expired);
    await expect(settlement.openSettlement('cart-001', 'user-001')).rejects.toMatchObject({ code: 'shared_cart_expired' });
  });

  it('openSettlement verrouille engagements, borne la fenetre et journalise', async () => {
    const client = makeClient([
      { rows: [cart()] },
      { rows: [{ id: 'cart-001', status: 'closed_for_settlement' }] },
      { rows: [], rowCount: 1 },
    ]);
    db.getClient.mockResolvedValue(client);
    commitments.lockCommitmentsForSettlement.mockResolvedValueOnce([{ amount_kmf: 2500 }, { amount_kmf: 5000 }]);

    await expect(settlement.openSettlement('cart-001', 'user-001', { settlement_window_hours: 999 })).resolves.toMatchObject({ status: 'closed_for_settlement' });
    const payload = JSON.parse(client.calls[1].params[2]);
    expect(payload).toMatchObject({ settlement_open: true, settlement_opened_by: 'user-001', settlement_window_hours: 168, locked_commitments_count: 2, locked_commitments_total_kmf: 7500 });
    expect(client.calls[2].params[1]).toBe('user-001');
    expectTransactionCommitted(client);
  });
});
