'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const {
  TRANSPORT_RAILS,
  TransportRailError,
  getTransportRail,
  getTransportRailPackingProfile,
  buildParcelsForTransportRail,
  isTransportRailCommerciallyExposed,
  assertTransportRailCommerciallyExposed,
  listCommercialTransportRails,
} = require('../../services/transport-rails');

function item(overrides = {}) {
  return {
    unit_weight: 1,
    unit_volume: 1000,
    unit_value: 1000,
    quantity_available: 1,
    is_fragile: false,
    is_bulky: false,
    category: null,
    ...overrides,
  };
}

describe('transport rails', () => {
  test('AIR_EXPRESS is materialized with DXB > ADD > HAH but remains internal and pricing pending', () => {
    expect(getTransportRail('air_express')).toEqual(TRANSPORT_RAILS.AIR_EXPRESS);
    expect(TRANSPORT_RAILS.AIR_EXPRESS).toMatchObject({
      corridor: ['DXB', 'ADD', 'HAH'],
      capacity_status: 'INTERNAL',
      pricing_status: 'PENDING',
      commercial_exposure: 'DISABLED',
    });
  });

  test('absence of a rail remains explicitly UNASSIGNED instead of defaulting to SEA_STANDARD', () => {
    expect(getTransportRail(null)).toBeNull();
    expect(getTransportRail('')).toBeNull();
  });

  test('unknown rail codes fail closed', () => {
    expect(() => getTransportRail('road_fast')).toThrow(TransportRailError);
    expect(() => getTransportRail('road_fast')).toThrow('Rail de transport inconnu');
  });

  test('AIR_EXPRESS cannot be commercially exposed while pricing is pending', () => {
    expect(isTransportRailCommerciallyExposed('AIR_EXPRESS')).toBe(false);
    expect(() => assertTransportRailCommerciallyExposed('AIR_EXPRESS'))
      .toThrow('non commercialisable');
  });

  test('only SEA_STANDARD is commercially exposed in the initial registry', () => {
    expect(listCommercialTransportRails().map(rail => rail.code)).toEqual(['SEA_STANDARD']);
    expect(assertTransportRailCommerciallyExposed('SEA_STANDARD').code).toBe('SEA_STANDARD');
  });
});

describe('packing profiles by transport rail', () => {
  test('SEA_STANDARD exposes the historical packing limits', () => {
    expect(getTransportRailPackingProfile('SEA_STANDARD')).toMatchObject({
      maxParcelWeightKg: 25,
      maxParcelVolumeCm3: 100000,
      targetParcelValueKmf: 300000,
    });
  });

  test('AIR_EXPRESS fails closed while its packing profile is pending', () => {
    expect(() => getTransportRailPackingProfile('AIR_EXPRESS')).toThrow(expect.objectContaining({
      code: 'TRANSPORT_RAIL_PACKING_PROFILE_PENDING',
    }));
  });

  test('UNASSIGNED can still execute legacy packing without silently choosing SEA', () => {
    const result = buildParcelsForTransportRail({
      transportRailCode: null,
      items: [item()],
    });
    expect(result.createdParcels).toHaveLength(1);
  });

  test('SEA_STANDARD executes packing through its active profile', () => {
    const result = buildParcelsForTransportRail({
      transportRailCode: 'SEA_STANDARD',
      items: [item()],
    });
    expect(result.createdParcels).toHaveLength(1);
  });

  test('AIR_EXPRESS never inherits SEA packing limits implicitly', () => {
    expect(() => buildParcelsForTransportRail({
      transportRailCode: 'AIR_EXPRESS',
      items: [item()],
    })).toThrow(expect.objectContaining({
      code: 'TRANSPORT_RAIL_PACKING_PROFILE_PENDING',
    }));
  });
});