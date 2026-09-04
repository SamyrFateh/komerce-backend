/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
'use strict';

const mockGenerateAndStoreSecret = jest.fn();
jest.mock('../../services/pickup-secret-issuer', () => ({
  generateAndStoreSecret: (...args) => mockGenerateAndStoreSecret(...args),
}));

const mockRecordPickupRegeneration = jest.fn();
jest.mock('../../services/order-mutation-service', () => ({
  recordPickupRegeneration: (...args) => mockRecordPickupRegeneration(...args),
}));

const {
  rotatePickupSecretAfterPartialCollection,
} = require('../../services/pickup-secret-rotation-service');

describe('pickup-secret-rotation-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGenerateAndStoreSecret.mockResolvedValue({ code: 'ABC-DEF-GH', last4: 'EFGH' });
    mockRecordPickupRegeneration.mockResolvedValue({});
  });

  test('exige le client transactionnel', async () => {
    await expect(rotatePickupSecretAfterPartialCollection({ orderId: 'o1' }))
      .rejects.toThrow(/client transactionnel requis/);
  });

  test('consomme ancien secret, régénère canonique et recache le nouveau clair dans la même transaction', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };

    const result = await rotatePickupSecretAfterPartialCollection({
      client,
      orderId: 'o1',
      relaisId: 'r1',
    });

    expect(result).toEqual({ last4: 'EFGH' });
    expect(result.code).toBeUndefined();
    expect(client.query.mock.calls[0][0]).toMatch(/DELETE FROM pickup_reveal_codes/);
    expect(client.query.mock.calls[1][0]).toMatch(/DELETE FROM pickup_print_tokens/);
    expect(mockGenerateAndStoreSecret).toHaveBeenCalledWith(expect.objectContaining({
      orderId: 'o1',
      relaisId: 'r1',
      channel: 'partial_pickup',
      dbClient: client,
      excludeOrderId: 'o1',
      extraUpdates: { pickup_secret_revealed_at: null },
    }));
    expect(mockRecordPickupRegeneration).toHaveBeenCalledWith(client, {
      orderId: 'o1',
      reason: 'partial_pickup',
    });
    const cacheCall = client.query.mock.calls.find(([sql]) =>
      sql.includes('INSERT INTO pickup_reveal_codes')
    );
    expect(cacheCall[1]).toEqual(['o1', 'ABC-DEF-GH']);
  });
});
