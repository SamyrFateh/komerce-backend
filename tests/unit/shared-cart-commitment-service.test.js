'use strict';

const { makeClient, expectTransactionCommitted, expectTransactionRolledBack } = require('../integration/test-harness/mock-db');

jest.mock('../../db', () => ({ query: jest.fn(), getClient: jest.fn() }));
jest.mock('../../services/shared-cart-v4-settlement', () => ({ isSettlementOpen: jest.fn(() => false) }));

const db = require('../../db');
const settlement = require('../../services/shared-cart-v4-settlement');
const svc = require('../../services/shared-cart-commitment-service');

describe('shared-cart-commitment-service', () => {
  beforeEach(() => jest.clearAllMocks());

  function openCart(overrides = {}) {
    return { id: 'cart-001', token: 'tok-1', status: 'active', expires_at: new Date(Date.now() + 86400000).toISOString(), metadata: {}, ...overrides };
  }

  it('listCommitmentsByToken masque les telephones publics', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [openCart()] })
      .mockResolvedValueOnce({ rows: [
        { id: 'c1', participant_name: 'Ali', participant_phone: '+2697001234', amount_kmf: 5000, status: 'pledged' },
        { id: 'c2', participant_name: 'Bo', participant_phone: '1234', amount_kmf: 2500, status: 'pledged' },
      ] });

    const result = await svc.listCommitmentsByToken('tok-1');

    expect(result.cart.id).toBe('cart-001');
    expect(result.commitments[0].participant_phone).toBe('*******1234');
    expect(result.commitments[1].participant_phone).toBe('****');
  });

  it('listCommitmentsByToken retourne 404 si panier inconnu', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    await expect(svc.listCommitmentsByToken('missing')).rejects.toMatchObject({ status: 404, code: 'shared_cart_not_found' });
  });

  it('createOrUpdateCommitment valide nom et montant avant transaction', async () => {
    await expect(svc.createOrUpdateCommitment('tok-1', { amount_kmf: 2500 })).rejects.toMatchObject({ code: 'participant_name_required' });
    await expect(svc.createOrUpdateCommitment('tok-1', { participant_name: 'Ali', amount_kmf: 2499 })).rejects.toMatchObject({ code: 'amount_too_low' });
    await expect(svc.createOrUpdateCommitment('tok-1', { participant_name: 'Ali', amount_kmf: 500001 })).rejects.toMatchObject({ code: 'amount_too_high' });
    expect(db.getClient).not.toHaveBeenCalled();
  });

  it('createOrUpdateCommitment cree un engagement pledged et un evenement', async () => {
    const cart = openCart();
    const commitment = { id: 'commit-001', participant_name: 'Ali', participant_phone: '+269000', amount_kmf: 5000, status: 'pledged' };
    const client = makeClient([
      { rows: [cart] },
      { rows: [] },
      { rows: [commitment] },
      { rows: [], rowCount: 1 },
    ]);
    db.getClient.mockResolvedValue(client);

    await expect(svc.createOrUpdateCommitment('tok-1', { participant_name: ' Ali ', participant_phone: '+269000', amount_kmf: 5000, message: 'ok' }))
      .resolves.toEqual({ cart, commitment, updated: false });
    expect(client.calls[3].sql).toContain('INSERT INTO shared_cart_commitments');
    expect(client.calls[3].params).toEqual(['cart-001', 'Ali', '+269000', 5000, 'ok', JSON.stringify({ source: 'public_shared_cart' })]);
    expect(client.calls[4].params[1]).toBe('commitment_created');
    expectTransactionCommitted(client);
  });

  it('createOrUpdateCommitment met a jour lengagement existant par telephone', async () => {
    const cart = openCart();
    const existing = { id: 'commit-001' };
    const updated = { id: 'commit-001', participant_name: 'Ali', amount_kmf: 7000, status: 'updated' };
    const client = makeClient([
      { rows: [cart] },
      { rows: [existing] },
      { rows: [updated] },
      { rows: [], rowCount: 1 },
    ]);
    db.getClient.mockResolvedValue(client);

    await expect(svc.createOrUpdateCommitment('tok-1', { participant_name: 'Ali', participant_phone: '+269000', amount_kmf: 7000 }))
      .resolves.toEqual({ cart, commitment: updated, updated: true });
    expect(client.calls[3].sql).toContain('UPDATE shared_cart_commitments');
    expect(client.calls[4].params[1]).toBe('commitment_updated');
    expectTransactionCommitted(client);
  });

  it('createOrUpdateCommitment refuse panier ferme, expire ou settlement ouvert', async () => {
    const closed = makeClient([{ rows: [openCart({ status: 'closed' })] }]);
    db.getClient.mockResolvedValueOnce(closed);
    await expect(svc.createOrUpdateCommitment('tok-1', { participant_name: 'Ali', amount_kmf: 5000 })).rejects.toMatchObject({ code: 'commitment_closed' });
    expectTransactionRolledBack(closed);

    const expired = makeClient([{ rows: [openCart({ expires_at: new Date(Date.now() - 1000).toISOString() })] }]);
    db.getClient.mockResolvedValueOnce(expired);
    await expect(svc.createOrUpdateCommitment('tok-1', { participant_name: 'Ali', amount_kmf: 5000 })).rejects.toMatchObject({ code: 'shared_cart_expired' });

    settlement.isSettlementOpen.mockReturnValueOnce(true);
    const settlementClient = makeClient([{ rows: [openCart()] }]);
    db.getClient.mockResolvedValueOnce(settlementClient);
    await expect(svc.createOrUpdateCommitment('tok-1', { participant_name: 'Ali', amount_kmf: 5000 })).rejects.toMatchObject({ code: 'settlement_already_open' });
  });

  it('withdrawCommitment retire avec garde telephone et evenement', async () => {
    const cart = openCart();
    const commitment = { id: 'commit-001', status: 'withdrawn' };
    const client = makeClient([
      { rows: [cart] },
      { rows: [commitment] },
      { rows: [], rowCount: 1 },
    ]);
    db.getClient.mockResolvedValue(client);

    await expect(svc.withdrawCommitment('tok-1', 'commit-001', { participant_phone: '+269000', reason: 'changed' }))
      .resolves.toEqual({ cart, commitment });
    expect(client.calls[2].params).toEqual(['commit-001', 'cart-001', '+269000', JSON.stringify({ reason: 'changed' })]);
    expect(client.calls[3].params[1]).toBe('commitment_withdrawn');
    expectTransactionCommitted(client);
  });

  it('withdrawCommitment retourne 404 si rien nest retirable', async () => {
    const client = makeClient([
      { rows: [openCart()] },
      { rows: [] },
    ]);
    db.getClient.mockResolvedValue(client);

    await expect(svc.withdrawCommitment('tok-1', 'missing', {})).rejects.toMatchObject({ code: 'commitment_not_found_or_locked' });
    expectTransactionRolledBack(client);
  });

  it('lockCommitmentsForSettlement verrouille les engagements et journalise le total', async () => {
    const client = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'c1', amount_kmf: 2500 }, { id: 'c2', amount_kmf: 5000 }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) };

    await expect(svc.lockCommitmentsForSettlement('cart-001', 'user-001', client)).resolves.toEqual([{ id: 'c1', amount_kmf: 2500 }, { id: 'c2', amount_kmf: 5000 }]);
    expect(client.query.mock.calls[0][0]).toContain("SET status = 'locked_for_settlement'");
    expect(client.query.mock.calls[1][1]).toEqual(['cart-001', 'commitments_locked_for_settlement', 'user', 'user-001', { count: 2, total_kmf: 7500 }]);
  });
});
