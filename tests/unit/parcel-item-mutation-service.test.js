'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  assignWholeOrderItemToParcel,
  assignParcelItem,
  addParcelItem,
  removeParcelItem,
  assignSingleOrderItemToParcel,
} = require('../../services/parcel-item-mutation-service');

describe('parcel-item-mutation-service', () => {
  test('assignWholeOrderItemToParcel utilise le même executor et garde la garde order_id', async () => {
    const executor = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };

    await assignWholeOrderItemToParcel(executor, {
      parcelId: 'parcel-1',
      orderItemId: 'item-1',
      orderId: 'order-1',
    });

    expect(executor.query).toHaveBeenCalledTimes(1);
    expect(executor.query.mock.calls[0][0]).toContain('INSERT INTO parcel_items');
    expect(executor.query.mock.calls[0][0]).toContain('oi.order_id = $3');
    expect(executor.query.mock.calls[0][0]).toContain('ON CONFLICT DO NOTHING');
    expect(executor.query.mock.calls[0][1]).toEqual(['parcel-1', 'item-1', 'order-1']);
  });

  test('assignParcelItem conserve les valeurs résolues par l’appelant', async () => {
    const executor = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };

    await assignParcelItem(executor, {
      parcelId: 'parcel-1',
      orderItemId: 'item-1',
      productId: 'product-1',
      quantity: 3,
    });

    expect(executor.query.mock.calls[0][0]).toContain('VALUES ($1, $2, $3, $4)');
    expect(executor.query.mock.calls[0][0]).not.toContain('RETURNING');
    expect(executor.query.mock.calls[0][1]).toEqual(['parcel-1', 'item-1', 'product-1', 3]);
  });

  test('addParcelItem retourne la ligne créée', async () => {
    const executor = {
      query: jest.fn().mockResolvedValue({ rows: [{ id: 'pi-1' }], rowCount: 1 }),
    };

    const row = await addParcelItem(executor, {
      parcelId: 'parcel-1',
      orderItemId: 'item-1',
      productId: 'product-1',
      quantity: 2,
    });

    expect(row).toEqual({ id: 'pi-1' });
    expect(executor.query.mock.calls[0][0]).toContain('RETURNING *');
  });

  test('removeParcelItem retourne la ligne supprimée', async () => {
    const executor = {
      query: jest.fn().mockResolvedValue({ rows: [{ id: 'pi-1' }], rowCount: 1 }),
    };

    const row = await removeParcelItem(executor, {
      parcelId: 'parcel-1',
      orderItemId: 'item-1',
    });

    expect(row).toEqual({ id: 'pi-1' });
    expect(executor.query).toHaveBeenCalledWith(
      'DELETE FROM parcel_items WHERE parcel_id = $1 AND order_item_id = $2 RETURNING *',
      ['parcel-1', 'item-1']
    );
  });

  test('assignSingleOrderItemToParcel conserve quantity=1', async () => {
    const executor = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };

    await assignSingleOrderItemToParcel(executor, {
      parcelId: 'parcel-1',
      orderItemId: 'item-1',
    });

    expect(executor.query.mock.calls[0][0]).toContain('oi.product_id, 1');
    expect(executor.query.mock.calls[0][1]).toEqual(['parcel-1', 'item-1', 'item-1']);
  });

  test('refuse un executor sans query', async () => {
    await expect(
      assignParcelItem({}, {
        parcelId: 'parcel-1',
        orderItemId: 'item-1',
        productId: 'product-1',
        quantity: 1,
      })
    ).rejects.toThrow(/requires an executor/);
  });
});
