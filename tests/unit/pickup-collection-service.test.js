'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => {
  const query = jest.fn();
  return { query, withTransaction: jest.fn(cb => cb({ query })) };
});
jest.mock('../../services/order-mutation-service', () => ({
  setPickupAttemptsOnly: jest.fn(),
  setPickupAttemptState: jest.fn(),
  setCollectedByName: jest.fn(),
}));
jest.mock('../../services/order-status-machine', () => ({ transitionOrderStatus: jest.fn() }));
jest.mock('../../utils/alerts', () => ({ createAlert: jest.fn() }));
jest.mock('../../services/pickup-collection-recorder', () => ({
  recordCanonicalCollection: jest.fn(),
  mapCanonicalCollectionError: jest.fn(() => null),
}));
jest.mock('../../utils/logger', () => ({ child: () => ({ info: jest.fn(), warn: jest.fn() }) }));

const db = require('../../db');
const { transitionOrderStatus } = require('../../services/order-status-machine');
const { verifyPickupCode, collectOrder } = require('../../services/pickup-collection-service');

beforeEach(() => {
  jest.clearAllMocks();
  db.query.mockReset();
});

describe('pickup-collection-service', () => {
  test('verifyPickupCode refuse un code absent avant toute lecture DB', async () => {
    await expect(verifyPickupCode({ orderId: 'o1', code: '', agentId: 'a1' })).resolves.toEqual({
      status: 400,
      body: { error: 'Code requis' },
    });
    expect(db.query).not.toHaveBeenCalled();
  });

  test('verifyPickupCode ne révèle pas de secret pour une commande inconnue', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const result = await verifyPickupCode({ orderId: 'missing', code: 'ABCD', agentId: 'a1' });
    expect(result).toEqual({ status: 404, body: { error: 'Commande introuvable' } });
  });

  test('collectOrder refuse la voie orderId-only pour une commande available', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'o1', reference: 'ORD-1', status: 'available', relais_id: 'r1' }] });

    const result = await collectOrder({ orderId: 'o1', agentId: 'a1', role: 'relais' });

    expect(result.status).toBe(409);
    expect(result.body.code).toBe('PICKUP_CODE_REQUIRED');
    expect(transitionOrderStatus).not.toHaveBeenCalled();
  });
});
