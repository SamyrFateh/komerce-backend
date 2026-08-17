/**
 * @komerce-arch
 * @role          orders-order-item-availability
 * @domain        orders
 * @layer         service
 * @criticality   high
 * @inputs        transaction_client, order_item_availability_payload
 * @outputs       updated_order_item_or_void
 * @depends       none
 * @used-by       services/parcel-operations.js
 * @db-read       none
 * @db-write      order_items
 * @db-txn        caller_owned
 * @doctrine      lifecycle_owner_boundary
 * @impact-areas  orders, logistics
 * @version       2026-08
 */

'use strict';

/**
 * Owner boundary for availability mutations on orders.order_items.
 *
 * The caller owns the transaction and passes its pg client. This keeps parcel
 * and order-item availability mutations atomic while orders remains the sole
 * SQL lifecycle owner of order_items.
 */

function assertClient(client) {
  if (!client || typeof client.query !== 'function') {
    throw new TypeError('order-item-availability-service requires a transaction client');
  }
}

async function updateOrderItemAvailabilityDetails(client, {
  orderItemId,
  status,
  estimatedAvailableAt = null,
  backorderReason = null,
}) {
  assertClient(client);

  const { rows: [updated] } = await client.query(
    `UPDATE order_items
     SET availability_status = $1,
         estimated_available_at = $2,
         backorder_reason = $3,
         updated_at = NOW()
     WHERE id = $4
     RETURNING id, product_id, quantity, availability_status, estimated_available_at, backorder_reason`,
    [status, estimatedAvailableAt, backorderReason, orderItemId]
  );

  return updated;
}

async function setOrderItemAvailabilityStatus(client, orderItemId, status) {
  assertClient(client);

  await client.query(
    `UPDATE order_items SET availability_status = $1, updated_at = NOW()
     WHERE id = $2`,
    [status, orderItemId]
  );
}

module.exports = {
  updateOrderItemAvailabilityDetails,
  setOrderItemAvailabilityStatus,
};
