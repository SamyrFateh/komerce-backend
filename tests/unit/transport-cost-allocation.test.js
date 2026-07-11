'use strict';

const {
  ALLOCATION_KEYS,
  TransportCostAllocationError,
  getTransportCostAllocationRule,
  getAllocationWeight,
  allocateTransportCost,
} = require('../../services/transport-cost-allocation');

describe('transport cost allocation', () => {
  test('SEA freight uses volume and exposes equal-split fallback', () => {
    expect(getTransportCostAllocationRule('SEA_STANDARD', 'FREIGHT')).toMatchObject({
      allocation_key: 'VOLUME',
      fallback_key: 'EQUAL_SPLIT',
      calibration_status: 'ACTIVE',
    });
  });

  test('AIR freight is modeled on chargeable weight but remains pending', () => {
    expect(getTransportCostAllocationRule('AIR_EXPRESS', 'FREIGHT')).toMatchObject({
      allocation_key: 'CHARGEABLE_WEIGHT',
      calibration_status: 'PENDING',
      volumetric_factor_kg_per_m3: null,
    });
  });

  test('chargeable weight is max(actual, volumetric) when factor is explicit', () => {
    expect(getAllocationWeight(
      { actual_weight_kg: 20, volume_m3: 0.2 },
      ALLOCATION_KEYS.CHARGEABLE_WEIGHT,
      { volumetric_factor_kg_per_m3: 167 }
    )).toBeCloseTo(33.4, 6);
  });

  test('AIR default allocation fails closed while calibration is pending', () => {
    expect(() => allocateTransportCost({
      total: 100000,
      transport_rail: 'AIR_EXPRESS',
      component: 'FREIGHT',
      entries: [{ id: 'p1', actual_weight_kg: 10, volume_m3: 0.1 }],
    })).toThrow(TransportCostAllocationError);

    expect(() => allocateTransportCost({
      total: 100000,
      transport_rail: 'AIR_EXPRESS',
      component: 'FREIGHT',
      entries: [{ id: 'p1', actual_weight_kg: 10, volume_m3: 0.1 }],
    })).toThrow('en attente de calibration');
  });

  test('explicit calibrated AIR allocation distributes by chargeable weight', () => {
    const shares = allocateTransportCost({
      total: 100000,
      transport_rail: 'AIR_EXPRESS',
      component: 'FREIGHT',
      allocation_key: 'CHARGEABLE_WEIGHT',
      options: { volumetric_factor_kg_per_m3: 167 },
      entries: [
        { id: 'dense', actual_weight_kg: 50, volume_m3: 0.1 },
        { id: 'bulky', actual_weight_kg: 10, volume_m3: 0.3 },
      ],
    });

    expect(shares.map(s => s.id)).toEqual(['dense', 'bulky']);
    expect(shares.reduce((sum, s) => sum + s.share, 0)).toBe(100000);
    expect(shares[1].share).toBeGreaterThan(shares[0].share);
  });

  test('SEA missing volume falls back to equal split instead of weight', () => {
    const shares = allocateTransportCost({
      total: 90000,
      transport_rail: 'SEA_STANDARD',
      component: 'FREIGHT',
      entries: [
        { id: 'heavy', actual_weight_kg: 100, volume_m3: 0 },
        { id: 'light', actual_weight_kg: 1, volume_m3: 0 },
      ],
    });

    expect(shares).toEqual([
      { id: 'heavy', share: 45000, share_pct: 50 },
      { id: 'light', share: 45000, share_pct: 50 },
    ]);
  });

  test('direct assignment requires one target', () => {
    expect(() => allocateTransportCost({
      total: 1000,
      transport_rail: 'AIR_EXPRESS',
      component: 'FREIGHT',
      allocation_key: 'DIRECT_ASSIGNMENT',
      entries: [{ id: 'a' }, { id: 'b' }],
    })).toThrow('cible unique');
  });
});
