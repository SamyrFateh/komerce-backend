/**
 * @komerce-arch
 * @role          payment-status-owner
 * @domain        payment
 * @layer         service
 * @criticality   critical
 * @inputs        order_id, options { client, cashPaidAt, guardPending }
 * @outputs       orders.payment_status, payment_timestamps
 * @depends       db.js
 * @used-by       services/admin-order-refund.js, services/payment-stripe.js, services/parcel-auto-create-service.js, services/payment-paypal.js
 * @db-read       orders
 * @db-write      orders
 * @db-txn        payment_status_single_owner, optional_caller_transaction
 * @doctrine      resolve_before_behavior_change, payment_status_single_entry
 * @impact-areas  payments, orders, dashboards
 * @version       2026-06
 */

'use strict';
/**
 * KOMERCE — Payment Service (services/payment-service.js)
 *
 * Owner UNIQUE des mutations orders.payment_status (invariant I-BACK-4).
 * Le STATUT (orders.status) reste owné par order-status-machine.js :
 * ce service ne touche JAMAIS orders.status.
 *
 * Chaque fonction accepte { client } pour s'inscrire dans une transaction
 * existante (cf. admin-order-refund.js qui passe son client). Sans client,
 * la mutation passe par le pool (db.query).
 *
 * NORMALISATION : toutes les mutations posent updated_at = NOW(). C'est le seul
 * ecart de comportement vs l'existant (payment-stripe.js ne le posait pas) —
 * benin et coherent, a confirmer en revue avant bascule du site Stripe.
 */
const db = require('../db');

// Sélectionne le handle : client transactionnel si fourni, sinon le pool.
const exec = (client) => (client && typeof client.query === 'function') ? client : db;

/**
 * payment_status = 'paid'.
 * @param {object} [opts]
 * @param {object} [opts.client]      client transactionnel optionnel
 * @param {boolean} [opts.cashPaidAt] pose aussi cash_paid_at = NOW() (paiement cash)
 * @returns {Promise<{changed:boolean, rowCount:number}>}
 */
async function markPaid(orderId, { client = null, cashPaidAt = false } = {}) {
  const sql = cashPaidAt
    ? `UPDATE orders SET payment_status = 'paid', cash_paid_at = NOW(), updated_at = NOW() WHERE id = $1`
    : `UPDATE orders SET payment_status = 'paid', updated_at = NOW() WHERE id = $1`;
  const r = await exec(client).query(sql, [orderId]);
  return { changed: r.rowCount > 0, rowCount: r.rowCount };
}

/**
 * payment_status = 'refunded'.
 * NE touche PAS orders.status — le statut 'refunded' passe par
 * transitionOrderStatus() (cf. le pattern correct de admin-order-refund.js).
 * @returns {Promise<{changed:boolean, rowCount:number}>}
 */
async function markRefunded(orderId, { client = null } = {}) {
  const r = await exec(client).query(
    `UPDATE orders SET payment_status = 'refunded', updated_at = NOW() WHERE id = $1`,
    [orderId],
  );
  return { changed: r.rowCount > 0, rowCount: r.rowCount };
}

/**
 * payment_status = 'failed'.
 * @param {object} [opts]
 * @param {boolean} [opts.guardPending=true] n'écrase que payment_status='pending'
 *        (jamais un 'paid' déjà acquis). rowCount=0 => no-op (déjà payé/inconnu),
 *        que l'appelant peut journaliser (cf. payment-stripe.js).
 * @returns {Promise<{changed:boolean, rowCount:number}>}
 */
async function markFailed(orderId, { client = null, guardPending = true } = {}) {
  const sql = guardPending
    ? `UPDATE orders SET payment_status = 'failed', updated_at = NOW() WHERE id = $1 AND payment_status = 'pending'`
    : `UPDATE orders SET payment_status = 'failed', updated_at = NOW() WHERE id = $1`;
  const r = await exec(client).query(sql, [orderId]);
  return { changed: r.rowCount > 0, rowCount: r.rowCount };
}

module.exports = { markPaid, markRefunded, markFailed };
