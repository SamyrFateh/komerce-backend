'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/parcel-service.test.js
 *
 * Tests de services/parcel-service.js
 *
 * Couverture (invariants métier critiques sur le pipeline de statuts colis) :
 *   ✓ PARCEL_TRANSITIONS : couvre exactement tous les PARCEL_VALID_STATUSES, pas plus, pas moins
 *   ✓ PARCEL_TRANSITIONS : toute transition cible un statut lui-même valide (pas de typo)
 *   ✓ PARCEL_TRANSITIONS : les statuts terminaux (collected, cancelled) n'ont aucune transition sortante
 *   ✓ PARCEL_TRANSITIONS : "cancelled" est atteignable depuis tout statut non-terminal (sécurité annulation)
 *   ✓ PARCEL_SMS : génère les messages attendus pour shipped/available/collected
 *   ✓ Re-exports : les fonctions/constantes de utils/parcels sont bien ré-exposées telles quelles
 */

const parcelService = require('../../services/parcel-service');
const utilsParcels = require('../../utils/parcels');

describe('parcel-service — PARCEL_TRANSITIONS (matrice de pipeline)', () => {
  const { PARCEL_VALID_STATUSES, PARCEL_TRANSITIONS } = parcelService;

  it('a une entrée pour chaque statut valide, et uniquement ceux-là', () => {
    expect(Object.keys(PARCEL_TRANSITIONS).sort()).toEqual([...PARCEL_VALID_STATUSES].sort());
  });

  it('ne référence que des statuts cibles eux-mêmes valides', () => {
    for (const [status, nextStatuses] of Object.entries(PARCEL_TRANSITIONS)) {
      for (const next of nextStatuses) {
        expect(PARCEL_VALID_STATUSES).toContain(next);
      }
    }
  });

  it('les statuts terminaux n\'ont aucune transition sortante', () => {
    expect(PARCEL_TRANSITIONS.collected).toEqual([]);
    expect(PARCEL_TRANSITIONS.cancelled).toEqual([]);
  });

  it('"cancelled" est atteignable depuis tout statut non-terminal', () => {
    for (const [status, nextStatuses] of Object.entries(PARCEL_TRANSITIONS)) {
      if (status === 'collected' || status === 'cancelled') continue;
      expect(nextStatuses).toContain('cancelled');
    }
  });
});

describe('parcel-service — PARCEL_SMS', () => {
  it('shipped : message générique sans nom de relais', () => {
    const msg = parcelService.PARCEL_SMS.shipped('KOM-P-001');
    expect(msg).toContain('KOM-P-001');
    expect(msg).toMatch(/expedie/);
  });

  it('available : inclut le nom du relais quand fourni', () => {
    const msg = parcelService.PARCEL_SMS.available('KOM-P-001', 'Relais Moroni');
    expect(msg).toContain('KOM-P-001');
    expect(msg).toContain('Relais Moroni');
  });

  it('available : ne crashe pas si le relais est absent', () => {
    const msg = parcelService.PARCEL_SMS.available('KOM-P-001');
    expect(msg).toContain('relais ');
    expect(msg).not.toMatch(/undefined/);
  });

  it('collected : message de remise', () => {
    const msg = parcelService.PARCEL_SMS.collected('KOM-P-001');
    expect(msg).toContain('KOM-P-001');
    expect(msg).toMatch(/remis/);
  });
});

describe('parcel-service — re-exports depuis utils/parcels', () => {
  it('ré-expose exactement les mêmes références de fonctions', () => {
    expect(parcelService.computeOrderStatus).toBe(utilsParcels.computeOrderStatus);
    expect(parcelService.splitOrderIntoParcels).toBe(utilsParcels.splitOrderIntoParcels);
    expect(parcelService.registerStrategy).toBe(utilsParcels.registerStrategy);
    expect(parcelService.listStrategies).toBe(utilsParcels.listStrategies);
  });

  it('ré-expose les mêmes constantes', () => {
    expect(parcelService.PARCEL_TYPES).toBe(utilsParcels.PARCEL_TYPES);
    expect(parcelService.PARCEL_STATUSES).toBe(utilsParcels.PARCEL_STATUSES);
    expect(parcelService.STATUS_WEIGHT).toBe(utilsParcels.STATUS_WEIGHT);
    expect(parcelService.STRATEGIES).toBe(utilsParcels.STRATEGIES);
  });
});
