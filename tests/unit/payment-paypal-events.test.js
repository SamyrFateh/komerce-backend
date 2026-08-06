/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

/**
 * KOMERCE — Tests Unitaires : payment-paypal-events (P0 payments)
 *
 * Couvre markPaypalEventProcessed : insertion idempotente (ON CONFLICT DO NOTHING)
 * et tolérance aux erreurs DB (ne doit jamais lever).
 *
 * Run : npx jest tests/unit/payment-paypal-events.test.js
 */

'use strict';

jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const { markPaypalEventProcessed } = require('../../services/payment-paypal-events');

describe('markPaypalEventProcessed', () => {
  test('insère l\'event avec les bons paramètres', async () => {
    const mockQuery = jest.fn().mockResolvedValue({});
    const fakeDb = { query: mockQuery };

    const event = { id: 'evt-1', event_type: 'PAYMENT.CAPTURE.COMPLETED' };

    await markPaypalEventProcessed(event, 'processed', { order: 'KMC-001' }, fakeDb);

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO paypal_events_processed/);
    expect(sql).toMatch(/ON CONFLICT \(event_id\) DO NOTHING/);
    expect(params).toEqual([
      'evt-1',
      'PAYMENT.CAPTURE.COMPLETED',
      JSON.stringify({ order: 'KMC-001' }),
      'processed',
    ]);
  });

  test('sérialise un payloadSummary vide en objet par défaut', async () => {
    const mockQuery = jest.fn().mockResolvedValue({});
    const fakeDb = { query: mockQuery };

    await markPaypalEventProcessed({ id: 'evt-2', event_type: 'X' }, 'failed', null, fakeDb);

    const [, params] = mockQuery.mock.calls[0];
    expect(params[2]).toBe(JSON.stringify({}));
  });

  test('n\'échoue jamais même si la requête DB rejette (log + swallow)', async () => {
    const mockQuery = jest.fn().mockRejectedValue(new Error('db down'));
    const fakeDb = { query: mockQuery };

    await expect(
      markPaypalEventProcessed({ id: 'evt-3', event_type: 'X' }, 'processed', {}, fakeDb)
    ).resolves.toBeUndefined();
  });
});
