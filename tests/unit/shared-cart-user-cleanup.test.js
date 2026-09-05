'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const { deleteUserBasketData } = require('../../services/shared-cart-user-cleanup');

describe('shared-cart-user-cleanup', () => {
  test('exige un executor transactionnel fourni par l’appelant', async () => {
    await expect(deleteUserBasketData(null, 'u1')).rejects.toThrow(
      'shared-cart-user-cleanup: executor.query requis'
    );
  });

  test('supprime d’abord les lignes panier puis les paniers du même utilisateur', async () => {
    const executor = {
      query: jest.fn()
        .mockResolvedValueOnce({ rowCount: 2 })
        .mockResolvedValueOnce({ rowCount: 1 }),
    };

    await deleteUserBasketData(executor, 'u1');

    expect(executor.query).toHaveBeenCalledTimes(2);
    expect(executor.query.mock.calls[0]).toEqual([
      expect.stringMatching(/DELETE FROM basket_items[\s\S]*baskets WHERE user_id = \$1::uuid/i),
      ['u1'],
    ]);
    expect(executor.query.mock.calls[1]).toEqual([
      'DELETE FROM baskets WHERE user_id = $1::uuid',
      ['u1'],
    ]);
  });
});
