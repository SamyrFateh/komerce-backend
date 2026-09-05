'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => ({ query: jest.fn() }));
jest.mock('../../services/order-mutation-service', () => ({ writePickupSecret: jest.fn() }));
jest.mock('../../utils/logger', () => ({ child: () => ({ info: jest.fn(), error: jest.fn() }) }));

const db = require('../../db');
const { writePickupSecret } = require('../../services/order-mutation-service');
const { generateAndStoreSecret } = require('../../services/pickup-secret-issuer');

beforeEach(() => {
  jest.clearAllMocks();
  db.query.mockReset();
  writePickupSecret.mockReset();
});

describe('pickup-secret-issuer', () => {
  test('refuse un appel sans identité de commande ou canal', async () => {
    await expect(generateAndStoreSecret({ channel: 'stripe' })).rejects.toThrow('orderId requis');
    await expect(generateAndStoreSecret({ orderId: 'o1' })).rejects.toThrow('channel requis');
    expect(db.query).not.toHaveBeenCalled();
  });

  test('persiste le secret uniquement via order-mutation-service', async () => {
    db.query.mockResolvedValue({ rows: [] });
    writePickupSecret.mockResolvedValue({});

    const result = await generateAndStoreSecret({ orderId: 'o1', relaisId: 'r1', channel: 'cash_relais' });

    expect(result.code).toMatch(/^[A-Z2-9]{3}-[A-Z2-9]{3}-[A-Z2-9]{2}$/);
    expect(result.last4).toHaveLength(4);
    expect(writePickupSecret).toHaveBeenCalledWith(db, expect.objectContaining({
      orderId: 'o1',
      fields: expect.objectContaining({
        pickup_secret_last4: result.last4,
        pickup_secret_channel: 'cash_relais',
        pickup_secret_attempts: 0,
      }),
    }));
  });
});
