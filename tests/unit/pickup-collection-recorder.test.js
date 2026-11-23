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
jest.mock('../../services/order-delivery-wave-service', () => ({ closeWaveOnFirstHandoff: jest.fn().mockResolvedValue(true) }));

const {
  recordCanonicalCollection,
  mapCanonicalCollectionError,
} = require('../../services/pickup-collection-recorder');

describe('pickup-collection-recorder — fermeture invisible de vague', () => {
  const { safeSyncScanToParcels } = require('../../utils/parcelSync');
  const { closeWaveOnFirstHandoff } = require('../../services/order-delivery-wave-service');

  beforeEach(() => jest.clearAllMocks());

  test('une remise partielle physiquement prouvée clôture l’admission mais conserve la commande disponible', async () => {
    safeSyncScanToParcels.mockResolvedValue({
      synced: true, parcelsUpdated: 1, orderStatus: 'available', parcelId: 'parcel-1', parcelReference: 'KOM-P-1',
    });
    const client = { query: jest.fn().mockResolvedValue({ rows: [{ id: 'scan-1' }] }) };
    const outcome = await recordCanonicalCollection({
      client, order: { id: 'order-1', reference: 'CM-YAO1-B7Q4-X8', status: 'available', relais_id: 'relay-1' },
      agentId: 'agent-1', role: 'agent_relais', pickupMethod: 'PICKUP_CODE', notes: 'remise contrôlée',
    });
    expect(outcome.partial).toBe(true);
    expect(outcome.orderStatus).toBe('available');
    expect(closeWaveOnFirstHandoff).toHaveBeenCalledTimes(1);
    expect(closeWaveOnFirstHandoff).toHaveBeenCalledWith(client, 'order-1');
  });

  test('une remise exceptionnelle prouvée ferme aussi la vague sans remplacer les preuves nominatives', async () => {
    safeSyncScanToParcels.mockResolvedValue({
      synced: true, parcelsUpdated: 1, orderStatus: 'collected', parcelId: 'parcel-2', parcelReference: 'KOM-P-2',
    });
    const client = { query: jest.fn().mockResolvedValue({ rows: [{ id: 'scan-2' }] }) };
    const outcome = await recordCanonicalCollection({
      client, order: { id: 'order-2', reference: 'CM-YAO1-B7Q4-M2', status: 'available', relais_id: 'relay-1' },
      agentId: 'agent-1', role: 'agent_relais', pickupMethod: 'AUTHORIZED_NAME_ID_CHECK',
      authorizationVersion: 1, documentChecked: true, notes: 'dérogation validée',
    });
    expect(outcome.partial).toBe(false);
    expect(closeWaveOnFirstHandoff).toHaveBeenCalledWith(client, 'order-2');
  });
});

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

  test('échec du synchroniseur sans raison explicite refuse la remise et ne passe pas en fallback legacy', async () => {
    const { safeSyncScanToParcels } = require('../../utils/parcelSync');
    const { transitionOrderStatus } = require('../../services/order-status-machine');
    jest.clearAllMocks();
    safeSyncScanToParcels.mockResolvedValue({ synced:false, parcelsUpdated:0, orderStatus:null });
    const client = { query: jest.fn().mockResolvedValue({ rows:[{ id:'scan-1' }] }) };
    await expect(recordCanonicalCollection({
      client,
      order: { id:'order-1', reference:'E2E-ORDER', relais_id:'relay-1', status:'available' },
      agentId:'agent-1',
      pickupMethod:'PICKUP_CODE',
      notes:'code de retrait valide',
    })).rejects.toThrow('La synchronisation du colis ciblé a échoué');
    expect(transitionOrderStatus).not.toHaveBeenCalled();
    expect(require('../../services/order-delivery-wave-service').closeWaveOnFirstHandoff).not.toHaveBeenCalled();
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
