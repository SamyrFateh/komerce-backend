'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));

const projection = require('../../services/logistics-control-tower-projection');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('logistics-control-tower-projection', () => {
  test('le statut colis est projeté sans inventer un lifecycle dashboard', () => {
    expect(projection.stageForParcel({ parcel_status: 'preparation' })).toBe('HUB_CONTROL');
    expect(projection.stageForParcel({ parcel_status: 'shipped' })).toBe('FORWARDER');
    expect(projection.stageForParcel({ parcel_status: 'in_transit' })).toBe('TRANSPORT');
    expect(projection.stageForParcel({ parcel_status: 'in_transit', customs_confirmed: true })).toBe('CUSTOMS');
    expect(projection.stageForParcel({ parcel_status: 'available' })).toBe('RELAY');
    expect(projection.stageForParcel({ parcel_status: 'collected' })).toBe('DELIVERED');
  });

  test('une commande splittée reste gouvernée par la branche nécessaire la moins avancée', () => {
    const order = { id: 'o1', status: 'preparation' };
    const item = { id: 'i1', quantity: 4, fulfillment_source: 'IMPORT' };
    const parcels = [{
      order_item_id: 'i1',
      quantity: 3,
      parcel_id: 'p1',
      parcel_reference: 'KOM-BOX-1',
      parcel_status: 'in_transit',
    }];
    const purchase = [{
      line_id: 'l1',
      order_item_id: 'i1',
      purchase_order_id: 'po1',
      po_status: 'hub_received',
      effective_quantity: 4,
      received_quantity: 4,
      cancelled: false,
    }];
    // 4 unités sont encore représentées dans la custody : 3 déjà encapsulées
    // downstream + 1 restante au contrôle Hub.
    const hub = [{
      order_item_id: 'i1',
      quantity: 4,
      unit_reference: 'KOM-RCV-1',
      unit_state: 'QUALITY_CHECKED',
    }];

    const segments = projection.allocateSegments(4, item, { order, parcels, purchase, hub });

    expect(segments).toEqual(expect.arrayContaining([
      expect.objectContaining({ stage: 'TRANSPORT', quantity: 3 }),
      expect.objectContaining({ stage: 'HUB_CONTROL', quantity: 1 }),
    ]));
    expect(projection.deriveOrderStage({ order, items: [item], purchase, parcels, hub }))
      .toBe('HUB_CONTROL');
  });

  test('retard et blocage restent une dimension health distincte de current_stage', () => {
    expect(projection.deriveHealth({
      incidents: [{ id: 'inc-1', severity: 'medium', incident_type: 'delay' }],
    })).toEqual(expect.objectContaining({ health: 'ORANGE', reason_code: 'delay' }));

    expect(projection.deriveHealth({
      signals: [{ id: 'sig-1', severity: 'critical', signal_type: 'supplier_payment_blocked' }],
    })).toEqual(expect.objectContaining({ health: 'RED', reason_code: 'supplier_payment_blocked' }));

    expect(projection.deriveHealth()).toEqual(expect.objectContaining({
      health: 'GREEN', reason_code: null,
    }));
  });

  test('un import commandé sans couverture reste à PURCHASING, jamais faussement vert en aval', () => {
    const order = { id: 'o1', status: 'ordered' };
    const item = { id: 'i1', quantity: 2, fulfillment_source: 'IMPORT' };
    const segments = projection.allocateSegments(2, item, {
      order, parcels: [], purchase: [], hub: [],
    });
    expect(segments).toEqual([
      expect.objectContaining({ stage: 'PURCHASING', quantity: 2 }),
    ]);
  });

  test('la projection Market retourne une seule ligne niveau 1 par commande et conserve les branches au drill-down', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{
        id: 'o1', reference: 'K-104829', status: 'preparation',
        payment_status: 'paid', created_at: '2026-10-06T10:00:00Z',
      }] })
      .mockResolvedValueOnce({ rows: [{
        id: 'i1', order_id: 'o1', quantity: 4, fulfillment_source: 'IMPORT',
      }] })
      .mockResolvedValueOnce({ rows: [{
        line_id: 'l1', order_item_id: 'i1', order_id: 'o1',
        purchase_order_id: 'po1', po_status: 'hub_received',
        effective_quantity: 4, received_quantity: 4, cancelled: false,
      }] })
      .mockResolvedValueOnce({ rows: [{
        order_item_id: 'i1', quantity: 3, parcel_id: 'p1',
        parcel_reference: 'KOM-BOX-1', parcel_status: 'in_transit',
        customs_cleared_at: null, customs_confirmed: false,
      }] })
      .mockResolvedValueOnce({ rows: [{
        order_id: 'o1', order_item_id: 'i1', unit_id: 'u1',
        unit_reference: 'KOM-RCV-1', unit_state: 'QUALITY_CHECKED', quantity: 4,
      }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await projection.buildMarketControlTower({
      marketId: '11111111-1111-1111-1111-111111111111',
      marketCode: 'KM',
    });

    expect(result.scope.market.code).toBe('KM');
    expect(result.orders).toHaveLength(1);
    expect(result.orders[0]).toEqual(expect.objectContaining({
      order_reference: 'K-104829',
      current_stage: 'HUB_CONTROL',
      health: 'GREEN',
    }));
    expect(result.orders[0].branches).toHaveLength(1);

    const hubStage = result.stages.find(stage => stage.key === 'HUB_CONTROL');
    expect(hubStage.orders).toEqual([
      expect.objectContaining({ order_reference: 'K-104829', health: 'GREEN' }),
    ]);
    expect(result.stages.flatMap(stage => stage.orders)
      .filter(row => row.order_reference === 'K-104829')).toHaveLength(1);

    const [ordersSql, ordersParams] = mockQuery.mock.calls[0];
    expect(ordersSql).toContain('WHERE market_id = $1');
    expect(ordersParams[0]).toBe('11111111-1111-1111-1111-111111111111');
  });
});
