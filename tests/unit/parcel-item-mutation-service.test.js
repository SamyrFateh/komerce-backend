'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
const {
  assignWholeOrderItemToParcel,
  assignParcelItem,
  addParcelItem,
  removeParcelItem,
  assignSingleOrderItemToParcel,
  assignPhysicalAllocationToParcel,
} = require('../../services/parcel-item-mutation-service');

describe('parcel-item-mutation-service', () => {
  test('assignWholeOrderItemToParcel utilise le même executor et garde la garde order_id', async () => {
    const executor = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    await assignWholeOrderItemToParcel(executor, { parcelId: 'parcel-1', orderItemId: 'item-1', orderId: 'order-1' });
    expect(executor.query.mock.calls[0][0]).toContain('oi.order_id = $3');
    expect(executor.query.mock.calls[0][1]).toEqual(['parcel-1', 'item-1', 'order-1']);
  });

  test('assignParcelItem conserve les valeurs résolues par l’appelant', async () => {
    const executor = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    await assignParcelItem(executor, { parcelId: 'parcel-1', orderItemId: 'item-1', productId: 'product-1', quantity: 3 });
    expect(executor.query.mock.calls[0][1]).toEqual(['parcel-1', 'item-1', 'product-1', 3]);
  });

  test('addParcelItem retourne la ligne créée', async () => {
    const executor = { query: jest.fn().mockResolvedValue({ rows: [{ id: 'pi-1' }], rowCount: 1 }) };
    await expect(addParcelItem(executor, { parcelId: 'parcel-1', orderItemId: 'item-1', productId: 'product-1', quantity: 2 }))
      .resolves.toEqual({ id: 'pi-1' });
  });

  test('removeParcelItem retourne la ligne supprimée', async () => {
    const executor = { query: jest.fn().mockResolvedValue({ rows: [{ id: 'pi-1' }], rowCount: 1 }) };
    await expect(removeParcelItem(executor, { parcelId: 'parcel-1', orderItemId: 'item-1' }))
      .resolves.toEqual({ id: 'pi-1' });
  });

  test('assignSingleOrderItemToParcel conserve quantity=1 pour legacy', async () => {
    const executor = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    await assignSingleOrderItemToParcel(executor, { parcelId: 'parcel-1', orderItemId: 'item-1' });
    expect(executor.query.mock.calls[0][0]).toContain('oi.product_id, 1');
  });

  test('HUB-001 réutilise un plan parcel_items déjà complet sans double compter le scan', async () => {
    const executor = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'oi-1', order_id: 'o-1', product_id: 'prod-1', quantity: 2 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'pi-plan', parcel_id: 'p-1', quantity: 2, status: 'preparation' }] }) };

    const result = await assignPhysicalAllocationToParcel(executor, { parcelId: 'p-1', orderItemId: 'oi-1', quantity: 1 });
    expect(result).toEqual({ parcel_item_id: 'pi-plan', created: false, planned_quantity: 2 });
    expect(executor.query).toHaveBeenCalledTimes(2);
  });

  test('HUB-001 augmente un plan partiel jusqu’au reliquat commercial', async () => {
    const executor = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'oi-1', order_id: 'o-1', product_id: 'prod-1', quantity: 3 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'pi-1', parcel_id: 'p-1', quantity: 1, status: 'preparation' }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) };

    const result = await assignPhysicalAllocationToParcel(executor, { parcelId: 'p-1', orderItemId: 'oi-1', quantity: 1 });
    expect(result).toMatchObject({ parcel_item_id: 'pi-1', created: false, planned_quantity: 2 });
    expect(executor.query.mock.calls[2][1]).toEqual(['pi-1', 1]);
  });

  test('HUB-001 refuse de déplacer implicitement un order_item déjà planifié dans un autre colis', async () => {
    const executor = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'oi-1', order_id: 'o-1', product_id: 'prod-1', quantity: 2 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'pi-1', parcel_id: 'p-old', quantity: 2, status: 'preparation' }] }) };

    await expect(assignPhysicalAllocationToParcel(executor, { parcelId: 'p-new', orderItemId: 'oi-1', quantity: 1 }))
      .rejects.toMatchObject({ code: 'HUB_EXPLICIT_SPLIT_REQUIRED' });
  });

  test('HUB-001 crée la ligne parcel_items quand aucun plan n’existe', async () => {
    const executor = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'oi-1', order_id: 'o-1', product_id: 'prod-1', quantity: 2 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'pi-new', parcel_id: 'p-1', order_item_id: 'oi-1', quantity: 1 }] }) };

    await expect(assignPhysicalAllocationToParcel(executor, { parcelId: 'p-1', orderItemId: 'oi-1', quantity: 1 }))
      .resolves.toEqual({ parcel_item_id: 'pi-new', created: true, planned_quantity: 1 });
  });

  test('refuse un executor sans query', async () => {
    await expect(assignParcelItem({}, { parcelId: 'p', orderItemId: 'oi', productId: 'prod', quantity: 1 }))
      .rejects.toThrow(/requires an executor/);
  });
});
