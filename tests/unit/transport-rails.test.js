'use strict';

const {
  TRANSPORT_RAILS,
  TransportRailError,
  getTransportRail,
  isTransportRailCommerciallyExposed,
  assertTransportRailCommerciallyExposed,
  listCommercialTransportRails,
} = require('../../services/transport-rails');

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
