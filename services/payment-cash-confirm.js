/**
 * @komerce-arch
 * @role          cash-payment-confirmation-service
 * @domain        payment
 * @layer         service
 * @criticality   critical
 * @inputs        cash_ref_code, relais_actor, order_reference
 * @outputs       payment_confirmation, stock_transition, rollback_or_alert
 * @depends       services/order-payment-confirmation.js, db.js
 * @used-by       routes/payments.js, relais-dashboard
 * @db-read       orders, users
 * @db-write      alerts, orders
 * @db-txn        cash_confirmation_idempotency, rollback_or_alert_on_stock_failure
 * @doctrine      payment_to_stock_single_entry, cash_validation_tracee, cash_rollback_vs_stripe_alert
 * @impact-areas  cash, orders, stock, relais, notifications, sourcing
 * @version       2026-06
 */

'use strict';

/**
 * KOMERCE — services/payment-cash-confirm.js  (R5)
 *
 * Logique métier de confirmation cash par code de référence,
 * extraite de routes/payments.js (POST /api/payments/cash/confirm).
 * La route reste une façade : auth + validate + appel service + réponse.
 *
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  Invariants respectés                                               ║
 * ║  I-01 : toute transition passe par order-status-machine            ║
 * ║  I-02 : confirmPaymentCycle = seul point d'entrée paiement→stock   ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * Exports :
 *   confirmCashByReference({ cashRefCode, actor, triggerPurchasing, db })
 */

const { confirmPaymentCycle } = require('./order-payment-confirmation');
const log = require('../utils/logger').child({ module: 'payment-cash-confirm' });

// ─── confirmCashByReference ────────────────────────────────────────────────────
/**
 * Confirme un paiement cash par cash_ref_code.
 * Ouvre sa propre transaction (BEGIN/COMMIT/ROLLBACK), vérifie le cross-relais,
 * appelle confirmPaymentCycle, puis déclenche notification/purchasing post-commit.
 *
 * @param {object} opts
 * @param {string} opts.cashRefCode
 * @param {object} opts.actor               — { id, role } depuis req.user
 * @param {Function} opts.triggerPurchasing
 * @param {object} opts.db                  — module db (pool)
 * @returns {{ status: number, body: object }}
 */
async function confirmCashByReference({ cashRefCode, actor, triggerPurchasing, db }) {
  if (!cashRefCode) {
    return { status: 400, body: { error: 'cash_ref_code requis' } };
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT * FROM orders
       WHERE cash_ref_code = $1 AND payment_mode = 'cash_relais' AND payment_status = 'pending'`,
      [cashRefCode]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return { status: 404, body: { error: 'Code invalide ou paiement déjà enregistré' } };
    }

    const order = rows[0];

    // Cross-relais check
    if (actor.role === 'agent_relais') {
      let agentRelaisId = null;
      let checkPossible = true;
      try {
        const { rows: [agent] } = await client.query(
          'SELECT relais_id FROM users WHERE id = $1', [actor.id]
        );
        agentRelaisId = agent?.relais_id || null;
      } catch (e) {
        checkPossible = false;
        log.warn(`[CASH-CONFIRM] users.relais_id query failed: ${e.message}`);
      }

      if (!checkPossible || !agentRelaisId) {
        await client.query('ROLLBACK');
        db.query(
          `INSERT INTO alerts (level, source, message, payload) VALUES ('elevated', 'cash_confirm', $1, $2)`,
          [`agent_relais sans relais_id tente cash_confirm: user=${actor.id}`,
           JSON.stringify({ order_reference: order.reference, user_id: actor.id })]
        ).catch(() => {});
        return { status: 403, body: { error: 'Configuration agent incomplète — contactez un admin' } };
      }

      if (String(agentRelaisId) !== String(order.relais_id)) {
        await client.query('ROLLBACK');
        log.warn(`[CASH-CONFIRM] ⛔ Cross-relais refusé — agent ${actor.id} (relais ${agentRelaisId}) tentait commande ${order.reference} (relais ${order.relais_id})`);
        db.query(
          `INSERT INTO alerts (level, source, message, payload) VALUES ('elevated', 'cash_confirm', $1, $2)`,
          [`Cross-relais refusé: ${order.reference}`,
           JSON.stringify({ user_id: actor.id, agent_relais_id: agentRelaisId, order_relais_id: order.relais_id, order_reference: order.reference })]
        ).catch(() => {});
        return { status: 403, body: { error: 'Cette commande appartient à un autre relais — vous ne pouvez pas la valider' } };
      }
    }

    // Hub I-02
    const cycleResult = await confirmPaymentCycle({
      orderId:  order.id,
      actor,
      source:   'cash_confirm',
      dbClient: client,
    });

    if (!cycleResult.success && !cycleResult.noop) {
      await client.query('ROLLBACK');
      return { status: 409, body: { error: cycleResult.error } };
    }
    if (cycleResult.stockBlocked) {
      await client.query('ROLLBACK');
      const first = cycleResult.insufficientItems[0];
      return {
        status: 409,
        body: { error: `Stock insuffisant pour "${first.product_name}" — ${first.available} restant(s).` },
      };
    }

    await client.query(
      'UPDATE orders SET cash_paid_at = COALESCE(cash_paid_at, NOW()) WHERE id = $1', [order.id]
    );
    await client.query('COMMIT');

    const response = {
      status: 200,
      body: {
        message:   'Paiement espèces confirmé — commande validée',
        reference: order.reference,
        paid_at:   new Date().toISOString(),
        next_step: 'Sourcing déclenché automatiquement — bon de commande à l\'agent Dubai',
      },
    };

    // Post-commit fire-and-forget — non bloquant
    // LOY-01 — Hook fidélité gros panier
    try {
      const loyaltyService = require('./loyalty-service');
      loyaltyService.handleOrderConfirmed({ orderId: order.id })
        .then(r => { if (r && !r.skipped) log.info({ orderId: order.id }, '[loyalty] hook OK:', r); })
        .catch(e => log.warn({ err: e }, '[loyalty] hook error:'));
    } catch (_) { /* non-bloquant */ }

    try {
      const notifSvc = require('./notification-service');
      notifSvc.notifyPaymentConfirmed(order.id, order.reference)
        .catch(e => log.error({ err: e }, '[CASH-NOTIF] notification failed'));
      // O7.2 (Cycle A) : lien facture désormais construit et envoyé par orders
      // lui-même (services/invoice-service.js), pas par notifications.
      require('./invoice-service').sendInvoiceReadyNotification(order.id, order.reference)
        .catch(e => log.error({ err: e }, '[CASH-INVOICE-NOTIF] notification failed'));
      triggerPurchasing(order.id)
        .then(() => log.info({ order_reference: order.reference }, '[PURCHASING] Cash trigger OK'))
        .catch(e => log.error({ err: e, order_reference: order.reference }, '[PURCHASING] Cash trigger error'));
    } catch (e) {
      log.error({ err: e }, '[CASH-POSTCOMMIT] Non-fatal notification error');
    }

    return response;

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  confirmCashByReference,
};
