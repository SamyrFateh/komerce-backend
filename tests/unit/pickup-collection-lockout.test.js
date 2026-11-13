'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../services/pickup-agent-lockout', () => ({
  checkAgentLockout: jest.fn(async () => ({ locked: false })),
  recordAgentFailure: jest.fn(async () => ({ count: 1, justLocked: false })),
}));
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
  recordCanonicalCollection: jest.fn(async () => ({
    parcelId: 'p1', parcelReference: 'P-1', partial: false, orderStatus: 'collected', collectedAt: new Date(),
  })),
  mapCanonicalCollectionError: jest.fn(() => null),
}));
jest.mock('../../utils/logger', () => ({ child: () => ({ info: jest.fn(), warn: jest.fn() }) }));

const db = require('../../db');
const { setPickupAttemptState } = require('../../services/order-mutation-service');
const { hashCode } = require('../../services/pickup-code-helpers');
const { collectByPickupCode } = require('../../services/pickup-collection-service');

const GOOD = 'ABCDEFGH';
const BAD = 'ABCDEFGJ';
const SALT = 'salt';
const ADMIN = { id: 'u1', role: 'admin' };

function order(extra = {}) {
  return {
    id: 'o1', reference: 'ORD-1', pickup_secret_hash: hashCode(GOOD, SALT), pickup_secret_salt: SALT,
    pickup_secret_attempts: 0, pickup_secret_blocked_until: null, pickup_secret_expires_at: null,
    relais_id: 'r1', ...extra,
  };
}

beforeEach(() => { jest.clearAllMocks(); db.query.mockReset(); });

describe('collectByPickupCode — verrouillage des mauvais codes (#3927 trou 9)', () => {
  test('un mauvais code ciblé incrémente le compteur dans la transaction', async () => {
    db.query.mockResolvedValueOnce({ rows: [order({ pickup_secret_attempts: 1 })] }).mockResolvedValue({ rows: [] });
    const r = await collectByPickupCode({ code: BAD, user: ADMIN, expectedOrderId: 'o1' });
    expect(r.status).toBe(401);
    expect(r.body).toMatchObject({ attempts: 2, remaining: 1 });
    expect(setPickupAttemptState).toHaveBeenCalledWith(expect.anything(), { orderId: 'o1', attempts: 2, blockedUntil: null });
  });

  test('le 3e mauvais code bloque la commande', async () => {
    db.query.mockResolvedValueOnce({ rows: [order({ pickup_secret_attempts: 2 })] }).mockResolvedValue({ rows: [] });
    const r = await collectByPickupCode({ code: BAD, user: ADMIN, expectedOrderId: 'o1' });
    expect(r.status).toBe(401);
    const arg = setPickupAttemptState.mock.calls[0][1];
    expect(arg.attempts).toBe(3);
    expect(arg.blockedUntil).toBeInstanceOf(Date);
    expect(arg.blockedUntil.getTime()).toBeGreaterThan(Date.now());
  });

  test('une commande bloquée refuse même le bon code, sans mutation', async () => {
    db.query.mockResolvedValueOnce({ rows: [order({ pickup_secret_attempts: 3, pickup_secret_blocked_until: new Date(Date.now() + 600000) })] });
    const r = await collectByPickupCode({ code: GOOD, user: ADMIN, expectedOrderId: 'o1' });
    expect(r.status).toBe(429);
    expect(setPickupAttemptState).not.toHaveBeenCalled();
  });

  test('après échéance, le bon code passe et le compteur est remis à zéro', async () => {
    db.query.mockResolvedValueOnce({ rows: [order({ pickup_secret_attempts: 3, pickup_secret_blocked_until: new Date(Date.now() - 1000) })] }).mockResolvedValue({ rows: [] });
    const r = await collectByPickupCode({ code: GOOD, user: ADMIN, expectedOrderId: 'o1' });
    expect(r.status).toBe(200);
    expect(setPickupAttemptState).toHaveBeenCalledWith(expect.anything(), { orderId: 'o1', attempts: 0, blockedUntil: null });
  });
});
