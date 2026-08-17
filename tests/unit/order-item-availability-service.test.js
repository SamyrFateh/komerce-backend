'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  updateOrderItemAvailabilityDetails,
  setOrderItemAvailabilityStatus,
} = require('../../services/order-item-availability-service');

describe('order-item-availability-service', () => {
  test('updateOrderItemAvailabilityDetails writes through the caller transaction client', async () => {
    const updated = {
      id: 'oi-1',
      product_id: 'prod-1',
      quantity: 2,
      availability_status: 'backorder',
      estimated_available_at: null,
      backorder_reason: 'stock',
    };
    const client = {
      query: jest.fn().mockResolvedValue({ rows: [updated] }),
    };

    const result = await updateOrderItemAvailabilityDetails(client, {
      orderItemId: 'oi-1',
      status: 'backorder',
      backorderReason: 'stock',
    });

    expect(result).toEqual(updated);
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(client.query.mock.calls[0][0]).toContain('UPDATE order_items');
    expect(client.query.mock.calls[0][1]).toEqual([
      'backorder',
      null,
      'stock',
      'oi-1',
    ]);
  });

  test('setOrderItemAvailabilityStatus only changes status + updated_at', async () => {
    const client = {
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
    };

    await setOrderItemAvailabilityStatus(client, 'oi-2', 'available');

    expect(client.query).toHaveBeenCalledTimes(1);
    expect(client.query.mock.calls[0][0]).toContain(
      'UPDATE order_items SET availability_status = $1, updated_at = NOW()'
    );
    expect(client.query.mock.calls[0][1]).toEqual(['available', 'oi-2']);
  });

  test('rejects calls without a transaction client', async () => {
    await expect(
      setOrderItemAvailabilityStatus(null, 'oi-3', 'available')
    ).rejects.toThrow('requires a transaction client');
  });
});
