/**
 * @komerce-arch
 * @role          orders-payment-status-mutation-boundary
 * @domain        orders
 * @layer         service
 * @criticality   critical
 * @inputs        order_id, options { client, cashPaidAt, paymentEvent }, simulation_target_status
 * @outputs       orders.payment_status, payment_timestamps
 * @depends       db.js, services/payment-status-validator.js
 * @used-by       services/admin-order-refund.js, services/payment-stripe.js, services/parcel-auto-create-service.js, services/payment-paypal.js, services/simulator/state-advancer.js
 * @db-read       orders
 * @db-write      orders
 * @db-txn        payment_status_single_owner, optional_caller_transaction
 * @doctrine      resolve_before_behavior_change, payment_status_single_entry, payment_status_transition_matrix
 * @impact-areas  payments, orders, dashboards, simulator
 * @version       2026-09
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
 * benin et coherent. Confirmé en revue et appliqué lors de la bascule du site
 * Stripe (P3-A.3, 2026-06) : handleStripePaymentFailed pose désormais aussi
 * updated_at sur la transition pending→failed.
 *
 * GARDES (P5-N2/N3, 2026-07) : chaque mutation métier encode désormais sa clause
 * WHERE à partir de payment-status-validator.js (source unique de la matrice
 * de transitions, partagée avec order-status-machine.js). Plus aucune garde
 * métier n'est contournable par l'appelant.
 *
 * SIMULATION (Debt Zero, 2026-09) : forcePaymentStatusForSimulation() est une
 * primitive explicitement NON-PRODUCTION destinée au chaos-test. Elle permet
 * au simulateur de fabriquer volontairement un état incohérent tout en gardant
 * l'écriture physique de payment_status chez son owner canonique. Ce n'est pas
 * une transition métier et cette fonction refuse de s'exécuter quand
 * KOMERCE_ENV ou NODE_ENV vaut "production".
 */
const db = require('../db');
const { sourceStatusesFor, sqlGuard } = require('./payment-status-validator');

// Sélectionne le handle : client transactionnel si fourni, sinon le pool.
const exec = (client) => (client && typeof client.query === 'function') ? client : db;

function runtimeEnvironment() {
  const komerceEnv = String(process.env.KOMERCE_ENV || '').trim().toLowerCase();
  if (komerceEnv) return komerceEnv;
  return String(process.env.NODE_ENV || '').trim().toLowerCase();
}

/**
 * payment_status = 'paid'.
 * @param {object} [opts]
 * @param {object} [opts.client]      client transactionnel optionnel
 * @param {boolean} [opts.cashPaidAt] pose aussi cash_paid_at = NOW() (paiement cash)
 * @param {object} [opts.paymentEvent] { type, externalId } — requis pour débloquer
 *        failed→paid (retry identifiable). Sans lui, seul pending→paid s'applique ;
 *        un ordre 'failed' ou 'refunded' n'est jamais réécrasé (rowCount=0).
 * @returns {Promise<{changed:boolean, rowCount:number}>}
 */
async function markPaid(orderId, { client = null, cashPaidAt = false, paymentEvent = null } = {}) {
  const guard = sqlGuard(sourceStatusesFor('paid', { paymentEvent }));
  const sql = cashPaidAt
    ? `UPDATE orders SET payment_status = 'paid', cash_paid_at = NOW(), updated_at = NOW() WHERE id = $1 AND ${guard}`
    : `UPDATE orders SET payment_status = 'paid', updated_at = NOW() WHERE id = $1 AND ${guard}`;
  const r = await exec(client).query(sql, [orderId]);
  return { changed: r.rowCount > 0, rowCount: r.rowCount };
}

/**
 * payment_status = 'refunded'.
 * NE touche PAS orders.status — le statut 'refunded' passe par
 * transitionOrderStatus() (cf. le pattern correct de admin-order-refund.js).
 * Garde : source ∈ {paid} (cf. payment-status-validator).
 * @returns {Promise<{changed:boolean, rowCount:number}>}
 */
async function markRefunded(orderId, { client = null } = {}) {
  const guard = sqlGuard(sourceStatusesFor('refunded'));
  const r = await exec(client).query(
    `UPDATE orders SET payment_status = 'refunded', updated_at = NOW() WHERE id = $1 AND ${guard}`,
    [orderId],
  );
  return { changed: r.rowCount > 0, rowCount: r.rowCount };
}

/**
 * payment_status = 'failed'.
 * Garde non contournable : n'écrase que payment_status='pending' (jamais un
 * 'paid' déjà acquis, jamais un 'refunded'). rowCount=0 => no-op, que
 * l'appelant peut journaliser (cf. payment-stripe.js).
 * @returns {Promise<{changed:boolean, rowCount:number}>}
 */
async function markFailed(orderId, { client = null } = {}) {
  const guard = sqlGuard(sourceStatusesFor('failed'));
  const sql = `UPDATE orders SET payment_status = 'failed', updated_at = NOW() WHERE id = $1 AND ${guard}`;
  const r = await exec(client).query(sql, [orderId]);
  return { changed: r.rowCount > 0, rowCount: r.rowCount };
}

/**
 * Mutation volontairement hors matrice pour le simulateur de chaos uniquement.
 * Elle reste ici afin que services/payment-service.js demeure l'unique owner
 * physique de orders.payment_status hors effet historique de la state machine.
 *
 * Garde fail-closed sur l'environnement métier : aucun appel possible en prod.
 * Les seules cibles utiles au scénario desync_payment sont pending et paid.
 */
async function forcePaymentStatusForSimulation(orderId, targetStatus, { client = null } = {}) {
  if (runtimeEnvironment() === 'production') {
    throw Object.assign(
      new Error('Mutation payment_status de simulation interdite en production'),
      { code: 'SIMULATION_PRODUCTION_FORBIDDEN' }
    );
  }
  if (!['pending', 'paid'].includes(targetStatus)) {
    throw Object.assign(
      new Error(`Statut de paiement chaos non autorisé: ${targetStatus}`),
      { code: 'SIMULATION_PAYMENT_STATUS_INVALID' }
    );
  }
  const r = await exec(client).query(
    'UPDATE orders SET payment_status = $1, updated_at = NOW() WHERE id = $2',
    [targetStatus, orderId]
  );
  return { changed: r.rowCount > 0, rowCount: r.rowCount };
}

module.exports = {
  markPaid,
  markRefunded,
  markFailed,
  forcePaymentStatusForSimulation,
};