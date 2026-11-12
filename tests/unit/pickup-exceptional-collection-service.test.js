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
jest.mock('../../services/order-mutation-service', () => ({ setExceptionalPickupAttemptState: jest.fn() }));
jest.mock('../../utils/name-normalize', () => ({ namesMatch: jest.fn() }));
jest.mock('../../services/pickup-authorization-service', () => ({
  getActiveAuthorizationForUpdate: jest.fn(),
  hasActiveAuthorization: jest.fn(),
}));
jest.mock('../../services/notifications/notification-service', () => ({ notifyText: jest.fn() }));
jest.mock('../../services/pickup-collection-recorder', () => ({
  recordCanonicalCollection: jest.fn(),
  mapCanonicalCollectionError: jest.fn(() => null),
}));
jest.mock('../../services/pickup-collection-service', () => ({ _logSecurityAlert: jest.fn() }));
jest.mock('../../services/documents/pickup-proof', () => ({ issueForHandoff: jest.fn().mockResolvedValue({}) }));
jest.mock('../../utils/logger', () => ({ child: () => ({ info: jest.fn(), warn: jest.fn() }) }));

const db = require('../../db');
const { hasActiveAuthorization } = require('../../services/pickup-authorization-service');
const { getExceptionalPickupAvailability, collectByAuthorizedName } = require('../../services/pickup-exceptional-collection-service');
const { getActiveAuthorizationForUpdate } = require('../../services/pickup-authorization-service');
const { namesMatch } = require('../../utils/name-normalize');
const { recordCanonicalCollection } = require('../../services/pickup-collection-recorder');
const pickupProof = require('../../services/documents/pickup-proof');

beforeEach(() => {
  jest.clearAllMocks();
  db.query.mockReset();
  hasActiveAuthorization.mockReset();
});

describe('pickup-exceptional-collection-service', () => {
  test('ne propose jamais la procédure si la commande n’est pas prête', async () => {
    db.query.mockResolvedValueOnce({ rows: [{
      id: 'o1', status: 'shipped', relais_id: 'r1', user_id: 'u1', exceptional_pickup_blocked_until: null,
    }] });

    await expect(getExceptionalPickupAvailability({ orderId: 'o1', agentId: 'a1', role: 'admin' }))
      .resolves.toEqual({ status: 200, body: { available: false, reason: 'ORDER_NOT_READY' } });
    expect(hasActiveAuthorization).not.toHaveBeenCalled();
  });

  test('bloque un agent d’un autre relais sans révéler le nom autorisé', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{
        id: 'o1', status: 'available', relais_id: 'r1', user_id: 'u1', exceptional_pickup_blocked_until: null,
      }] })
      .mockResolvedValueOnce({ rows: [{ relais_id: 'r2' }] });

    const result = await getExceptionalPickupAvailability({ orderId: 'o1', agentId: 'a1', role: 'relais' });

    expect(result).toEqual({ status: 200, body: { available: false, reason: 'CROSS_RELAIS' } });
    expect(JSON.stringify(result)).not.toContain('given');
    expect(hasActiveAuthorization).not.toHaveBeenCalled();
  });

  test('retourne NO_ACTIVE_AUTHORIZATION sans détail nominatif', async () => {
    db.query.mockResolvedValueOnce({ rows: [{
      id: 'o1', status: 'available', relais_id: 'r1', user_id: 'u1', exceptional_pickup_blocked_until: null,
    }] });
    hasActiveAuthorization.mockResolvedValueOnce(false);

    await expect(getExceptionalPickupAvailability({ orderId: 'o1', agentId: 'admin', role: 'admin' }))
      .resolves.toEqual({ status: 200, body: { available: false, reason: 'NO_ACTIVE_AUTHORIZATION' } });
  });
});

describe('preuve de remise par geste (retrait nominatif exceptionnel, #3927 trou 2)', () => {
  const available = () => ({ id: 'o1', reference: 'ORD-1', status: 'available', relais_id: 'r1', user_id: 'u1', exceptional_pickup_attempts: 0 });

  test('une remise émet la preuve ancrée sur le scan, après commit', async () => {
    db.query.mockResolvedValueOnce({ rows: [available()] });
    getActiveAuthorizationForUpdate.mockResolvedValueOnce({ version: 2, normalizedGivenNames: 'a', normalizedFamilyName: 'b' });
    namesMatch.mockReturnValueOnce(true);
    recordCanonicalCollection.mockResolvedValueOnce({ scanId: 'scan-9', parcelId: 'p1', parcelReference: 'P-1', partial: false, orderStatus: 'collected' });

    const r = await collectByAuthorizedName({ orderId: 'o1', agentId: 'a1', role: 'admin', givenNames: 'A', familyName: 'B', documentChecked: true });

    expect(r.status).toBe(200);
    expect(r).not.toHaveProperty('_handoffScanId');
    expect(pickupProof.issueForHandoff).toHaveBeenCalledWith('scan-9', { issuedBy: 'a1' });
  });

  test('un refus (nom non concordant) n’émet aucune preuve', async () => {
    db.query.mockResolvedValueOnce({ rows: [available()] });
    getActiveAuthorizationForUpdate.mockResolvedValueOnce({ version: 2, normalizedGivenNames: 'a', normalizedFamilyName: 'b' });
    namesMatch.mockReturnValueOnce(false);

    const r = await collectByAuthorizedName({ orderId: 'o1', agentId: 'a1', role: 'admin', givenNames: 'X', familyName: 'Y', documentChecked: true });

    expect(r.status).toBe(401);
    expect(pickupProof.issueForHandoff).not.toHaveBeenCalled();
  });
});
