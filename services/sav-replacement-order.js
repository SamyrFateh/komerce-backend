/**
 * @komerce-arch
 * @role          sav-replacement-order
 * @domain        orders
 * @layer         service
 * @criticality   high
 * @inputs        physically_received_return, exact_original_order_item, locked_decision
 * @outputs       zero_charge_order_in_existing_fulfillment_circuit
 * @depends       services/order-service.js, services/order-status-machine.js, services/order-checkout-persistence.js, services/purchasing-trigger-service.js
 * @used-by       services/relay-return-compensation-service.js
 * @db-read       orders, order_items, relais
 * @db-write      orders, order_items
 * @db-txn        caller_owned_then_procurement_after_commit
 * @doctrine      return_is_dispute_not_parallel_object, status_transition_source_unique, no_implicit_refund_no_sellable_stock
 * @impact-areas  orders, logistics, local-stock, purchasing
 * @version       2026-11
 */
'use strict';

function blocked(code, message) {
  const error = new Error(message);
  error.code = code;
  error.status = 409;
  throw error;
}

async function create({ client, dossier, receipt, actor }) {
  const quantity = Number(receipt?.quantity);
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity !== Number(dossier.return_quantity)) {
    blocked('COMPENSATION_RESHIP_RECEIPT_REQUIRED', 'Le relais doit attester la reprise de la quantité à remplacer.');
  }

  const { rows: [source] } = await client.query(
    `SELECT oi.product_id, oi.fulfillment_source
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
       JOIN relais r ON r.id = o.relais_id AND r.market_id = o.market_id
      WHERE oi.id = $1 AND o.id = $2 AND o.payment_mode <> 'sav_replacement'`,
    [dossier.return_order_item_id, dossier.order_id]);
  if (!source || !['LOCAL_STOCK', 'IMPORT'].includes(source.fulfillment_source)) {
    blocked('COMPENSATION_RESHIP_ROUTE_UNAVAILABLE', 'Le circuit physique de la ligne d’origine est indisponible.');
  }

  const reference = await require('./order-service').getUniqueRef(client);
  const { rows: [replacement] } = await client.query(
    `INSERT INTO orders
        (reference, user_id, recipient_id, relais_id, tracking_phone, total_kmf, total_eur,
         payment_mode, status, market_id, destination_island, routing_mode, transit_hub,
         pickup_code_recipient, pickup_code_recipient_user_id, transport_pricing_snapshot)
      SELECT $2, user_id, recipient_id, relais_id, tracking_phone, 0, 0,
             'sav_replacement', 'pending', market_id, destination_island, routing_mode, transit_hub,
             pickup_code_recipient, pickup_code_recipient_user_id, transport_pricing_snapshot
        FROM orders WHERE id = $1 RETURNING id, reference`, [dossier.order_id, reference]);
  await client.query(
    `INSERT INTO order_items
        (order_id, replacement_source_item_id, product_id, quantity, qty_ordered, price_kmf,
         sku_id, variant_combo, fulfillment_source, customs_category_key, sh_code, douane_pct,
         tva_pct, taxe_add_pct, classification_defaulted, delivery_mode, requested_transport_rail,
         module_type, module_fabric_id, module_fabric_type, module_size, module_retouche,
         module_qty_meters, module_accessories)
      SELECT $2, id, product_id, $3, $3, 0, sku_id, variant_combo, fulfillment_source,
             customs_category_key, sh_code, douane_pct, tva_pct, taxe_add_pct,
             classification_defaulted, delivery_mode, requested_transport_rail,
             module_type, module_fabric_id, module_fabric_type, module_size, module_retouche,
             module_qty_meters, module_accessories
        FROM order_items WHERE id = $1`, [dossier.return_order_item_id, replacement.id, quantity]);

  if (source.fulfillment_source === 'LOCAL_STOCK') {
    await require('./order-checkout-persistence').requireOrderLocalStockAllocation(client, {
      productId: source.product_id, marketId: dossier.market_id, orderId: replacement.id, quantity,
    });
  }
  const { transitionOrderStatus } = require('./order-status-machine');
  for (const newStatus of ['confirmed', 'ordered']) {
    const transition = await transitionOrderStatus({
      orderId: replacement.id, newStatus, actor, source: 'system', dbClient: client,
      note: `Remplacement SAV sans encaissement — dossier ${dossier.id}`,
    });
    if (!transition.success) blocked('COMPENSATION_RESHIP_TRANSITION_REJECTED', transition.error);
  }
  return { ...replacement, fulfillment_source: source.fulfillment_source };
}

async function startProcurement(orderId) {
  // The ordinary repair sweep and an identical decision replay can retry
  // sourcing. The committed order stays visible in the Hub as an open need.
  try {
    const result = await require('./purchasing-trigger-service').triggerPurchasing(orderId);
    if (result.purchase_orders.some(row => ['no_supplier', 'error'].includes(row.status))) {
      return 'sourcing_pending';
    }
  } catch (_) {
    return 'sourcing_pending';
  }
  return 'replacement_order_created';
}

module.exports = { create, startProcurement };
