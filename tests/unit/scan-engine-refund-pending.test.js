'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * Retrait client pendant une réservation de remboursement E7 :
 * le trigger PG (23514) doit devenir un refus métier ScanError, jamais une 500.
 */
jest.mock('../../db', () => ({ connect: jest.fn(), query: jest.fn() }));
jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const { syncOrderFromParcels, ScanError } = require('../../services/scan-engine');

describe('syncOrderFromParcels — remboursement article réservé', () => {
  test('23514 ITEM_REFUND_PENDING_QTY_NOT_COLLECTABLE → ScanError ITEM_REFUND_PENDING', async () => {
    const pgErr = Object.assign(new Error('ITEM_REFUND_PENDING_QTY_NOT_COLLECTABLE'), { code: '23514' });
    const client = { query: jest.fn().mockRejectedValueOnce(pgErr) };
    const failure = await syncOrderFromParcels(client, 'order-1').catch((e) => e);
    expect(failure).toBeInstanceOf(ScanError);
    expect(failure.code).toBe('ITEM_REFUND_PENDING');
  });

  test('toute autre erreur PG reste propagée telle quelle', async () => {
    const other = Object.assign(new Error('boom'), { code: '40001' });
    const client = { query: jest.fn().mockRejectedValueOnce(other) };
    await expect(syncOrderFromParcels(client, 'order-1')).rejects.toBe(other);
  });
});
