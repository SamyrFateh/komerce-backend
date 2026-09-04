/**
 * @komerce-arch
 * @role          orders-cross-feature-mutation-boundary
 * @domain        orders
 * @layer         service
 * @criticality   critical
 * @inputs        caller_owned_executor, narrow_order_mutation_payload
 * @outputs       query_result_or_void
 * @depends       none
 * @used-by       customs, inventory, logistics, payments, purchasing, wallet
 * @db-read       customs_shipment_parcels, customs_shipments, orders, parcels, relais
 * @db-write      orders
 * @db-txn        caller-owned
 * @doctrine      lifecycle_owner_persistence_boundary
 * @impact-areas  orders, payments, logistics, customs, inventory, purchasing, wallet
 * @version       2026-08
 */

'use strict';

const PICKUP_SECRET_COLUMNS = new Set([
  'pickup_secret_hash',
  'pickup_secret_salt',
  'pickup_secret_last4',
  'pickup_secret_created_at',
  'pickup_secret_expires_at',
  'pickup_secret_attempts',
  'pickup_secret_blocked_until',
  'pickup_secret_channel',
  'pickup_secret_emitted_at',
  'pickup_secret_revealed_at',
  'payment_received_at',
  'payment_received_by_agent_id',
  'payer_name',
  'payer_id_type',
  'payer_id_number',
  'payer_note',
  'tracking_phone',
  'tracking_phone_secondary',
  'tracking_phone_confirmed_at',
  'tracking_phone_confirmed_by_agent_id',
  'cash_paid_at',
  'stripe_billing_name',
  'stripe_card_last4',
  'stripe_receipt_email',
  'stripe_payment_intent_id',
  'pickup_secret_regen_reason',
  'pickup_secret_regen_count',
]);

function requireExecutor(executor) {
  if (!executor || typeof executor.query !== 'function') {
    throw new TypeError('order-mutation-service: executor.query requis');
  }
  return executor;
}

async function setInventoryCompletion(executor, {
  orderId,
  itemsReceived,
  itemsTotal,
  completionRatio,
}) {
  return requireExecutor(executor).query(
    `UPDATE orders
     SET items_received = $2,
         items_total = $3,
         completion_ratio = $4,
         updated_at = NOW()
     WHERE id = $1`,
    [orderId, itemsReceived, itemsTotal, completionRatio],
  );
}

async function recomputeCustomsCosts(executor, { orderIds }) {
  const q = requireExecutor(executor);
  if (!Array.isArray(orderIds) || orderIds.length === 0) return { rowCount: 0 };

  const first = await q.query(
    `UPDATE orders o
     SET cost_douane_kmf = COALESCE((
       SELECT SUM(csp.customs_share_kmf)
       FROM customs_shipment_parcels csp
       JOIN parcels p ON p.id = csp.parcel_id
       JOIN customs_shipments cs ON cs.id = csp.shipment_id
       WHERE p.order_id = o.id AND cs.is_active = TRUE
     ), 0)
     WHERE o.id = ANY($1::uuid[])`,
    [orderIds],
  );

  await q.query(
    `UPDATE orders
     SET margin_real_pct = CASE
       WHEN total_kmf > 0 AND (cost_transport_kmf > 0 OR cost_douane_kmf > 0)
       THEN ROUND(((total_kmf - COALESCE(cost_transport_kmf,0) - COALESCE(cost_douane_kmf,0))::numeric
                   / total_kmf * 100)::numeric, 2)
       ELSE margin_real_pct
     END
     WHERE id = ANY($1::uuid[])`,
    [orderIds],
  );

  return first;
}

async function backfillRoutingFields(executor) {
  return requireExecutor(executor).query(
    `UPDATE orders o SET
       destination_island = r.island_code,
       routing_mode = CASE
         WHEN r.island_code = 'ANJOUAN' THEN 'DIRECT'
         WHEN r.island_code IN ('GRANDE_COMORE', 'MOHELI') THEN 'INTER_ISLAND'
         ELSE 'SPECIAL_ROUTE'
       END,
       transit_hub = CASE
         WHEN r.island_code IN ('GRANDE_COMORE', 'MOHELI') THEN 'ANJOUAN'
         ELSE NULL
       END
     FROM relais r
     WHERE o.relais_id = r.id
       AND o.destination_island IS NULL
       AND r.island_code IS NOT NULL`,
  );
}

async function setStripePaymentId(executor, {
  orderId,
  stripePaymentId,
  onlyIfEmptyOrSame = false,
}) {
  const guard = onlyIfEmptyOrSame
    ? ' AND (stripe_payment_id IS NULL OR stripe_payment_id = $1)'
    : '';
  return requireExecutor(executor).query(
    `UPDATE orders SET stripe_payment_id = $1 WHERE id = $2${guard}`,
    [stripePaymentId, orderId],
  );
}

async function setPaypalOrderId(executor, { orderId, paypalOrderId }) {
  return requireExecutor(executor).query(
    'UPDATE orders SET paypal_order_id = $1 WHERE id = $2',
    [paypalOrderId, orderId],
  );
}

async function setPaypalCaptureMetadata(executor, {
  orderId,
  captureId,
  payerEmail = null,
  payerId = null,
  payIn4Used = false,
  preserveExisting = false,
  ensurePaymentMode = false,
}) {
  const q = requireExecutor(executor);
  if (preserveExisting) {
    const modeSql = ensurePaymentMode
      ? ", payment_mode = COALESCE(payment_mode, 'paypal_eur'::payment_mode)"
      : '';
    return q.query(
      `UPDATE orders SET
         paypal_capture_id    = COALESCE(paypal_capture_id, $1),
         paypal_payer_email   = COALESCE(paypal_payer_email, $2),
         paypal_payer_id      = COALESCE(paypal_payer_id, $3),
         paypal_pay_in_4_used = $4${modeSql}
       WHERE id = $5`,
      [captureId, payerEmail, payerId, payIn4Used, orderId],
    );
  }

  const modeSql = ensurePaymentMode
    ? ", payment_mode = COALESCE(payment_mode, 'paypal_eur'::payment_mode)"
    : '';
  return q.query(
    `UPDATE orders SET
       paypal_capture_id    = $1,
       paypal_payer_email   = $2,
       paypal_payer_id      = $3,
       paypal_pay_in_4_used = $4${modeSql}
     WHERE id = $5`,
    [captureId, payerEmail, payerId, payIn4Used, orderId],
  );
}

async function setPaypalCaptureId(executor, {
  orderId,
  captureId,
  ensurePaymentMode = true,
}) {
  const modeSql = ensurePaymentMode
    ? ", payment_mode = COALESCE(payment_mode, 'paypal_eur'::payment_mode)"
    : '';
  return requireExecutor(executor).query(
    `UPDATE orders
     SET paypal_capture_id = COALESCE(paypal_capture_id, $1)${modeSql}
     WHERE id = $2`,
    [captureId, orderId],
  );
}

async function appendOrderNote(executor, { orderId, note }) {
  return requireExecutor(executor).query(
    `UPDATE orders SET notes = COALESCE(notes, '') || $1 WHERE id = $2`,
    [note, orderId],
  );
}

async function markCashPaidAt(executor, orderId) {
  return requireExecutor(executor).query(
    'UPDATE orders SET cash_paid_at = COALESCE(cash_paid_at, NOW()) WHERE id = $1',
    [orderId],
  );
}

async function markCashReminderSent(executor, { orderId, reminder }) {
  const q = requireExecutor(executor);
  if (reminder === 'h12') {
    return q.query('UPDATE orders SET reminder_h12_sent = TRUE WHERE id = $1', [orderId]);
  }
  if (reminder === 'h36') {
    return q.query('UPDATE orders SET reminder_h36_sent = TRUE WHERE id = $1', [orderId]);
  }
  throw new TypeError(`order-mutation-service: reminder invalide: ${reminder}`);
}

async function setWalletApplied(executor, { orderId, amountKmf }) {
  return requireExecutor(executor).query(
    'UPDATE orders SET wallet_applied_kmf = $1, updated_at = NOW() WHERE id = $2',
    [amountKmf, orderId],
  );
}

async function setSupplierSnapshot(executor, {
  orderId,
  supplierName,
  supplierInvoiceUrl = null,
}) {
  return requireExecutor(executor).query(
    `UPDATE orders
     SET supplier_name = $1,
         supplier_invoice_url = COALESCE($2, supplier_invoice_url),
         updated_at = NOW()
     WHERE id = $3`,
    [supplierName, supplierInvoiceUrl, orderId],
  );
}

async function setComputedStatus(executor, { orderId, computedStatus }) {
  return requireExecutor(executor).query(
    'UPDATE orders SET computed_status = $1, updated_at = NOW() WHERE id = $2',
    [computedStatus, orderId],
  );
}

async function writePickupSecret(executor, { orderId, fields }) {
  const q = requireExecutor(executor);
  const entries = Object.entries(fields || {});
  if (entries.length === 0) throw new TypeError('order-mutation-service: pickup fields requis');
  for (const [column] of entries) {
    if (!PICKUP_SECRET_COLUMNS.has(column)) {
      throw new TypeError(`order-mutation-service: pickup column interdite: ${column}`);
    }
  }

  const values = entries.map(([, value]) => value);
  const setClauses = entries.map(([column], i) => `${column} = $${i + 1}`);
  values.push(orderId);
  return q.query(
    `UPDATE orders SET ${setClauses.join(', ')}, updated_at = NOW() WHERE id = $${values.length}`,
    values,
  );
}

async function setPickupAttemptState(executor, { orderId, attempts, blockedUntil = null }) {
  return requireExecutor(executor).query(
    `UPDATE orders
     SET pickup_secret_attempts = $1,
         pickup_secret_blocked_until = $2,
         updated_at = NOW()
     WHERE id = $3`,
    [attempts, blockedUntil, orderId],
  );
}

async function setPickupAttemptsOnly(executor, {
  orderId,
  attempts,
}) {
  return requireExecutor(executor).query(
    `UPDATE orders
     SET pickup_secret_attempts = $1,
         updated_at = NOW()
     WHERE id = $2`,
    [attempts, orderId],
  );
}

async function setExceptionalPickupAttemptState(executor, { orderId, attempts, blockedUntil = null }) {
  return requireExecutor(executor).query(
    `UPDATE orders
     SET exceptional_pickup_attempts = $1,
         exceptional_pickup_blocked_until = $2,
         updated_at = NOW()
     WHERE id = $3`,
    [attempts, blockedUntil, orderId],
  );
}

async function setCollectedByName(executor, { orderId, collectedByName = null }) {
  return requireExecutor(executor).query(
    'UPDATE orders SET collected_by_name = $1, updated_at = NOW() WHERE id = $2',
    [collectedByName, orderId],
  );
}

async function recordPickupRegeneration(executor, { orderId, reason }) {
  return requireExecutor(executor).query(
    `UPDATE orders
     SET pickup_secret_regen_count = COALESCE(pickup_secret_regen_count, 0) + 1,
         pickup_secret_regen_reason = $1,
         updated_at = NOW()
     WHERE id = $2`,
    [reason, orderId],
  );
}

async function markPickupSecretRevealed(executor, orderId) {
  return requireExecutor(executor).query(
    'UPDATE orders SET pickup_secret_revealed_at = NOW() WHERE id = $1',
    [orderId],
  );
}

async function finalizePickupCollection(executor, {
  orderId,
  method,
}) {
  const q = requireExecutor(executor);

  if (method === 'PICKUP_CODE') {
    return q.query(
      `UPDATE orders
       SET pickup_collected_via = 'PICKUP_CODE',
           pickup_secret_hash = NULL,
           pickup_secret_salt = NULL,
           pickup_secret_last4 = NULL,
           pickup_secret_expires_at = NULL,
           pickup_secret_attempts = 0,
           pickup_secret_blocked_until = NULL,
           exceptional_pickup_attempts = 0,
           exceptional_pickup_blocked_until = NULL,
           updated_at = NOW()
       WHERE id = $1`,
      [orderId],
    );
  }

  if (method === 'AUTHORIZED_NAME_ID_CHECK') {
    return q.query(
      `UPDATE orders
       SET pickup_collected_via = 'AUTHORIZED_NAME_ID_CHECK',
           pickup_secret_hash = NULL,
           pickup_secret_salt = NULL,
           pickup_secret_last4 = NULL,
           pickup_secret_expires_at = NULL,
           pickup_secret_attempts = 0,
           pickup_secret_blocked_until = NULL,
           exceptional_pickup_attempts = 0,
           exceptional_pickup_blocked_until = NULL,
           updated_at = NOW()
       WHERE id = $1`,
      [orderId],
    );
  }

  throw new TypeError(
    `order-mutation-service: pickup collection method invalide: ${method}`
  );
}

module.exports = {
  setInventoryCompletion,
  recomputeCustomsCosts,
  backfillRoutingFields,
  setStripePaymentId,
  setPaypalOrderId,
  setPaypalCaptureMetadata,
  setPaypalCaptureId,
  appendOrderNote,
  markCashPaidAt,
  markCashReminderSent,
  setWalletApplied,
  setSupplierSnapshot,
  setComputedStatus,
  writePickupSecret,
  setPickupAttemptState,
  setPickupAttemptsOnly,
  setExceptionalPickupAttemptState,
  setCollectedByName,
  recordPickupRegeneration,
  markPickupSecretRevealed,
  finalizePickupCollection,
};
