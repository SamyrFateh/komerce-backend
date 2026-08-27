/**
 * @komerce-arch
 * @role          shared-cart-user-cleanup-boundary
 * @domain        shared-cart
 * @layer         service
 * @criticality   high
 * @inputs        caller_owned_executor, user_id
 * @outputs       deletion_result
 * @depends       none
 * @used-by       dashboard
 * @db-read       none
 * @db-write      basket_items, baskets
 * @db-txn        caller-owned
 * @doctrine      lifecycle_owner_persistence_boundary
 * @impact-areas  shared-cart, dashboard
 * @version       2026-08
 */

'use strict';

function requireExecutor(executor) {
  if (!executor || typeof executor.query !== 'function') {
    throw new TypeError('shared-cart-user-cleanup: executor.query requis');
  }
  return executor;
}

async function deleteUserBasketData(executor, userId) {
  const db = requireExecutor(executor);
  await db.query(
    'DELETE FROM basket_items WHERE basket_id IN (SELECT id FROM baskets WHERE user_id = $1::uuid)',
    [userId],
  );
  return db.query('DELETE FROM baskets WHERE user_id = $1::uuid', [userId]);
}

module.exports = { deleteUserBasketData };
