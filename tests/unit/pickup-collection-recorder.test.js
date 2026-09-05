'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../services/order-mutation-service', () => ({
  finalizePickupCollection: jest.fn(),
  setExceptionalPickupAttemptState: jest.fn(),
}));
jest.mock('../../services/order-status-machine', () => ({ transitionOrderStatus: jest.fn() }));
jest.mock('../../services/pickup-secret-rotation-service', () => ({ rotatePickupSecretAfterPartialCollection: jest.fn() }));
jest.mock('../../utils/parcelSync', () => ({ safeSyncScanToParcels: jest.fn() }));

const {
  recordCanonicalCollection,
  mapCanonicalCollectionError,
} = require('../../services/pickup-collection-recorder');

describe('pickup-collection-recorder', () => {
  test('exige un client transactionnel', async () => {
    await expect(recordCanonicalCollection({
      client: null,
      order: { id: 'o1', status: 'available' },
      pickupMethod: 'PICKUP_CODE',
    })).rejects.toThrow('client transactionnel requis');
  });

  test('refuse une commande qui n’est pas physiquement disponible', async () => {
    const client = { query: jest.fn() };
    await expect(recordCanonicalCollection({
      client,
      order: { id: 'o1', status: 'shipped' },
      pickupMethod: 'PICKUP_CODE',
    })).rejects.toThrow('commande non disponible');
    expect(client.query).not.toHaveBeenCalled();
  });

  test('exige la preuve nominative complète pour le retrait exceptionnel', async () => {
    const client = { query: jest.fn() };
    await expect(recordCanonicalCollection({
      client,
      order: { id: 'o1', status: 'available' },
      pickupMethod: 'AUTHORIZED_NAME_ID_CHECK',
      authorizationVersion: null,
      documentChecked: false,
    })).rejects.toThrow('preuve nominative incomplète');
  });

  test('mappe les conflits canoniques en 409 sans masquer les erreurs inconnues', () => {
    const err = new Error('aucun colis');
    err.code = 'NO_PARCEL_AVAILABLE';
    expect(mapCanonicalCollectionError(err)).toEqual({
      status: 409,
      body: { error: 'aucun colis', code: 'NO_PARCEL_AVAILABLE' },
    });
    expect(mapCanonicalCollectionError(new Error('boom'))).toBeNull();
  });
});
