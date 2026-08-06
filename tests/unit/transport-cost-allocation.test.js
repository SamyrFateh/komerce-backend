'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const {
  makeClient,
  expectTransactionCommitted,
  expectTransactionRolledBack,
} = require('../integration/test-harness/mock-db');

jest.mock('../../db', () => ({
  query: jest.fn(),
  pool: { connect: jest.fn() },
}));

const db = require('../../db');
const {
  ALLOCATION_KEYS,
  TransportCostAllocationError,
  getTransportCostAllocationRule,
  getAllocationWeight,
  allocateTransportCost,
  resolveShipmentTransportRail,
  allocateShipmentRealCosts,
} = require('../../services/transport-cost-allocation');

beforeEach(() => jest.clearAllMocks());

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

    expect(shares.map(share => share.id)).toEqual(['dense', 'bulky']);
    expect(shares.reduce((sum, share) => sum + share.share, 0)).toBe(100000);
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

  test('shipment transport mode maps only explicit sea/air rails', () => {
    expect(resolveShipmentTransportRail('sea')).toBe('SEA_STANDARD');
    expect(resolveShipmentTransportRail('air')).toBe('AIR_EXPRESS');
    expect(resolveShipmentTransportRail(null)).toBeNull();
    expect(resolveShipmentTransportRail('land')).toBeNull();
  });

  test('AIR shipment without calibration rolls back before freight persistence', async () => {
    const shipment = {
      id: 'ship-air',
      customs_paid_kmf: '0',
      freight_kmf: '1000',
      allocation_method: 'by_cif_value',
      transport_mode: 'air',
    };
    const parcel = {
      parcel_id: 'parcel-air',
      order_id: 'order-air',
      parcel_cif_kmf: '1000',
      parcel_weight_kg: '2',
      parcel_volume_cm3: '12000',
      customs_share_kmf: null,
    };
    const client = makeClient([
      { rows: [shipment] },
      { rows: [parcel] },
      { rows: [], rowCount: 0 },
    ]);
    db.pool.connect.mockResolvedValue(client);

    await expect(allocateShipmentRealCosts('ship-air')).rejects.toMatchObject({
      code: 'TRANSPORT_COST_ALLOCATION_CALIBRATION_PENDING',
    });

    expectTransactionRolledBack(client);
    expect(client.query.mock.calls.some(call => call[0].includes("'freight'"))).toBe(false);
  });

  test('calibrated AIR shipment persists freight by chargeable weight', async () => {
    const shipment = {
      id: 'ship-air',
      customs_paid_kmf: '0',
      freight_kmf: '1000',
      allocation_method: 'by_cif_value',
      transport_mode: 'air',
    };
    const parcelA = {
      parcel_id: 'parcel-A', order_id: 'order-A', parcel_cif_kmf: '1000',
      parcel_weight_kg: '10', parcel_volume_cm3: '10000', customs_share_kmf: null,
    };
    const parcelB = {
      parcel_id: 'parcel-B', order_id: 'order-B', parcel_cif_kmf: '1000',
      parcel_weight_kg: '2', parcel_volume_cm3: '300000', customs_share_kmf: null,
    };
    const itemA = {
      order_item_id: 'oi-A', parcel_qty: '1', product_id: 'prod-A',
      weight_kg: '10', volume_cm3: '10000', cost_kmf: '1000',
    };
    const itemB = {
      order_item_id: 'oi-B', parcel_qty: '1', product_id: 'prod-B',
      weight_kg: '2', volume_cm3: '300000', cost_kmf: '1000',
    };
    const client = makeClient([
      { rows: [shipment] },
      { rows: [parcelA, parcelB] },
      { rows: [], rowCount: 0 },
      { rows: [itemA] },
      { rows: [], rowCount: 1 },
      { rows: [itemB] },
      { rows: [], rowCount: 1 },
    ]);
    db.pool.connect.mockResolvedValue(client);

    const result = await allocateShipmentRealCosts('ship-air', null, {
      transport_cost_allocation: { volumetric_factor_kg_per_m3: 100 },
    });

    expect(result.transport_rail).toBe('AIR_EXPRESS');
    expect(result.freight_allocation_method).toBe('by_taxable_weight');

    const freightInsertA = client.query.mock.calls.find(
      call => call[0].includes("'freight'") && call[1][2] === 'parcel-A'
    );
    const freightInsertB = client.query.mock.calls.find(
      call => call[0].includes("'freight'") && call[1][2] === 'parcel-B'
    );

    expect(freightInsertA[1][4]).toBe(250);
    expect(freightInsertB[1][4]).toBe(750);
    expect(freightInsertA[1][5]).toBe('by_taxable_weight');
    expectTransactionCommitted(client);
  });
});
