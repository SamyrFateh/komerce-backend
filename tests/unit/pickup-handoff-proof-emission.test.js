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
  setPickupAttemptsOnly: jest.fn(), setPickupAttemptState: jest.fn(), setCollectedByName: jest.fn(),
}));
jest.mock('../../services/order-status-machine', () => ({ transitionOrderStatus: jest.fn() }));
jest.mock('../../utils/alerts', () => ({ createAlert: jest.fn() }));
jest.mock('../../services/pickup-collection-recorder', () => ({
  recordCanonicalCollection: jest.fn(async () => ({
    scanId: 'scan-1', parcelId: 'p1', parcelReference: 'P-1', partial: true, orderStatus: 'available', collectedAt: new Date(),
  })),
  mapCanonicalCollectionError: jest.fn(() => null),
}));
jest.mock('../../services/documents/pickup-proof', () => ({ issueForHandoff: jest.fn().mockResolvedValue({}) }));
jest.mock('../../utils/logger', () => ({ child: () => ({ info: jest.fn(), warn: jest.fn() }) }));

const db = require('../../db');
const pickupProof = require('../../services/documents/pickup-proof');
const { hashCode } = require('../../services/pickup-code-helpers');
const { collectByPickupCode } = require('../../services/pickup-collection-service');

const GOOD = 'ABCDEFGH';

beforeEach(() => { jest.clearAllMocks(); db.query.mockReset(); });

describe('émission de la preuve de remise par geste (code 8 caractères)', () => {
  const order = () => ({
    id: 'o1', reference: 'ORD-1', status: 'available', pickup_secret_hash: hashCode(GOOD, 's'), pickup_secret_salt: 's',
    pickup_secret_attempts: 0, pickup_secret_blocked_until: null, pickup_secret_expires_at: null, relais_id: 'r1',
  });

  test('une remise partielle émet une preuve ancrée sur le scan, après commit', async () => {
    db.query.mockResolvedValueOnce({ rows: [order()] }).mockResolvedValue({ rows: [] });
    const r = await collectByPickupCode({ code: GOOD, user: { id: 'u1', role: 'admin' }, expectedOrderId: 'o1' });
    expect(r.status).toBe(200);
    expect(r.body).not.toHaveProperty('_proof');
    expect(pickupProof.issueForHandoff).toHaveBeenCalledTimes(1);
    expect(pickupProof.issueForHandoff).toHaveBeenCalledWith('scan-1', { issuedBy: 'u1' });
  });

  test("un échec d'émission ne casse pas la remise (non bloquant)", async () => {
    pickupProof.issueForHandoff.mockRejectedValueOnce(new Error('boom'));
    db.query.mockResolvedValueOnce({ rows: [order()] }).mockResolvedValue({ rows: [] });
    const r = await collectByPickupCode({ code: GOOD, user: { id: 'u1', role: 'admin' }, expectedOrderId: 'o1' });
    expect(r.status).toBe(200);
  });

  test('un refus (mauvais code) n émet aucune preuve', async () => {
    db.query.mockResolvedValueOnce({ rows: [order()] }).mockResolvedValue({ rows: [] });
    const r = await collectByPickupCode({ code: 'ABCDEFGJ', user: { id: 'u1', role: 'admin' }, expectedOrderId: 'o1' });
    expect(r.status).toBe(401);
    expect(pickupProof.issueForHandoff).not.toHaveBeenCalled();
  });
});
