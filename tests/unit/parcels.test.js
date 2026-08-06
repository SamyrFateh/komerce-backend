'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
jest.mock('../../utils/rules', () => ({ getRule: jest.fn(), getRuleNumber: jest.fn() }));
jest.mock('../../utils/reference', () => ({ generateParcelRef: jest.fn() }));
jest.mock('../../utils/logger', () => ({ child: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() })) }));

const { getRule, getRuleNumber } = require('../../utils/rules');
const { generateParcelRef } = require('../../utils/reference');
const parcels = require('../../utils/parcels');

describe('utils/parcels', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    getRule.mockResolvedValue('default');
    getRuleNumber.mockResolvedValue(1);
    generateParcelRef.mockResolvedValueOnce('P-001').mockResolvedValueOnce('P-002').mockResolvedValueOnce('P-003');
  });

  it('computeOrderStatus couvre les regles canoniques', () => {
    expect(parcels.computeOrderStatus([])).toBeNull();
    expect(parcels.computeOrderStatus([{ status: 'cancelled' }])).toBe('cancelled');
    expect(parcels.computeOrderStatus([{ status: 'collected' }, { status: 'collected' }])).toBe('collected');
    expect(parcels.computeOrderStatus([{ status: 'draft' }, { status: 'draft' }])).toBe('preparation');
    expect(parcels.computeOrderStatus([{ status: 'collected' }, { status: 'shipped' }])).toBe('available');
    expect(parcels.computeOrderStatus([{ status: 'available' }])).toBe('available');
    expect(parcels.computeOrderStatus([{ status: 'shipped' }, { status: 'available' }])).toBe('shipped');
    expect(parcels.computeOrderStatus([{ status: 'arrived' }, { status: 'preparation' }])).toBe('preparation');
    expect(parcels.computeOrderStatus([{ status: 'unknown' }])).toBe('preparation');
  });

  it('computeOrderStatusDetail couvre les details UX client', () => {
    expect(parcels.computeOrderStatusDetail([])).toBe('none');
    expect(parcels.computeOrderStatusDetail([{ status: 'cancelled' }])).toBe('fully_cancelled');
    expect(parcels.computeOrderStatusDetail([{ status: 'collected' }])).toBe('fully_collected');
    expect(parcels.computeOrderStatusDetail([{ status: 'collected' }, { status: 'in_transit' }])).toBe('remaining_in_transit');
    expect(parcels.computeOrderStatusDetail([{ status: 'collected' }, { status: 'available' }])).toBe('partial_collected');
    expect(parcels.computeOrderStatusDetail([{ status: 'available' }, { status: 'shipped' }])).toBe('partial_available');
    expect(parcels.computeOrderStatusDetail([{ status: 'available' }, { status: 'available' }])).toBe('full_available');
    expect(parcels.computeOrderStatusDetail([{ status: 'draft' }, { status: 'preparation' }])).toBe('awaiting_stock');
    expect(parcels.computeOrderStatusDetail([{ status: 'weird' }])).toBe('none');
  });

  it('getOrderStatusDetailMessage mappe les messages client', () => {
    expect(parcels.getOrderStatusDetailMessage('full_available')).toContain('disponible');
    expect(parcels.getOrderStatusDetailMessage('none')).toBeNull();
    expect(parcels.getOrderStatusDetailMessage('missing')).toBeNull();
  });

  it('splitOrderIntoParcels cree un colis standard si tout est disponible', async () => {
    const plan = await parcels.splitOrderIntoParcels([
      { order_item_id: 'oi-1', product_id: 'p1', quantity: 2 },
    ], { p1: 2 }, {});

    expect(plan).toEqual([{ type: 'standard', label: 'Colis complet', reference: 'P-001', items: [expect.objectContaining({ parcel_qty: 2, available_qty: 2 })] }]);
  });

  it('splitOrderIntoParcels cree partial + backorder si dispo partielle', async () => {
    const plan = await parcels.splitOrderIntoParcels([
      { order_item_id: 'oi-1', product_id: 'p1', quantity: 5 },
    ], new Map([['p1', 2]]), {});

    expect(plan).toHaveLength(2);
    expect(plan[0]).toMatchObject({ type: 'partial', reference: 'P-001' });
    expect(plan[0].items[0].parcel_qty).toBe(2);
    expect(plan[1]).toMatchObject({ type: 'backorder', reference: 'P-002' });
    expect(plan[1].items[0].parcel_qty).toBe(3);
  });

  it('splitOrderIntoParcels cree awaiting_stock si rien nest disponible', async () => {
    const plan = await parcels.splitOrderIntoParcels([
      { order_item_id: 'oi-1', product_id: 'p1', quantity: 5 },
    ], {}, {});

    expect(plan).toEqual([{ type: 'awaiting_stock', label: 'En attente de stock', reference: 'P-001', items: [expect.objectContaining({ parcel_qty: 5 })] }]);
  });

  it('splitOrderIntoParcels applique minItemsForPartial et fallback strategie inconnue', async () => {
    getRule.mockResolvedValueOnce('missing_strategy');
    getRuleNumber.mockResolvedValueOnce(2);

    const plan = await parcels.splitOrderIntoParcels([
      { order_item_id: 'oi-1', product_id: 'p1', quantity: 5 },
    ], { p1: 1 }, {});

    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ type: 'backorder', reference: 'P-001' });
    expect(plan[0].items.map(i => i.parcel_qty)).toEqual([4, 1]);
  });

  it('registerStrategy ajoute une strategie custom et valide le type', async () => {
    expect(() => parcels.registerStrategy('bad', null)).toThrow('La stratégie doit être une fonction');

    parcels.registerStrategy('all_standard_test', (items) => [{ type: 'standard', label: 'Custom', items }]);
    expect(parcels.listStrategies()).toContain('all_standard_test');
    getRule.mockResolvedValueOnce('all_standard_test');

    const plan = await parcels.splitOrderIntoParcels([{ order_item_id: 'oi-1', product_id: 'p1', quantity: 1 }], {}, {});
    expect(plan[0]).toMatchObject({ type: 'standard', label: 'Custom', reference: 'P-001' });
  });
});
