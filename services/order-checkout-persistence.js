/**
 * @komerce-arch
 * @role          orders-checkout-persistence
 * @domain        orders
 * @layer         service
 * @criticality   critical
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       services/order-status-machine.js, services/wallet-service.js,
 *                services/pickup-secret-service.js, services/local-stock-service.js,
 *                services/order-payment-confirmation.js, services/customs-classification.js,
 *                services/order-cost-snapshot.js
 * @used-by       services/order-checkout-service.js
 * @db-read       orders
 * @db-write      order_items, order_status_history, orders
 * @db-txn        participant (reçoit le client transactionnel de l'appelant, ne BEGIN/COMMIT/ROLLBACK jamais lui-même)
 * @doctrine      docs/doctrine/DOCTRINE_FULFILLMENT_MIXTE.md, resolve_before_behavior_change
 * @impact-areas  orders, checkout, local-stock
 * @version       2026-09 (Lot C — snapshot fulfillment_source sur order_items)
 */

'use strict';

/**
 * order-checkout-persistence.js
 *
 * Porte les écritures transactionnelles du checkout, dans l'ordre où
 * order-checkout-service.js les appelle : INSERT order, historique initial,
 * wallet debit transactionnel, INSERT order_items, allocation local_stock,
 * cycle wallet-100%, snapshot économique figé.
 *
 * Fulfillment mixte — Lot C : le verdict LOCAL_STOCK / IMPORT calculé sous
 * verrou par local-stock-service.js est figé directement dans
 * order_items.fulfillment_source lors de l'INSERT. Il n'est jamais recalculé
 * depuis l'état courant. `availability_status` reste un concept séparé.
 *
 * Ce module ne possède AUCUNE transaction : il reçoit le `client` déjà
 * ouvert par order-checkout-service.js et ne fait jamais de BEGIN/COMMIT/
 * ROLLBACK lui-même.
 */

const { randomUUID: uuidv4 } = require('crypto');
const { appendOrderHistoryNote } = require('./order-status-machine');
const { ensureSecretGenerated } = require('./pickup-secret-service');
const walletService = require('./wallet-service');
const {
  FULFILLMENT_SOURCE,
  allocateForOrderItem,
} = require('./local-stock-service');
const log = require('../utils/logger').child({ module: 'order-checkout-persistence' });

const FULFILLMENT_VALUES = new Set(Object.values(FULFILLMENT_SOURCE));

async function insertOrderRow(client, params) {
  const {
    reference, userId, recipientId, relaisId, trackingPhone,
    totalKmf, totalEur, paymentMode, stripePaymentIntent, cashRefCode,
    confectionType, confectionInstructions, confectionDelayDays, confectionArtisanId,
    moduleType, moduleFabricId, moduleFabricType, moduleSize, moduleRetouche,
    moduleQtyMeters, moduleAccessories, orderOccasion,
    costEstimatedKmf, marginEstimatedPct, discountPct, discountKmf, loyaltyLabel,
    destinationIsland, routingMode, transitHub, transportPriceKmf,
    pickupCodeRecipient, pickupCodeRecipientUserId,
    displayAmount, displayCurrency, displayMeta, marketId,
  } = params;

  const { rows: [order] } = await client.query(

  `INSERT INTO orders (
     id, reference, user_id, recipient_id, relais_id,
     tracking_phone,
     total_kmf, total_eur,
     payment_mode, payment_status, stripe_payment_id,
     cash_ref_code,
     status,
     confection_type, confection_instructions,
     confection_delay_days, confection_artisan_id,
     module_type, module_fabric_id, module_fabric_type,
     module_size, module_retouche, module_qty_meters, module_accessories,
     order_occasion,
     cost_estimated_kmf, margin_estimated_pct,
     discount_pct, discount_kmf, loyalty_label,
     destination_island, routing_mode, transit_hub,
     transport_price_kmf,
     pickup_code_recipient, pickup_code_recipient_user_id,
     display_total_amount, display_currency, display_parity_snapshot,
     market_id
   ) VALUES (
     $1,$2,$3,$4,$5,
     $6,
     $7,$8,
     $9,$10,$11,
     $12,
     'pending',
     $13,$14,
     $15,$16,
     $17,$18,$19,
     $20,$21,$22,$23,
     $24,
     $25,$26,
     $27,$28,$29,
     $30,$31,$32,
     $33,
     $34,$35,
     $36,$37,$38,
     $39
   ) RETURNING *`,
  [
    uuidv4(), reference, userId, recipientId, relaisId || null,
    trackingPhone || null,
    totalKmf, totalEur,
    paymentMode,
    'pending',
    stripePaymentIntent || null,
    cashRefCode,
    confectionType,
    confectionInstructions || null,
    confectionDelayDays,
    confectionArtisanId || null,
    moduleType || null,
    moduleFabricId || null,
    moduleFabricType || null,
    moduleSize || null,
    moduleRetouche,
    moduleQtyMeters || null,
    moduleAccessories ? JSON.stringify(moduleAccessories) : null,
    orderOccasion || null,
    Math.round(costEstimatedKmf),
    Number(marginEstimatedPct),
    discountPct,
    discountKmf,
    loyaltyLabel,
    destinationIsland,
    routingMode,
    transitHub,
    transportPriceKmf,
    pickupCodeRecipient,
    pickupCodeRecipientUserId,
    displayAmount,
    displayCurrency,
    displayMeta ? JSON.stringify(displayMeta) : null,
    marketId || null,
  ]
);

  return order;
}

async function recordInitialHistory(client, orderId, userId) {
  await appendOrderHistoryNote(client, orderId, 'pending', 'Commande créée', userId);
}

async function applyWalletDebit(client, { userId, amountKmf, orderId, orderReference }) {
  await walletService.debit(client, {
    userId,
    amountKmf,
    reason: 'checkout',
    referenceId: orderId,
    idempotencyKey: `checkout_${orderId}`,
    note: `Wallet appliqué à commande ${orderReference}`,
  });

  await client.query(
    'UPDATE orders SET wallet_applied_kmf = $1 WHERE id = $2',
    [amountKmf, orderId]
  );
}

async function insertOrderItemsWithStock(client, { items, productMap, order, relais }) {
  const { resolveFrozenClassification } = require('./customs-classification');

  for (const item of items) {
    const product = productMap[item.product_id];
    const qty = parseInt(item.quantity, 10) || 1;
    const fulfillmentSource = item._fulfillment_source;

    if (!FULFILLMENT_VALUES.has(fulfillmentSource)) {
      const err = new Error(
        `insertOrderItemsWithStock: fulfillment_source manquant ou invalide pour ${item.product_id}`
      );
      err.code = 'fulfillment_source_invalid';
      throw err;
    }

    // Gel de la classification douanière — I-DOUANE-1
    const clf = await resolveFrozenClassification(client, product.category);

    await client.query(
      `INSERT INTO order_items (
         order_id, product_id, quantity, price_kmf,
         module_type, module_fabric_id, module_fabric_type,
         module_size, module_retouche, module_qty_meters, module_accessories,
         variant_combo, sku_id,
         customs_category_key, sh_code, douane_pct, tva_pct, taxe_add_pct,
         classification_defaulted,
         requested_transport_rail,
         shared_cart_item_id,
         fulfillment_source
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
      [
        order.id,
        item.product_id,
        qty,
        item._effective_unit_price_kmf,
        item.module_type || null,
        item.module_fabric_id || null,
        item.module_fabric_type || null,
        item.module_size || null,
        item.module_retouche || false,
        item.module_qty_meters || null,
        item.module_accessories ? JSON.stringify(item.module_accessories) : null,
        item.variant_combo && typeof item.variant_combo === 'object' && !Array.isArray(item.variant_combo)
          ? JSON.stringify(item.variant_combo)
          : null,
        item._resolved_sku_id || null,
        clf.customs_category_key,
        clf.sh_code,
        clf.douane_pct,
        clf.tva_pct,
        clf.taxe_add_pct,
        clf.classification_defaulted,
        item.requested_transport_rail ?? null,
        item.shared_cart_item_id || null,
        fulfillmentSource,
      ]
    );

    // Le snapshot et l'allocation doivent raconter la même vérité. Une ligne
    // IMPORT n'essaie jamais opportunistement de s'allouer un stock local qui
    // aurait changé après le verdict. Une ligne LOCAL_STOCK est revalidée et
    // allouée sous la même transaction avant COMMIT.
    if (fulfillmentSource === FULFILLMENT_SOURCE.LOCAL_STOCK) {
      const allocation = await allocateForOrderItem(client, {
        productId: item.product_id,
        marketId:  relais?.market_id || null,
        orderId:   order.id,
        quantity:  qty,
      });
      if (!allocation) {
        const err = new Error(
          `insertOrderItemsWithStock: allocation locale absente après verdict LOCAL_STOCK (${item.product_id})`
        );
        err.code = 'local_stock_verdict_drift';
        throw err;
      }
    }
  }
}

// ── Wallet couvre 100% → cycle paiement complet (state machine + stock) ──
// Sans cet appel : status reste 'pending', stock non décrémenté, machine contournée.
async function completeWalletFullPayment(client, { order, user, relais }) {
  const { confirmPaymentCycle } = require('./order-payment-confirmation');
  const cycleResult = await confirmPaymentCycle({
    orderId: order.id,
    actor:   { id: user.id, role: user.role || 'user' },
    source:  'wallet_full_payment',
    dbClient: client,
    note:    'Paiement intégral par wallet',
  });
  if (cycleResult.stockBlocked) {
    return {
      ok: false, status: 409,
      body: {
        error: 'Stock insuffisant pour finaliser la commande',
        items: cycleResult.insufficientItems,
      },
    };
  }

  const secretResult = await ensureSecretGenerated({
    orderId:  order.id,
    relaisId: relais?.id || null,
    channel:  'wallet_full_payment',
    dbClient: client,
  });
  const walletPickupCode = secretResult.code || null;

  const { rows: [refreshed] } = await client.query(
    'SELECT * FROM orders WHERE id = $1', [order.id]
  );
  if (refreshed) Object.assign(order, refreshed);

  return { ok: true, walletPickupCode, order };
}

// ─── PHASE B — Snapshot economique fige (P3 doctrine) ────────────────
async function lockCostSnapshot(client, order) {
  try {
    const orderCostSnapshot = require('./order-cost-snapshot');
    await orderCostSnapshot.lockEstimatedCostsForOrder(order.id, client, { source: 'pricing-engine' });
  } catch (snapErr) {
    log.error('[ORDER-CREATE] cost snapshot failed for', order.reference, snapErr.message);
  }
}

module.exports = {
  insertOrderRow,
  recordInitialHistory,
  applyWalletDebit,
  insertOrderItemsWithStock,
  completeWalletFullPayment,
  lockCostSnapshot,
};
