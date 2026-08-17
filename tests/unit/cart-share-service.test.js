'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => ({
  query: jest.fn(),
}));
jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const db = require('../../db');
const { markShareConvertedToOrder } = require('../../services/cart-share-service');

describe('cart-share-service — markShareConvertedToOrder (frontière owner shared-cart pour cart_shares)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('met à jour cart_shares et renvoie true quand une ligne est affectée', async () => {
    db.query.mockResolvedValueOnce({ rowCount: 1 });

    const result = await markShareConvertedToOrder('tok-123', 'order-456');

    expect(result).toBe(true);
    expect(db.query).toHaveBeenCalledTimes(1);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/UPDATE cart_shares/);
    expect(sql).toMatch(/converted_order_id IS NULL/);
    expect(params).toEqual(['order-456', 'tok-123']);
  });

  test('renvoie false quand aucune ligne ne correspond (déjà converti / token inconnu) — jamais d\'exception', async () => {
    db.query.mockResolvedValueOnce({ rowCount: 0 });

    const result = await markShareConvertedToOrder('tok-unknown', 'order-456');

    expect(result).toBe(false);
  });

  test('renvoie false sans lever si la requête échoue (contrat fire-and-forget, ne doit jamais faire échouer la commande)', async () => {
    db.query.mockRejectedValueOnce(new Error('connection lost'));

    await expect(markShareConvertedToOrder('tok-123', 'order-456')).resolves.toBe(false);
  });

  test('renvoie false immédiatement si shareToken ou orderId est manquant, sans appeler la DB', async () => {
    expect(await markShareConvertedToOrder(null, 'order-456')).toBe(false);
    expect(await markShareConvertedToOrder('tok-123', undefined)).toBe(false);
    expect(db.query).not.toHaveBeenCalled();
  });
});
