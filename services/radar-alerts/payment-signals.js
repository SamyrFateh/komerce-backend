/**
 * @komerce-arch
 * @role          radar-payment-signals
 * @domain        decision-signals
 * @layer         service
 * @criticality   medium
 * @inputs        runtime_context
 * @outputs       response_or_domain_result
 * @depends       db.js
 * @used-by       services/radar-queries.js
 * @db-read       orders, parcels
 * @db-write      none
 * @db-txn        none
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  decision-signals
 * @version       2026-08
 */

'use strict';

/**
 * services/radar-alerts/payment-signals.js
 *
 * Alertes Radar liées aux modes de paiement et à l'attente de règlement.
 * Extrait de services/radar-queries.js::getAlerts() (checks A, B, D).
 * Chaque check retourne un objet alerte ou null — jamais d'exception.
 */

async function checkCashOverdue(db, cashTimeoutHrs) {
  const { rows: cashOverdue } = await db.query(`
    SELECT COUNT(*) AS cnt, COALESCE(SUM(total_kmf), 0) AS total_kmf
    FROM orders
    WHERE payment_mode = 'cash_relais'
      AND status = 'pending'
      AND created_at < NOW() - ($1 * INTERVAL '1 hour')
  `, [cashTimeoutHrs]);

  if (cashOverdue[0].cnt <= 0) return null;

  return {
    level: 'critical',
    icon: '💸',
    code: 'CASH_OVERDUE',
    title: `${cashOverdue[0].cnt} commande(s) cash impayée(s) > ${cashTimeoutHrs}h`,
    value_kmf: Number(cashOverdue[0].total_kmf),
    count: Number(cashOverdue[0].cnt),
    action: 'Relancer ou annuler',
    target_view: 'orders',
    target_filter: { payment_mode: 'cash_relais', status: 'pending', overdue: true },
  };
}

async function checkStripeFailed(db, paymentFailedCt) {
  const { rows: stripeFailed } = await db.query(`
    SELECT COUNT(*) AS cnt
    FROM orders
    WHERE payment_mode = 'stripe_eur'
      AND payment_status = 'failed'
      AND created_at > NOW() - INTERVAL '24 hours'
  `).catch(() => ({ rows: [{ cnt: 0 }] }));

  if (Number(stripeFailed[0].cnt) < paymentFailedCt) return null;

  return {
    level: 'critical',
    icon: '🚨',
    code: 'STRIPE_FAILED',
    title: `${stripeFailed[0].cnt} paiement(s) Stripe échoué(s) en 24h`,
    count: Number(stripeFailed[0].cnt),
    action: 'Vérifier Stripe dashboard',
    target_view: 'orders',
    target_filter: { payment_status: 'failed' },
  };
}

async function checkCashPendingAtRelais(db, cashCollectKmf) {
  const { rows: cashPending } = await db.query(`
    SELECT COUNT(*) AS cnt, COALESCE(SUM(total_kmf), 0) AS total_kmf
    FROM orders
    WHERE payment_mode = 'cash_relais'
      AND status = 'available'
      AND total_kmf > 0
  `);

  const cashPendingKmf = Number(cashPending[0].total_kmf);
  if (cashPendingKmf < cashCollectKmf) return null;

  return {
    level: 'critical',
    icon: '💰',
    code: 'CASH_PENDING_HIGH',
    title: `${cashPendingKmf.toLocaleString('fr-FR')} KMF attendus aux relais`,
    value_kmf: cashPendingKmf,
    count: Number(cashPending[0].cnt),
    action: 'Accélérer collecte',
    target_view: 'relais',
    target_filter: {},
  };
}

module.exports = {
  checkCashOverdue,
  checkStripeFailed,
  checkCashPendingAtRelais,
};
