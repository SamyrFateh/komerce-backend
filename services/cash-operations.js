/**
 * @komerce-arch
 * @role          payment-cash-operations
 * @domain        payment
 * @layer         service
 * @criticality   critical
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       services/order-payment-confirmation.js, services/cash-confirmation-control-service.js, utils/logger.js
 * @used-by       routes/cash.js
 * @db-read       cash_collections, orders, users, market_operating_assignments, market_cash_control_policies, cash_confirmation_controls
 * @db-write      alerts, cash_collections, cash_confirmation_controls
 * @db-txn        caller_owned, locked_order, shared_cash_control
 * @doctrine      payment_to_stock_single_entry, partner_cash_policy_enforced, no_free_amount_entry
 * @impact-areas  payment, cash, relay
 * @version       2026-09
 */

'use strict';

const { confirmPaymentCycle } = require('./order-payment-confirmation');
const { ensureSecretGenerated } = require('./pickup-secret-service');
const {
  prepareCashConfirmation,
  finalizeCashConfirmation,
} = require('./cash-confirmation-control-service');
const { createAlert } = require('../utils/alerts');
const db = require('../db');
const log = require('../utils/logger').child({ module: 'cash-operations' });

async function collectCash({ orderId, agentUser, dbClient }) {
  const client = dbClient;
  const agentId = agentUser.id;

  const { rows: [order] } = await client.query(`
    SELECT id, total_kmf, payment_mode, payment_status, status, relais_id, market_id
    FROM orders WHERE id = $1 FOR UPDATE
  `, [orderId]);

  if (!order) return { order_not_found: true };
  if (order.payment_mode !== 'cash_relais') return { invalid_payment_mode: true };
  if (order.payment_status !== 'pending') {
    return { invalid_payment_status: true, payment_status: order.payment_status };
  }

  const INVALID_COLLECT_STATUSES = ['cancelled', 'refunded', 'collected'];
  if (INVALID_COLLECT_STATUSES.includes(order.status)) {
    return { invalid_status: true, status: order.status };
  }

  if (agentUser.role === 'agent_relais') {
    let agentRelaisId = null;
    let checkPossible = true;
    try {
      const { rows: [agent] } = await client.query(
        'SELECT relais_id FROM users WHERE id = $1', [agentId]
      );
      agentRelaisId = agent?.relais_id || null;
    } catch (e) {
      checkPossible = false;
      log.warn(`[CASH-COLLECT] users.relais_id query failed: ${e.message}`);
    }

    if (!checkPossible || !agentRelaisId) {
      await _insertSecurityAlert(
        'cash_collect_agent_config_error',
        orderId,
        `agent_relais sans relais_id tente cash_collect — user=${agentId}`,
        `order_id=${orderId} user_id=${agentId}`
      );
      return { agent_config_error: true };
    }

    if (String(agentRelaisId) !== String(order.relais_id)) {
      log.warn(`[CASH-COLLECT] ⛔ Cross-relais refusé — agent ${agentId} (relais ${agentRelaisId}) tentait commande ${orderId} (relais ${order.relais_id})`);
      await _insertSecurityAlert(
        'cash_collect_cross_relais_blocked',
        orderId,
        `Cross-relais refusé — order ${orderId}`,
        `user_id=${agentId} agent_relais_id=${agentRelaisId} order_relais_id=${order.relais_id}`
      );
      return { cross_relais_blocked: true };
    }
  }

  const control = await prepareCashConfirmation({
    dbClient: client,
    order,
    actor: { id: agentId, role: agentUser.role },
    source: 'cash_collect',
  });

  if (!control.allowed) {
    if (control.pending_second) {
      return {
        pending_second_approval: true,
        control_status: control.status || 202,
        control_code: control.code,
        control_message: control.message,
        required_approvals: control.control?.required_approvals || 2,
      };
    }
    return {
      cash_control_blocked: true,
      control_status: control.status || 409,
      control_code: control.code,
      control_message: control.message,
    };
  }

  const { rows: existing } = await client.query(
    'SELECT id FROM cash_collections WHERE order_id = $1', [orderId]
  );
  if (existing.length > 0) {
    return { already_collected: true, collection_id: existing[0].id };
  }

  // Le montant reste exclusivement dérivé de la commande : jamais de saisie libre.
  const amountKmf = Number(order.total_kmf);

  const { rows: [collection] } = await client.query(`
    INSERT INTO cash_collections (order_id, amount_kmf, collected_by, relais_id)
    VALUES ($1, $2, $3, $4) RETURNING *
  `, [orderId, amountKmf, agentId, order.relais_id]);

  const cycleResult = await confirmPaymentCycle({
    orderId,
    actor: { id: agentId, role: agentUser.role },
    source: 'cash_confirm',
    dbClient: client,
  });

  if (cycleResult.stockBlocked) {
    return { stock_blocked: true, insufficient_items: cycleResult.insufficientItems };
  }

  const secretResult = await ensureSecretGenerated({
    orderId,
    relaisId: order.relais_id || null,
    channel: 'cash_confirm',
    dbClient: client,
  });

  await finalizeCashConfirmation({ dbClient: client, orderId });

  return {
    success: true,
    collection,
    noop: cycleResult.noop,
    amount_kmf: amountKmf,
    pickupCodeToCache: secretResult.code || null,
    cash_control: {
      required_approvals: control.control?.required_approvals || 1,
      second_approval: Boolean(control.second_approval),
    },
  };
}

async function _insertSecurityAlert(type, entityId, title, description) {
  try {
    await createAlert(db, {
      type,
      entityType: 'order',
      entityId,
      severity: 'high',
      title,
      description,
    });
  } catch (e) {
    log.error({ err: e.message }, '[CASH-COLLECT] alert insert failed');
  }
}

module.exports = {
  collectCash,
};
