/**
 * @komerce-arch
 * @role          payment-confirm-pickup-cash-payment
 * @domain        payment
 * @layer         service
 * @criticality   critical
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db, services/order-payment-confirmation.js, services/cash-confirmation-control-service.js, utils/logger.js
 * @used-by       routes/pickup-pay-cash.js, routes/pickup-secret.js
 * @db-read       orders, users, market_operating_assignments, market_cash_control_policies, cash_confirmation_controls
 * @db-write      alerts, cash_collections, cash_confirmation_controls
 * @db-txn        own_transaction, locked_order, shared_cash_control
 * @doctrine      payment_to_stock_single_entry, partner_cash_policy_enforced, dual_approval_before_financial_truth
 * @impact-areas  payment, checkout, cash, relay
 * @version       2026-09
 */

'use strict';

const db = require('../db');
const { confirmPaymentCycle } = require('./order-payment-confirmation');
const {
  prepareCashConfirmation,
  finalizeCashConfirmation,
} = require('./cash-confirmation-control-service');
const { createAlert } = require('../utils/alerts');
const log = require('../utils/logger').child({ module: 'confirm-pickup-cash-payment' });

const PHONE_RX = /^[+]?[0-9\s().-]{6,20}$/;

async function confirmPickupCashPayment({
  orderId,
  user,
  payload,
  generateAndStoreSecret,
}) {
  if (!orderId) throw new Error('[confirmPickupCashPayment] orderId requis');
  if (!user?.id || !user?.role) throw new Error('[confirmPickupCashPayment] user requis');
  if (typeof generateAndStoreSecret !== 'function') {
    throw new Error('[confirmPickupCashPayment] generateAndStoreSecret requis');
  }

  const {
    payer_name,
    payer_id_type,
    payer_id_number,
    payer_note,
    tracking_phone_primary,
    tracking_phone_secondary,
  } = payload || {};

  if (!payer_name || !String(payer_name).trim()) {
    return { status: 400, body: { error: 'Le nom du payeur est obligatoire' } };
  }
  if (tracking_phone_primary && !PHONE_RX.test(tracking_phone_primary)) {
    return { status: 400, body: { error: 'Numéro principal invalide' } };
  }
  if (tracking_phone_secondary && !PHONE_RX.test(tracking_phone_secondary)) {
    return { status: 400, body: { error: 'Numéro secondaire invalide' } };
  }

  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const { rows: [order] } = await client.query(`
      SELECT id, reference, total_kmf, payment_mode, payment_status, status,
             pickup_secret_hash, tracking_phone, tracking_phone_secondary,
             relais_id, market_id
      FROM orders
      WHERE id = $1
      FOR UPDATE
    `, [orderId]);

    if (!order) {
      await client.query('ROLLBACK');
      return { status: 404, body: { error: 'Commande introuvable' } };
    }
    if (order.payment_mode !== 'cash_relais') {
      await client.query('ROLLBACK');
      return { status: 400, body: { error: 'Cette commande n\'est pas en paiement cash relais' } };
    }
    if (order.pickup_secret_hash) {
      await client.query('ROLLBACK');
      return {
        status: 409,
        body: {
          error: 'Un code secret existe déjà pour cette commande. Si le reçu est perdu, utilisez la procédure de régénération admin.',
        },
      };
    }
    if (order.payment_status === 'paid') {
      await client.query('ROLLBACK');
      return {
        status: 409,
        body: { error: 'Cette commande est déjà marquée payée, mais aucun code secret n’est disponible. Escalade admin nécessaire.' },
      };
    }

    // Cross-relais strict : invariant central, jamais désactivable par la politique locale.
    if (user.role === 'agent_relais') {
      let agentRelaisId = null;
      let checkPossible = true;

      try {
        const { rows: [agent] } = await client.query(
          'SELECT relais_id FROM users WHERE id = $1',
          [user.id]
        );
        agentRelaisId = agent?.relais_id || null;
      } catch (e) {
        checkPossible = false;
        log.warn(`[PICKUP-CASH] users.relais_id query failed: ${e.message}`);
      }

      if (!checkPossible || !agentRelaisId) {
        await client.query('ROLLBACK');
        try {
          await createAlert(db, {
            type: 'pickup_cash_confirm_agent_config_error',
            entityType: 'order',
            entityId: order.id,
            severity: 'high',
            title: `agent_relais sans relais_id tente pickup pay-cash — user=${user.id}`,
            description: `order_reference=${order.reference} user_id=${user.id} check_possible=${checkPossible}`,
          });
        } catch (_e) { /* non-bloquant */ }
        return { status: 403, body: { error: 'Configuration agent incomplète — contactez un admin' } };
      }

      if (String(agentRelaisId) !== String(order.relais_id)) {
        await client.query('ROLLBACK');
        try {
          await createAlert(db, {
            type: 'pickup_cash_confirm_cross_relais_blocked',
            entityType: 'order',
            entityId: order.id,
            severity: 'high',
            title: `Cross-relais refusé pickup pay-cash — ${order.reference}`,
            description: `user_id=${user.id} agent_relais_id=${agentRelaisId} order_relais_id=${order.relais_id}`,
          });
        } catch (_e) { /* non-bloquant */ }
        return { status: 403, body: { error: 'Cette commande appartient à un autre relais — vous ne pouvez pas la valider' } };
      }
    }

    const control = await prepareCashConfirmation({
      dbClient: client,
      order,
      actor: { id: user.id, role: user.role },
      source: 'pickup_pay_cash',
    });

    if (!control.allowed) {
      if (control.pending_second) {
        await client.query('COMMIT');
        return {
          status: control.status || 202,
          body: {
            success: false,
            pending_second_approval: true,
            code: control.code,
            message: control.message,
            order_ref: order.reference,
            required_approvals: control.control?.required_approvals || 2,
          },
        };
      }
      await client.query('ROLLBACK');
      return { status: control.status || 409, body: { error: control.message, code: control.code } };
    }

    const cycleResult = await confirmPaymentCycle({
      orderId: order.id,
      actor: { id: user.id, role: user.role },
      source: 'cash_confirm',
      dbClient: client,
      note: 'Paiement espèces confirmé via pickup secret',
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
        body: {
          error: `Stock insuffisant pour "${first.product_name}" — ${first.available} restant(s). Annuler ou ajuster la commande.`,
        },
      };
    }

    const finalPhonePrimary = tracking_phone_primary && tracking_phone_primary.trim()
      ? tracking_phone_primary.trim()
      : (order.tracking_phone || null);
    const finalPhoneSecondary = tracking_phone_secondary && tracking_phone_secondary.trim()
      ? tracking_phone_secondary.trim()
      : null;

    const { code } = await generateAndStoreSecret({
      orderId: order.id,
      relaisId: order.relais_id || null,
      channel: 'cash_relais',
      dbClient: client,
      extraUpdates: {
        payment_received_at: new Date(),
        payment_received_by_agent_id: user.id,
        payer_name: String(payer_name).trim(),
        payer_id_type: payer_id_type || null,
        payer_id_number: payer_id_number || null,
        payer_note: payer_note || null,
        tracking_phone: finalPhonePrimary,
        tracking_phone_secondary: finalPhoneSecondary,
        tracking_phone_confirmed_at: new Date(),
        tracking_phone_confirmed_by_agent_id: user.id,
        cash_paid_at: new Date(),
      },
    });

    await client.query(`
      INSERT INTO cash_collections (order_id, amount_kmf, collected_by, relais_id)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (order_id) DO NOTHING
    `, [order.id, Number(order.total_kmf), user.id, order.relais_id || null]);

    await finalizeCashConfirmation({ dbClient: client, orderId: order.id });
    await client.query('COMMIT');

    return {
      status: 200,
      body: {
        success: true,
        message: 'Paiement encaissé. Imprimez le reçu maintenant.',
        code,
        order_ref: order.reference,
        amount_kmf: Number(order.total_kmf),
        order_id: order.id,
        payer_name: String(payer_name).trim(),
        cash_control: {
          required_approvals: control.control?.required_approvals || 1,
          second_approval: Boolean(control.second_approval),
        },
      },
      postCommit: { orderId: order.id, reference: order.reference },
    };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { confirmPickupCashPayment };
