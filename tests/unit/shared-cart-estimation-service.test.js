'use strict';

const { makeClient, expectTransactionCommitted, expectTransactionRolledBack } = require('../integration/test-harness/mock-db');

jest.mock('../../db', () => ({ query: jest.fn(), getClient: jest.fn() }));
jest.mock('../../utils/logger', () => ({ child: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() })) }));

const db = require('../../db');
const {
  getPublicAggregate,
  getEstimationByPhone,
  upsertEstimation,
  deleteEstimation,
  listEstimationsForOwner,
} = require('../../services/shared-cart-estimation-service');

describe('shared-cart-estimation-service', () => {
  beforeEach(() => jest.clearAllMocks());

  it('getPublicAggregate expose seulement total et count', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'cart-001', status: 'open' }] })
      .mockResolvedValueOnce({ rows: [{ total_estimated_kmf: 12000, count: 3 }] });

    await expect(getPublicAggregate('token-001')).resolves.toEqual({ total_estimated_kmf: 12000, count: 3 });
    expect(db.query.mock.calls[1][0]).toContain('SUM(amount_kmf)');
  });

  it('getEstimationByPhone retourne null sans telephone', async () => {
    await expect(getEstimationByPhone('token-001', '')).resolves.toBeNull();
    expect(db.query).not.toHaveBeenCalled();
  });

  it('upsertEstimation cree une estimation si aucun telephone existant', async () => {
    const cart = { id: 'cart-001', status: 'open' };
    const estimation = { id: 'est-001', amount_kmf: 5000 };
    const client = makeClient([
      { rows: [cart] },
      { rows: [] },
      { rows: [estimation] },
      { rows: [], rowCount: 1 },
    ]);
    db.getClient.mockResolvedValue(client);

    await expect(upsertEstimation('token-001', {
      participant_name: 'Ali', participant_phone: '+269000', amount_kmf: 5000,
    })).resolves.toEqual({ cart, estimation, updated: false });
    expect(client.calls[2].sql).toContain('INSERT INTO shared_cart_estimations');
    expect(client.calls[3].params[1]).toBe('estimation_created');
    expectTransactionCommitted(client);
  });

  it('upsertEstimation met a jour lestimation existante par telephone', async () => {
    const cart = { id: 'cart-001', status: 'open' };
    const estimation = { id: 'est-001', amount_kmf: 7000 };
    const client = makeClient([
      { rows: [cart] },
      { rows: [{ id: 'est-001' }] },
      { rows: [estimation] },
      { rows: [], rowCount: 1 },
    ]);
    db.getClient.mockResolvedValue(client);

    await expect(upsertEstimation('token-001', {
      participant_name: 'Ali', participant_phone: '+269000', amount_kmf: 7000,
    })).resolves.toEqual({ cart, estimation, updated: true });
    expect(client.calls[2].sql).toContain('UPDATE shared_cart_estimations');
    expect(client.calls[3].params[1]).toBe('estimation_updated');
    expectTransactionCommitted(client);
  });

  it('upsertEstimation refuse un montant trop bas avant transaction', async () => {
    await expect(upsertEstimation('token-001', { participant_name: 'Ali', amount_kmf: 1000 }))
      .rejects.toMatchObject({ code: 'amount_too_low', status: 400 });
    expect(db.getClient).not.toHaveBeenCalled();
  });

  it('upsertEstimation refuse un panier ferme', async () => {
    const client = makeClient([{ rows: [{ id: 'cart-001', status: 'closed' }] }]);
    db.getClient.mockResolvedValue(client);

    await expect(upsertEstimation('token-001', { participant_name: 'Ali', amount_kmf: 5000 }))
      .rejects.toMatchObject({ code: 'estimation_not_allowed', status: 409 });
    expectTransactionRolledBack(client);
  });

  it('deleteEstimation supprime avec garde telephone optionnelle', async () => {
    const cart = { id: 'cart-001', status: 'open' };
    const deleted = { id: 'est-001', participant_phone: '+269000' };
    const client = makeClient([
      { rows: [cart] },
      { rows: [deleted] },
      { rows: [], rowCount: 1 },
    ]);
    db.getClient.mockResolvedValue(client);

    await expect(deleteEstimation('token-001', 'est-001', { participant_phone: '+269000' })).resolves.toEqual({ cart, deleted });
    expect(client.calls[1].params).toEqual(['est-001', 'cart-001', '+269000']);
    expect(client.calls[2].params[1]).toBe('estimation_deleted');
    expectTransactionCommitted(client);
  });

  it('listEstimationsForOwner retourne le detail createur', async () => {
    const rows = [{ id: 'est-001', participant_phone: '+269000', amount_kmf: 5000 }];
    db.query.mockResolvedValueOnce({ rows });

    await expect(listEstimationsForOwner('cart-001')).resolves.toBe(rows);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY created_at DESC'), ['cart-001']);
  });
});
