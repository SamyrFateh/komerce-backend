'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const mockQuery = jest.fn();
const mockReconcile = jest.fn();

jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));
jest.mock('../../services/payment-mobile-money', () => ({
  reconcileMobileMoneyTransaction: (...args) => mockReconcile(...args),
}));
jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

const { reconcilePendingMobileMoney } = require('../../services/mobile-money-reconciliation');

describe('mobile-money-reconciliation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('reprend séquentiellement les pending et compte les succès', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 'tx-1' }, { id: 'tx-2' }] });
    mockReconcile
      .mockResolvedValueOnce({ transaction: { status: 'pending' } })
      .mockResolvedValueOnce({ transaction: { status: 'succeeded' } });

    const result = await reconcilePendingMobileMoney({ limit: 25 });

    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining("status IN ('initiated', 'pending')"), [25]);
    expect(mockReconcile.mock.calls).toEqual([['tx-1'], ['tx-2']]);
    expect(result).toEqual({ scanned: 2, reconciled: 2, succeeded: 1, failed: 0 });
  });

  test('une erreur provider n’arrête pas les transactions suivantes', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 'tx-a' }, { id: 'tx-b' }] });
    mockReconcile
      .mockRejectedValueOnce(new Error('provider unavailable'))
      .mockResolvedValueOnce({ transaction: { status: 'pending' } });

    const result = await reconcilePendingMobileMoney({ limit: 999 });

    expect(mockQuery).toHaveBeenCalledWith(expect.any(String), [100]);
    expect(mockReconcile).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ scanned: 2, reconciled: 1, succeeded: 0, failed: 1 });
  });
});
