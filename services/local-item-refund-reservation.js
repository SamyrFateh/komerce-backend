/**
 * @komerce-arch
 * @role          verified-local-item-refund-reservation
 * @domain        refunds
 * @layer         service
 * @criticality   critical
 * @inputs        locked paid order, attested incident, original cash/MM collection, stable operation UUID
 * @outputs       native-currency durable refund obligation, NEVER a payout
 * @depends       db, migrations/416_fable_local_item_refund_reservations.sql
 * @used-by       routes/admin/orders.js
 * @db-read       orders, order_items, incidents, international_shipment_relay_receipts, cash_collections, mobile_money_transactions, markets, refunds, refund_execution_intents, order_item_refund_reservations
 * @db-write      local_item_refund_reservations
 * @db-txn        order lock, captured amount and verified shortage, insert then COMMIT
 * @doctrine      payer_original_only, no_wallet_fallback, no_double_refund, no_unverified_payout
 * @impact-areas  orders, refunds, payments, cash-custody, logistics
 * @version       2026-11
 */
'use strict';

const defaultDb = require('../db');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class LocalItemRefundError extends Error {
  constructor(code, message, status = 409) {
    super(message); this.code = code; this.status = status;
  }
}
function fail(code, message, status = 409) { throw new LocalItemRefundError(code, message, status); }

function decimalMinor(value, scale) {
  if (!Number.isSafeInteger(scale) || scale < 0 || scale > 4)
    fail('LOCAL_REFUND_MINOR_UNIT_INVALID', 'Précision monétaire inconnue');
  const str = String(value ?? '').trim();
  if (!/^(0|[1-9][0-9]*)(\.[0-9]{1,8})?$/.test(str))
    fail('LOCAL_REFUND_AMOUNT_INVALID', 'Montant original non fiable');
  const [whole, fractional = ''] = str.split('.');
  if (fractional.slice(scale).replace(/0/g, '') !== '')
    fail('LOCAL_REFUND_AMOUNT_PRECISION', 'Montant non représentable dans la devise');
  return BigInt(whole) * (10n ** BigInt(scale))
    + BigInt((fractional.slice(0, scale) || '').padEnd(scale, '0') || '0');
}
function moneyKmf(cents) {
  return (cents / 100n).toString() + '.' + (cents % 100n).toString().padStart(2, '0');
}
function localShare({ unitKmf, quantity, totalKmf, capturedMinor }) {
  if (!Number.isSafeInteger(quantity) || quantity <= 0)
    fail('LOCAL_REFUND_QTY_INVALID', 'Quantité entière positive obligatoire', 400);
  const unit = decimalMinor(unitKmf, 2);
  const total = decimalMinor(totalKmf, 2);
  const captured = BigInt(capturedMinor);
  const line = unit * BigInt(quantity);
  if (line <= 0n || total <= 0n || captured <= 0n || line > total)
    fail('LOCAL_REFUND_SNAPSHOT_INVALID', 'Prix ou montant initial incompatible');
  const amountMinor = (line * captured + total / 2n) / total;
  if (amountMinor <= 0n || amountMinor > captured)
    fail('LOCAL_REFUND_ZERO_OR_EXCESS', 'Prorata local non représentable');
  return { amountKmf: moneyKmf(line), amountMinor, captureMinor: captured };
}

async function sourceForPaidLocalOrder(client, order) {
  if (order.payment_mode === 'cash_relais') {
    const { rows } = await client.query(
      'SELECT id, relais_id, amount_kmf FROM cash_collections WHERE order_id=$1',
      [order.id]
    );
    if (rows.length !== 1 || String(rows[0].relais_id) !== String(order.relais_id))
      fail('LOCAL_REFUND_CASH_COLLECTION_UNVERIFIED', 'Encaissement cash unique et relais non vérifiés');
    const market = await client.query('SELECT currency FROM markets WHERE id=$1', [order.market_id]);
    if (market.rows[0]?.currency !== 'KMF')
      fail('LOCAL_REFUND_CASH_NATIVE_NOT_CERTIFIED', 'Remboursement cash hors KMF non certifié');
    if (decimalMinor(rows[0].amount_kmf, 2) !== decimalMinor(order.total_kmf, 2))
      fail('LOCAL_REFUND_CASH_AMOUNT_MISMATCH', 'Encaissement cash différent de la commande');
    const paidMinor = decimalMinor(rows[0].amount_kmf, 0);
    return { paymentMode: 'cash_relais', captureRef: String(rows[0].id),
      currency: 'KMF', minorUnit: 0, paidMinor };
  }
  if (order.payment_mode === 'mobile_money') {
    const { rows } = await client.query(
      `SELECT id, market_id, provider, currency, minor_unit, amount_minor,
              external_transaction_id
         FROM mobile_money_transactions
        WHERE order_id=$1 AND status='succeeded'`,
      [order.id]
    );
    if (rows.length !== 1 || String(rows[0].market_id) !== String(order.market_id)
        || !String(rows[0].external_transaction_id || '').trim())
      fail('LOCAL_REFUND_MOBILE_COLLECTION_UNVERIFIED', 'Capture opérateur unique et vérifiable absente');
    const source = rows[0];
    const snap = typeof order.fx_snapshot === 'string'
      ? JSON.parse(order.fx_snapshot) : order.fx_snapshot;
    if (!snap?.market || snap.market.market_id && String(snap.market.market_id) !== String(order.market_id)
        || String(snap.market.currency) !== String(source.currency)
        || Number(snap.market.minor_unit) !== Number(source.minor_unit)
        || decimalMinor(snap.market.amount_text ?? snap.market.amount, Number(source.minor_unit))
          !== BigInt(source.amount_minor))
      fail('LOCAL_REFUND_MOBILE_SNAPSHOT_MISMATCH', 'Montant ou devise capture incohérents avec le snapshot');
    return { paymentMode: 'mobile_money', captureRef: String(source.id),
      currency: String(source.currency), minorUnit: Number(source.minor_unit),
      paidMinor: BigInt(source.amount_minor) };
  }
  fail('LOCAL_REFUND_RAIL_UNSUPPORTED', 'Seuls cash relais ou mobile money sont admissibles');
}

/** Create only a LIABILITY; disbursement requires a separate certified cash/operator settlement. */
async function reserveLocalShortage({
  orderId, orderItemId, incidentId, operationKey, quantity, reason, actor, db = defaultDb
}) {
  if (![orderId, orderItemId, incidentId, operationKey].every(x => UUID.test(String(x || ''))))
    fail('LOCAL_REFUND_IDENTIFIER_INVALID', 'UUID requis', 400);
  if (!actor?.id || actor.role !== 'admin')
    fail('LOCAL_REFUND_ADMIN_REQUIRED', 'Réservation financière réservée admin', 403);
  if (!Number.isSafeInteger(quantity) || quantity < 1)
    fail('LOCAL_REFUND_QTY_INVALID', 'Quantité invalide', 400);
  if (typeof reason !== 'string' || reason.trim().length < 8)
    fail('LOCAL_REFUND_REASON_REQUIRED', 'Motif détaillé obligatoire', 400);

  const client = await db.getClient();
  let inTransaction = false;
  try {
    await client.query('BEGIN'); inTransaction = true;
    const { rows: [order] } = await client.query(
      `SELECT id, user_id, market_id, relais_id, payment_mode, payment_status,
              total_kmf, fx_snapshot
         FROM orders WHERE id=$1 FOR UPDATE`, [orderId]
    );
    if (!order || order.payment_status !== 'paid' || !order.market_id)
      fail('LOCAL_REFUND_PAID_ORDER_REQUIRED', 'Commande payée et marché requis');

    const { rows: [item] } = await client.query(
      `SELECT id, quantity, qty_collected, qty_refunded, price_kmf
         FROM order_items WHERE id=$1 AND order_id=$2 FOR UPDATE`,
      [orderItemId, orderId]
    );
    if (!item || Number(item.qty_collected) >= Number(item.quantity))
      fail('LOCAL_REFUND_LINE_NOT_ELIGIBLE', 'Ligne absente ou intégralement remise');

    const { rows: [existing] } = await client.query(
      `SELECT id, order_item_id, source_incident_id, quantity, reason, status,
              amount_minor, currency
         FROM local_item_refund_reservations
        WHERE order_id=$1 AND operation_key=$2 FOR UPDATE`,
      [orderId, operationKey]
    );
    if (existing) {
      if (String(existing.order_item_id) !== String(orderItemId)
          || String(existing.source_incident_id) !== String(incidentId)
          || Number(existing.quantity) !== quantity
          || existing.reason !== reason.trim())
        fail('LOCAL_REFUND_REPLAY_CONFLICT', 'Même événement avec des paramètres différents');
      await client.query('COMMIT'); inTransaction = false;
      return { reservationId: existing.id, status: existing.status, paid: false,
        amountMinor: String(existing.amount_minor), currency: existing.currency, replayed: true };
    }

    const { rows: [relayProof] } = await client.query(
      `SELECT COALESCE(SUM(GREATEST(expected_qty-received_qty,0)),0)::int AS missing
         FROM international_shipment_relay_receipts
        WHERE order_item_id=$1 AND incident_id=$2`, [orderItemId, incidentId]
    );
    const { rows: [supplierProof] } = await client.query(
      `SELECT COALESCE(SUM((details->>'missing_quantity')::int),0)::int AS missing
         FROM incidents WHERE id=$1 AND order_item_id=$2 AND order_id=$3
           AND incident_type='reconciliation_error'
           AND details->>'type'='supplier_shortage'`,
      [incidentId, orderItemId, orderId]
    );
    const missing = Number(relayProof?.missing || 0) + Number(supplierProof?.missing || 0);
    const { rows: [held] } = await client.query(
      `SELECT COALESCE(SUM(quantity),0)::int AS qty,
              COALESCE(SUM(amount_minor),0)::text AS amount_minor,
              COALESCE(SUM(amount_kmf),0)::text AS amount_kmf
         FROM local_item_refund_reservations WHERE order_id=$1 AND status='reserved'`,
      [orderId]
    );
    const { rows: [lineHeld] } = await client.query(
      `SELECT COALESCE(SUM(quantity),0)::int AS qty
         FROM local_item_refund_reservations WHERE order_item_id=$1 AND status='reserved'`,
      [orderItemId]
    );
    if (missing < 1 || quantity + Number(lineHeld?.qty || 0) > missing
        || quantity + Number(lineHeld?.qty || 0)
           + Number(item.qty_refunded || 0) + Number(item.qty_collected || 0) > Number(item.quantity))
      fail('LOCAL_REFUND_SHORTAGE_EXCEEDED', 'Quantité au-delà du manquant attesté');

    // Full hold while legacy or PSP rails are unresolved. No wallet + cash overlap.
    const { rows: oldRefunds } = await client.query(
      'SELECT id FROM refunds WHERE order_id=$1 LIMIT 1', [orderId]
    );
    const { rows: pspIntent } = await client.query(
      'SELECT id FROM refund_execution_intents WHERE order_id=$1 LIMIT 1', [orderId]
    );
    const { rows: pspItem } = await client.query(
      'SELECT id FROM order_item_refund_reservations WHERE order_id=$1 LIMIT 1', [orderId]
    );
    if (oldRefunds.length || pspIntent.length || pspItem.length)
      fail('LOCAL_REFUND_CROSS_RAIL_RECONCILIATION', 'Remboursement antérieur ou PSP à rapprocher');

    const source = await sourceForPaidLocalOrder(client, order);
    const money = localShare({
      unitKmf: item.price_kmf, quantity, totalKmf: order.total_kmf,
      capturedMinor: source.paidMinor
    });
    if (BigInt(held?.amount_minor || 0) + money.amountMinor > money.captureMinor
        || decimalMinor(held?.amount_kmf || '0', 2) + decimalMinor(money.amountKmf, 2)
           > decimalMinor(order.total_kmf, 2))
      fail('LOCAL_REFUND_AMOUNT_EXCEEDS_CAPTURE', 'Cumul des obligations supérieur à la capture');

    const { rows: [reserved] } = await client.query(
      `INSERT INTO local_item_refund_reservations
          (order_id, order_item_id, source_incident_id, market_id, operation_key,
           payment_mode, capture_ref, currency, minor_unit, amount_minor,
           amount_kmf, quantity, reason, initiated_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        RETURNING id`,
      [orderId, orderItemId, incidentId, order.market_id, operationKey,
       source.paymentMode, source.captureRef, source.currency, source.minorUnit,
       String(money.amountMinor), money.amountKmf, quantity, reason.trim(), actor.id]
    );
    await client.query('COMMIT'); inTransaction = false;
    return { reservationId: reserved.id, status: 'reserved', paid: false,
      amountMinor: String(money.amountMinor), currency: source.currency, replayed: false };
  } catch (error) {
    if (inTransaction) await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}

module.exports = {
  LocalItemRefundError, decimalMinor, localShare, reserveLocalShortage
};
