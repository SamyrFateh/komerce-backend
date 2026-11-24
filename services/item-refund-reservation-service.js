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
async function readVerifiedShortageCandidates({ orderReference, actor, db = dbDefault }) {
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
  const supportedProvider = ['stripe_eur','paypal_eur'].includes(order.payment_mode);
  const blocked = order.payment_status!=='paid' || !supportedProvider || order.has_capture!==true ||
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
  if (!Number.isSafeInteger(quantity) || quantity <= 0) fail('ITEM_REFUND_QTY_INVALID', 'Quantité invalide', 400);
  if (typeof reason !== 'string' || reason.trim().length < 8) fail('ITEM_REFUND_REASON_REQUIRED', 'Motif détaillé requis', 400);

  const client = await db.getClient();
  let inTx = false;
  try {
    await client.query('BEGIN'); inTx = true;
    const { rows: [order] } = await client.query(
      'SELECT id, market_id, payment_status, payment_mode, total_kmf, total_eur, stripe_payment_id, paypal_capture_id FROM orders WHERE id = $1 FOR UPDATE',
      [orderId]
    );
    if (!order || order.payment_status !== 'paid') fail('ITEM_REFUND_ORDER_NOT_PAID', 'Commande non payée');
    const provider = order.payment_mode === 'stripe_eur' ? 'stripe'
      : order.payment_mode === 'paypal_eur' ? 'paypal' : null;
    const captureRef = provider === 'stripe' ? order.stripe_payment_id : order.paypal_capture_id;
    if (!provider || !captureRef || !order.market_id) {
      fail('ITEM_REFUND_PAYMENT_METHOD_UNSUPPORTED', 'PSP ou capture non disponible pour remboursement automatisé');
    }
    const { rows: [item] } = await client.query(
      'SELECT id, order_id, quantity, price_kmf, qty_collected, qty_refunded FROM order_items WHERE id = $1 AND order_id = $2 FOR UPDATE',
      [orderItemId, orderId]
    );
    if (!item || Number(item.qty_collected) >= Number(item.quantity))
      fail('ITEM_REFUND_ITEM_NOT_ELIGIBLE', 'Article absent ou entièrement remis');

    const { rows: [existing] } = await client.query(
      'SELECT id, order_item_id, source_incident_id, quantity, reason, status, amount_eur FROM order_item_refund_reservations WHERE order_id = $1 AND operation_key = $2 FOR UPDATE',
      [orderId, operationKey]
    );
    if (existing) {
      if (String(existing.order_item_id) !== String(orderItemId) ||
          String(existing.source_incident_id) !== String(incidentId) ||
          Number(existing.quantity) !== quantity || existing.reason !== reason.trim()) {
        fail('ITEM_REFUND_REPLAY_CONFLICT', 'Même événement avec des paramètres différents');
      }
      await client.query('COMMIT'); inTx = false;
      return { reservationId: existing.id, status: existing.status, amountEur: existing.amount_eur, replayed: true,
        paid: existing.status === 'confirmed' ? true : null };
    }

    const { rows: [proof] } = await client.query(
      'SELECT COALESCE(SUM(GREATEST(expected_qty - received_qty, 0)),0)::int AS verified_missing FROM international_shipment_relay_receipts WHERE order_item_id = $1 AND incident_id = $2',
      [orderItemId, incidentId]
    );
    // H1 : la clôture Hub d'une ligne d'achat sans reliquat constate aussi un manquant (incident « rupture fournisseur »).
    const { rows: [supplier] } = await client.query(
      `SELECT COALESCE(SUM((details->>'missing_quantity')::int), 0)::int AS verified_missing
         FROM incidents
        WHERE id = $1 AND order_item_id = $2 AND order_id = $3 AND incident_type = 'reconciliation_error'
          AND details->>'type' = 'supplier_shortage'`,
      [incidentId, orderItemId, orderId]
    );
    const { rows: [reserved] } = await client.query(
      "SELECT COALESCE(SUM(quantity),0)::int AS reserved FROM order_item_refund_reservations WHERE order_item_id = $1 AND status <> 'failed'",
      [orderItemId]
    );
    const missing = Number(proof?.verified_missing || 0) + Number(supplier?.verified_missing || 0), already = Number(reserved?.reserved || 0);
    if (!missing || quantity + already > missing ||
        quantity + already + Number(item.qty_collected) > Number(item.quantity) ||
        Number(item.qty_refunded) > Number(item.quantity) - Number(item.qty_collected)) {
      fail('ITEM_REFUND_EXCEEDS_VERIFIED_SHORTAGE', 'Quantité supérieure au manquant réellement attesté');
    }

    // Les remboursements legacy et les intentions non résolues exigent un
    // rapprochement préalable. On n'additionne pas deux circuits de paiement.
    const { rows: legacy } = await client.query("SELECT id FROM refunds WHERE order_id = $1 AND refund_type NOT LIKE 'item:%' LIMIT 1", [orderId]);
    if (legacy.length) fail('ITEM_REFUND_LEGACY_RECONCILIATION_REQUIRED', 'Ancien remboursement non rapproché');
    const { rows: outstanding } = await client.query(
      "SELECT id FROM refund_execution_intents WHERE order_id = $1 AND status IN ('reserved','processing','unknown') LIMIT 1",
      [orderId]
    );
    if (outstanding.length) fail('ITEM_REFUND_UNRESOLVED_INTENT', 'Intention PSP précédente encore ouverte');

    const money = calculateRefundShare({
      quantity, priceKmf: item.price_kmf, totalKmf: order.total_kmf, totalEur: order.total_eur,
    });
    const { rows: [totals] } = await client.query(
      "SELECT COALESCE(SUM(amount_eur),0)::text AS used_eur FROM refund_execution_intents WHERE order_id = $1 AND status IN ('reserved','processing','unknown','confirmed')",
      [orderId]
    );
    if (minorUnits(totals?.used_eur ?? '0') + money.eurCents > minorUnits(order.total_eur)) {
      fail('ITEM_REFUND_CAPTURE_EXCEEDED', 'Cumul des intentions supérieur à la capture');
    }

    const intentKey = 'item:' + String(operationKey).toLowerCase();
    const { rows: [intent] } = await client.query(
      "INSERT INTO refund_execution_intents(order_id,market_id,provider,capture_ref,operation_key,amount_eur,initiated_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id",
      [order.id, order.market_id, provider, captureRef, intentKey, money.amountEur, actor.id]
    );
    const { rows: [reservation] } = await client.query(
      "INSERT INTO order_item_refund_reservations(order_id,order_item_id,source_incident_id,refund_intent_id,operation_key,quantity,amount_kmf,amount_eur,reason,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id",
      [orderId, orderItemId, incidentId, intent.id, operationKey, quantity,
        money.amountKmf, money.amountEur, reason.trim(), actor.id]
    );
    await client.query('COMMIT'); inTx = false;
    return { reservationId: reservation.id, intentId: intent.id, status: 'reserved',
      amountKmf: money.amountKmf, amountEur: money.amountEur, quantity, replayed: false, paid: false };
  } catch (err) {
    if (inTx) await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { ItemRefundError, calculateRefundShare, readVerifiedShortageCandidates, reserveVerifiedShortage };
