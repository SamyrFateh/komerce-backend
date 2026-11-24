/**
 * @komerce-arch
 * @role          item-refund-reservation
 * @domain        refunds
 * @layer         service
 * @criticality   critical
 * @inputs        order, order-item, verified relay shortage incident, quantity, stable event uuid
 * @outputs       durable item-scoped reservation + committed PSP intent, never a refund payout
 * @depends       db, services/refund-intent-ledger.js
 * @used-by       routes/admin/orders.js
 * @db-read       orders, order_items, products, international_shipment_relay_receipts, incidents, order_item_refund_reservations, refund_execution_intents, refunds, local_item_refund_reservations
 * @db-write      order_item_refund_reservations, refund_execution_intents
 * @db-txn        order lock and incident proof, atomic reservation, commit before PSP
 * @doctrine      refund_to_payer, no_duplicate_refund, incident_proof_required, no_psp_in_sql_transaction
 * @impact-areas  orders, refunds, logistics, finance
 * @version       2026-11
 */
'use strict';
const dbDefault = require('../db');

class ItemRefundError extends Error {
  constructor(code, message, status = 409) { super(message); this.code = code; this.status = status; }
}
const fail = (code, message, status) => { throw new ItemRefundError(code, message, status); };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Read-only candidate projection for N26a. The reservation transaction below
 * remains authoritative and rechecks the shortage, quantity and payment rails. */
async function readVerifiedShortageCandidates({ orderReference, actor, db = dbDefault, allowLocal = false }) {
  if (!actor?.id || actor.role !== 'admin') fail('ITEM_REFUND_ADMIN_REQUIRED', 'Arbitrage financier réservé admin', 403);
  const reference = String(orderReference || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,79}$/.test(reference))
    fail('ITEM_REFUND_REFERENCE_INVALID', 'Référence commande invalide', 400);
  const { rows: [order] } = await db.query(
    `SELECT id,reference,status::text AS status,payment_mode::text AS payment_mode,
            payment_status::text AS payment_status,
            CASE WHEN payment_mode='stripe_eur' THEN NULLIF(stripe_payment_id,'') IS NOT NULL
                 WHEN payment_mode='paypal_eur' THEN NULLIF(paypal_capture_id,'') IS NOT NULL
                 ELSE false END AS has_capture
       FROM orders WHERE UPPER(reference)=UPPER($1)`, [reference]);
  if (!order) fail('ITEM_REFUND_ORDER_NOT_FOUND', 'Commande introuvable', 404);

  const [{ rows: items }, { rows: supplier }, { rows: relay }, { rows: blockers }] = await Promise.all([
    db.query(`SELECT oi.id,oi.quantity,oi.qty_collected,oi.qty_refunded,p.name AS product_name,
        COALESCE((SELECT SUM(r.quantity) FROM order_item_refund_reservations r
                   WHERE r.order_item_id=oi.id AND r.status<>'failed'),0)::int AS reserved
      FROM order_items oi LEFT JOIN products p ON p.id=oi.product_id
      WHERE oi.order_id=$1 ORDER BY oi.created_at,oi.id`, [order.id]),
    db.query(`SELECT id AS incident_id,order_item_id,
        CASE WHEN details->>'missing_quantity' ~ '^[0-9]+$'
          THEN (details->>'missing_quantity')::int ELSE 0 END AS missing
      FROM incidents WHERE order_id=$1 AND incident_type='reconciliation_error'
        AND details->>'type'='supplier_shortage'`, [order.id]),
    db.query(`SELECT r.incident_id,r.order_item_id,
        SUM(GREATEST(r.expected_qty-r.received_qty,0))::int AS missing
      FROM international_shipment_relay_receipts r JOIN order_items oi ON oi.id=r.order_item_id
      WHERE oi.order_id=$1 AND r.incident_id IS NOT NULL
      GROUP BY r.incident_id,r.order_item_id`, [order.id]),
    db.query(`SELECT
        EXISTS(SELECT 1 FROM refunds WHERE order_id=$1 AND refund_type NOT LIKE 'item:%') AS legacy_refund,
        EXISTS(SELECT 1 FROM refund_execution_intents WHERE order_id=$1
          AND status IN ('reserved','processing','unknown')) AS unresolved_intent,
        EXISTS(SELECT 1 FROM local_item_refund_reservations WHERE order_id=$1 AND status='reserved') AS local_claim`, [order.id]),
  ]);
  const itemById = new Map(items.map(item => [String(item.id), item]));
  const grouped = new Map();
  [...supplier.map(row => ({ ...row, source:'supplier_shortage' })),
    ...relay.map(row => ({ ...row, source:'relay_receipt' }))].forEach(row => {
    const key = String(row.order_item_id)+':'+String(row.incident_id);
    const current = grouped.get(key) || { ...row, missing:0, sources:new Set() };
    current.missing += Number(row.missing)||0;
    current.sources.add(row.source);
    grouped.set(key,current);
  });
  const supportedProvider = ['stripe_eur','paypal_eur'].includes(order.payment_mode) && order.has_capture===true;
  const supportedLocalRail = allowLocal && ['cash_relais','mobile_money'].includes(order.payment_mode);
  const blocked = order.payment_status!=='paid' || (!supportedProvider && !supportedLocalRail) ||
    blockers[0]?.legacy_refund || blockers[0]?.unresolved_intent || blockers[0]?.local_claim;
  const candidates = [...grouped.values()].flatMap(proof => {
    const item=itemById.get(String(proof.order_item_id));
    if(!item)return [];
    const held=Number(item.reserved)||0;
    const available=Math.max(0,Math.min(Number(item.quantity)-Number(item.qty_collected||0)-
      Number(item.qty_refunded||0)-held,Number(proof.missing)-held));
    return !blocked&&available>0?[{order_item_id:proof.order_item_id,incident_id:proof.incident_id,
      proof:[...proof.sources].join('+'),verified_missing:Number(proof.missing),available_quantity:available}]:[];
  });
  return {order:{id:order.id,reference:order.reference,status:order.status,
    payment_mode:order.payment_mode,payment_status:order.payment_status},
    items:items.map(item=>({id:item.id,product_name:item.product_name,quantity:Number(item.quantity),
      qty_collected:Number(item.qty_collected||0),qty_refunded:Number(item.qty_refunded||0)})),
    candidates,blocked:Boolean(blocked)};
}

function minorUnits(value) {
  const s = String(value ?? '').trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(s)) fail('ITEM_REFUND_MONEY_INVALID', 'Montant décimal non fiable', 400);
  const [whole, fraction = ''] = s.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}
const toMoney = cents => (cents / 100n) + '.' + (cents % 100n).toString().padStart(2, '0');

/** Prorata de la ligne sur l'encaissé ORIGINEL. Aucun taux de change du jour. */
function calculateRefundShare({ quantity, priceKmf, totalKmf, totalEur }) {
  if (!Number.isSafeInteger(quantity) || quantity < 1) fail('ITEM_REFUND_QTY_INVALID', 'Quantité invalide', 400);
  const unitKmf = minorUnits(priceKmf), capturedKmf = minorUnits(totalKmf), capturedEur = minorUnits(totalEur);
  const lineKmf = unitKmf * BigInt(quantity);
  if (lineKmf <= 0n || capturedKmf <= 0n || capturedEur <= 0n || lineKmf > capturedKmf) {
    fail('ITEM_REFUND_SNAPSHOT_UNRELIABLE', 'Montants capturés ou prix de ligne incompatibles');
  }
  const eurCents = (lineKmf * capturedEur + capturedKmf / 2n) / capturedKmf;
  if (eurCents <= 0n || eurCents > capturedEur) fail('ITEM_REFUND_EUR_ZERO_OR_EXCESS', 'Montant EUR hors plafond');
  return { amountKmf: toMoney(lineKmf), amountEur: toMoney(eurCents), eurCents };
}

/**
 * P0 E7 : ce service réserve l'indemnisation d'un manquant REEL déjà attesté.
 * Il ne débite pas Stripe/PayPal, ne crédite pas le wallet et ne prétend pas
 * avoir terminé une annulation client ; le règlement nécessite son propre flux.
 */
async function reserveVerifiedShortage({
  orderId, orderItemId, incidentId, quantity, operationKey, reason, actor, db = dbDefault,
}) {
  if (![orderId, orderItemId, incidentId, operationKey].every(x => UUID.test(String(x || '')))) {
    fail('ITEM_REFUND_IDENTIFIER_INVALID', 'Identifiant UUID invalide', 400);
  }
  if (!actor?.id || actor.role !== 'admin') fail('ITEM_REFUND_ADMIN_REQUIRED', 'Arbitrage financier réservé admin', 403);