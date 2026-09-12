/**
 * @komerce-arch
 * @role          cash-payment-confirmation-service
 * @domain        payment
 * @layer         service
 * @criticality   critical
 * @inputs        cash_ref_code, relais_actor, order_reference
 * @outputs       payment_confirmation, stock_transition, rollback_or_alert
 * @depends       services/order-payment-confirmation.js, services/cash-confirmation-control-service.js, db.js
 * @used-by       routes/payments.js, relais-dashboard
 * @db-read       orders, users, market_operating_assignments, market_cash_control_policies, cash_confirmation_controls
 * @db-write      alerts, orders, cash_collections, cash_confirmation_controls
 * @db-txn        cash_confirmation_idempotency, shared_cash_control, rollback_or_alert_on_stock_failure
 * @doctrine      payment_to_stock_single_entry, cash_validation_tracee, cash_rollback_vs_stripe_alert, partner_cash_policy_enforced
 * @impact-areas  cash, orders, stock, relais, notifications, sourcing
 * @version       2026-09
 */

'use strict';

/**
 * KOMERCE — services/payment-cash-confirm.js
 *
 * Confirmation cash par cash_ref_code. Toute confirmation passe par la même
 * Cash Control Boundary que /api/cash/collect et /api/pickup/pay-cash.
 */

const { confirmPaymentCycle } = require('./order-payment-confirmation');
const { ensureSecretGenerated, cacheCodeForReveal } = require('./pickup-secret-service');
const { markCashPaidAt } = require('./order-mutation-service');
const {
  prepareCashConfirmation,
  finalizeCashConfirmation,
} = require('./cash-confirmation-control-service');
const { createAlert } = require('../utils/alerts');
const log = require('../utils/logger').child({ module: 'payment-cash-confirm' });

async function confirmCashByReference({ cashRefCode, actor, triggerPurchasing, db }) {
  if (!cashRefCode) {
    return { status: 400, body: { error: 'cash_ref_code requis' } };
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT * FROM orders
       WHERE cash_ref_code = $1 AND payment_mode = 'cash_relais' AND payment_status = 'pending'
       FOR UPDATE`,
      [cashRefCode]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return { status: 404, body: { error: 'Code invalide ou paiement déjà enregistré' } };
    }

    const order = rows[0];

    // Cross-relais check — invariant central non désactivable.
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
        createAlert(db, {
          type: 'cash_confirm_agent_config_error',
          entityType: 'order',
          entityId: order.id,
          severity: 'high',
          title: `agent_relais sans relais_id tente cash_confirm — user=${actor.id}`,
          description: `order_reference=${order.reference} user_id=${actor.id}`,
        }).catch(() => {});
        return { status: 403, body: { error: 'Configuration agent incomplète — contactez un admin' } };
      }

      if (String(agentRelaisId) !== String(order.relais_id)) {
        await client.query('ROLLBACK');
        log.warn(`[CASH-CONFIRM] ⛔ Cross-relais refusé — agent ${actor.id} (relais ${agentRelaisId}) tentait commande ${order.reference} (relais ${order.relais_id})`);
        createAlert(db, {
          type: 'cash_confirm_cross_relais_blocked',
          entityType: 'order',
          entityId: order.id,
          severity: 'high',
          title: `Cross-relais refusé — ${order.reference}`,
          description: `user_id=${actor.id} agent_relais_id=${agentRelaisId} order_relais_id=${order.relais_id}`,
        }).catch(() => {});
        return { status: 403, body: { error: 'Cette commande appartient à un autre relais — vous ne pouvez pas la valider' } };
      }
    }

    const control = await prepareCashConfirmation({
      dbClient: client,
      order,
      actor,
      source: 'payments_cash_confirm',
    });

    if (!control.allowed) {
      if (control.pending_second) {
        // Le premier visa est une vraie décision de contrôle : on le conserve,
        // mais aucune vérité de paiement/stock n'est créée avant le second acteur.
        await client.query('COMMIT');
        return {
          status: control.status || 202,
          body: {
            success: false,
            pending_second_approval: true,
            code: control.code,
            message: control.message,
            reference: order.reference,
            required_approvals: control.control?.required_approvals || 2,
          },
        };
      }
      await client.query('ROLLBACK');
      return {
        status: control.status || 409,
        body: { error: control.message, code: control.code },
      };
    }

    const cycleResult = await confirmPaymentCycle({
      orderId: order.id,
      actor,
      source: 'cash_confirm',
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

    const secretResult = await ensureSecretGenerated({
      orderId: order.id,
      relaisId: order.relais_id || null,
      channel: 'cash_confirm',
      dbClient: client,
    });

    await client.query(
      `INSERT INTO cash_collections (order_id, amount_kmf, collected_by, relais_id)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (order_id) DO NOTHING`,
      [order.id, Number(order.total_kmf), actor.id, order.relais_id]
    );

    await markCashPaidAt(client, order.id);
    await finalizeCashConfirmation({ dbClient: client, orderId: order.id });
    await client.query('COMMIT');

    if (secretResult.code) {
      cacheCodeForReveal(order.id, secretResult.code)
        .catch(e => log.error({ err: e }, '[CASH-CONFIRM] cacheCodeForReveal error:'));
    }

    const response = {
      status: 200,
      body: {
        message: 'Paiement espèces confirmé — commande validée',
        reference: order.reference,
        paid_at: new Date().toISOString(),
        cash_control: {
          required_approvals: control.control?.required_approvals || 1,
          second_approval: Boolean(control.second_approval),
        },
        next_step: 'Sourcing déclenché automatiquement — bon de commande à l\'agent Dubai',
      },
    };

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
      require('./invoice-service').issueInvoice(order.id)
        .catch(e => log.error({ err: e }, '[CASH-INVOICE] private PDF generation failed'));
      triggerPurchasing(order.id)
        .then(() => log.info({ order_reference: order.reference }, '[PURCHASING] Cash trigger OK'))
        .catch(e => log.error({ err: e, order_reference: order.reference }, '[PURCHASING] Cash trigger error'));
    } catch (e) {
      log.error({ err: e }, '[CASH-POSTCOMMIT] Non-fatal notification error');
    }

    return response;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  confirmCashByReference,
};
