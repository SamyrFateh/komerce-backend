/**
 * @komerce-arch
 * @role          order-item-verified-refund-projection
 * @domain        orders
 * @layer         service
 * @criticality   critical
 * @inputs        locked_order_id, item_id, verified_refund_quantity, shared_postgresql_transaction
 * @outputs       qty_refunded incremented on one order item, never above quantity minus collected
 * @depends       none
 * @used-by       services/item-refund-psp-orchestrator.js
 * @db-read       order_items
 * @db-write      order_items
 * @db-txn        caller_order_lock, same transaction as confirmed PSP ledger and refunds row
 * @doctrine      orders_owns_order_items, refund_quantity_never_exceeds_uncollected_qty
 * @impact-areas  orders, refunds, relay
 * @version       2026-11
 */
'use strict';

class OrderItemRefundQuantityError extends Error {
  constructor(message){super(message);this.status=409;this.code='ITEM_REFUND_QTY_FINALIZATION_CONFLICT';}
}

/** Le service Orders conserve l'autorité sur la quantité métier de la ligne.
 * N'invoquer qu'APRES preuve PSP vérifiée, dans la même transaction
 * que INSERT refunds et le passage réservation -> confirmed.
 */
async function applyVerifiedItemRefundToOrderItem(client,{orderId,orderItemId,quantity}){
  if(!client || typeof client.query!=='function' || !Number.isSafeInteger(Number(quantity)) ||
      Number(quantity)<=0 || !orderId || !orderItemId)
    throw new OrderItemRefundQuantityError('Paramètres de clôture article invalides');
  const applied=await client.query(
    `UPDATE order_items
       SET qty_refunded=qty_refunded+$2
     WHERE id=$1 AND order_id=$3 AND qty_collected+qty_refunded+$2<=quantity
     RETURNING id`,[orderItemId,Number(quantity),orderId]
  );
  if(applied.rows.length!==1)
    throw new OrderItemRefundQuantityError('Quantité remboursée supérieure à la quantité non remise');
  return {orderItemId,quantity:Number(quantity)};
}

module.exports={applyVerifiedItemRefundToOrderItem,OrderItemRefundQuantityError};
