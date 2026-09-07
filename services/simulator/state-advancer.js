/**
 * @komerce-arch
 * @role          state-advancer
 * @domain        operations
 * @layer         service
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db, services/order-status-machine.js, services/payment-service.js, services/parcel-operations.js, services/wallet-service.js, utils/logger.js
 * @used-by       services/simulator/engine.js
 * @db-read       order_items, orders, parcels
 * @db-write      notification_log, parcel_items, parcels, scans
 * @db-write-via:order-status-machine orders
 * @db-write-via:payment-service orders
 * @db-write-via:parcel-operations parcels
 * @db-write-via:wallet-service wallet_credit_lots, wallet_transactions, wallets
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  operations, payments, wallet, logistics
 * @version       2026-09
 */

/**
 * Simulator State Advancer v2 — exécute les transitions via les vraies fonctions backend.
 * Les écritures sensibles restent chez leurs owners canoniques, y compris quand
 * le simulateur fabrique volontairement un état incohérent pour le chaos-test.
 *
 * Actions: refund, chaos impacts (duplicate_scan, desync_payment, add_wait)
 */
'use strict';

const db = require('../../db');
const { transitionOrderStatus } = require('../order-status-machine');
const {
  markPaid,
  markRefunded,
  forcePaymentStatusForSimulation,
} = require('../payment-service');
const { transitionParcelStatus } = require('../parcel-operations');
const walletService = require('../wallet-service');
const log = require('../../utils/logger').child({ module: 'state-advancer' });

const SIM_ACTOR = { id: null, role: 'simulator' };

async function execute(orderId, tracked, action) {
  if (action.action === 'wait') {
    return { success: true, from: tracked.currentStatus, to: tracked.currentStatus, action: 'wait' };
  }
  if (action.action === 'log_only') {
    return { success: true, from: tracked.currentStatus, to: tracked.currentStatus, action: 'log_only' };
  }

  switch (action.action) {
    case 'confirm_payment':
      return await confirmPayment(orderId, tracked);
    case 'create_parcel':
      return await createParcel(orderId, tracked);
    case 'ship':
      return await scanAdvance(orderId, tracked, 'shipped');
    case 'transit':
      return await scanAdvance(orderId, tracked, 'in_transit');
    case 'arrive':
      return await scanAdvance(orderId, tracked, 'available');
    case 'collect':
      return await scanAdvance(orderId, tracked, 'collected');
    case 'cancel':
      return await cancelOrder(orderId, tracked);
    case 'refund':
      return await refundOrder(orderId, tracked);
    default:
      return { success: false, error: 'Action inconnue: ' + action.action };
  }
}

// ── Execute Chaos Impact ──────────────────────────────────
// Returns { applied: bool, message: string }

async function executeChaosImpact(orderId, tracked, chaos) {
  const impact = chaos.impact || 'skip';

  switch (impact) {
    case 'skip':
      return { applied: true, message: chaos.description };

    case 'duplicate_scan': {
      const { rows: parcels } = await db.query(
        "SELECT id, status FROM parcels WHERE order_id = $1 AND status != 'cancelled' ORDER BY created_at DESC LIMIT 1",
        [orderId]
      );
      if (parcels.length) {
        const p = parcels[0];
        await db.query(
          "INSERT INTO scans (parcel_id, step, notes, created_at) VALUES ($1, $2, $3, NOW())",
          [p.id, p.status, '🎲 CHAOS: Duplicate scan — ' + p.status]
        ).catch(() => {});
        return { applied: true, message: chaos.description + ' (colis ' + p.id + ')' };
      }
      return { applied: true, message: chaos.description + ' (pas de colis)' };
    }

    case 'add_wait': {
      if (!tracked._chaosWait) tracked._chaosWait = 0;
      tracked._chaosWait++;
      const target = chaos.waitTicks || 1;
      if (tracked._chaosWait >= target) {
        tracked._chaosWait = 0;
        return { applied: true, message: chaos.description + ' — résolu après ' + target + ' ticks' };
      }
      return { applied: true, message: chaos.description + ' (' + tracked._chaosWait + '/' + target + ')' };
    }

    case 'desync_payment': {
      // Le chaos reste intentionnel, mais l'écriture physique appartient au
      // payment-service. Sa primitive dédiée refuse de fonctionner en prod.
      const { rows } = await db.query('SELECT payment_status FROM orders WHERE id = $1', [orderId]);
      if (rows.length) {
        const current = rows[0].payment_status;
        const flipped = current === 'paid' ? 'pending' : 'paid';
        await forcePaymentStatusForSimulation(orderId, flipped);
        return { applied: true, message: chaos.description + ' (' + current + ' → ' + flipped + ')' };
      }
      return { applied: true, message: chaos.description };
    }

    case 'log_incident': {
      await db.query(
        "INSERT INTO notification_log (order_id, channel, recipient, message, status, created_at) VALUES ($1, 'system', 'admin', $2, 'chaos_event', NOW())",
        [orderId, '🎲 CHAOS: ' + chaos.description]
      ).catch(() => {});
      return { applied: true, message: chaos.description };
    }

    default:
      return { applied: true, message: chaos.description };
  }
}

// ── Confirm Payment (cash) ──────────────────────────────────

async function confirmPayment(orderId, tracked) {
  const { rows } = await db.query('SELECT status, payment_mode, payment_status FROM orders WHERE id = $1', [orderId]);
  if (!rows.length) return { success: false, error: 'Commande introuvable' };
  const order = rows[0];
  const from = order.status;

  if (['confirmed', 'ordered', 'preparation', 'shipped', 'in_transit', 'available', 'collected'].includes(order.status)) {
    return { success: true, from, to: order.status, action: 'already_past_pending' };
  }

  if (order.payment_status !== 'paid') {
    const payment = await markPaid(orderId);
    if (!payment.changed) {
      return { success: false, from, to: from, error: 'confirm_payment: transition payment_status → paid refusée' };
    }
  }

  const r1 = await transitionOrderStatus({ orderId, newStatus: 'confirmed', actor: SIM_ACTOR, source: 'simulator' });
  if (!r1.success) return { success: false, from, to: from, error: 'pending→confirmed: ' + (r1.error || 'transition refusée') };

  const r2 = await transitionOrderStatus({ orderId, newStatus: 'ordered', actor: SIM_ACTOR, source: 'simulator' });
  if (!r2.success) {
    return { success: true, from, to: 'confirmed', action: 'confirm_only' };
  }

  return { success: true, from, to: 'ordered', action: 'confirm_payment' };
}

// ── Create Parcel ───────────────────────────────────────────

async function createParcel(orderId, tracked) {
  const { rows } = await db.query('SELECT id, status, reference FROM orders WHERE id = $1', [orderId]);
  if (!rows.length) return { success: false, error: 'Commande introuvable' };
  const order = rows[0];
  const from = order.status;

  const { rows: existingParcels } = await db.query(
    "SELECT id FROM parcels WHERE order_id = $1 AND status != 'cancelled'", [orderId]
  );

  if (existingParcels.length === 0) {
    const year = new Date().getFullYear();
    const { rows: [{ max_seq }] } = await db.query(
      `SELECT COALESCE(MAX(CAST(SUBSTRING(reference FROM 'PCL-\\d{4}-(\\d+)') AS INT)), 0) AS max_seq
       FROM parcels WHERE reference LIKE $1`, [`PCL-${year}-%`]
    );
    const seq = (max_seq || 0) + 1;
    const reference = `PCL-${year}-${String(seq).padStart(4, '0')}`;

    const { rows: items } = await db.query('SELECT id, quantity FROM order_items WHERE order_id = $1', [orderId]);

    const { rows: [parcel] } = await db.query(
      `INSERT INTO parcels (reference, order_id, type, notes, status, created_at)
       VALUES ($1, $2, 'standard', 'Créé par simulateur', 'preparation', NOW()) RETURNING id`,
      [reference, orderId]
    );

    for (const item of items) {
      await db.query(
        'INSERT INTO parcel_items (parcel_id, order_item_id, quantity) VALUES ($1, $2, $3)',
        [parcel.id, item.id, item.quantity]
      ).catch(function() {});
    }
  }

  if (['confirmed', 'ordered'].includes(order.status)) {
    const r = await transitionOrderStatus({ orderId, newStatus: 'preparation', actor: SIM_ACTOR, source: 'simulator' });
    if (!r.success) return { success: false, from, to: from, error: 'create_parcel: ' + (r.error || 'transition refusée') };
  }

  return { success: true, from, to: 'preparation', action: 'create_parcel' };
}

// ── Scan Advance (shipped, in_transit, available, collected) ─

async function scanAdvance(orderId, tracked, targetStep) {
  const { rows } = await db.query('SELECT status FROM orders WHERE id = $1', [orderId]);
  if (!rows.length) return { success: false, error: 'Commande introuvable' };
  const from = rows[0].status;

  const { rows: parcels } = await db.query(
    "SELECT id, reference FROM parcels WHERE order_id = $1 AND status != 'cancelled' ORDER BY created_at DESC LIMIT 1",
    [orderId]
  );
  if (!parcels.length) return { success: false, from, to: from, error: 'Pas de colis — impossible de scanner ' + targetStep };

  const parcel = parcels[0];

  try {
    await transitionParcelStatus(db, parcel.id, targetStep, { skipValidation: true });

    await db.query(
      "INSERT INTO scans (parcel_id, step, notes, created_at) VALUES ($1, $2, $3, NOW())",
      [parcel.id, targetStep, 'Simulateur — ' + targetStep]
    ).catch(function(e) { log.warn({ err: e }, '[SIM] scan insert:'); });

    const result = await transitionOrderStatus({
      orderId,
      newStatus: targetStep,
      actor: SIM_ACTOR,
      source: 'simulator',
    });

    if (!result.success) {
      return { success: false, from, to: from, error: targetStep + ': ' + (result.error || 'transition refusée') };
    }

    return { success: true, from, to: targetStep, action: 'scan_' + targetStep };
  } catch (e) {
    return { success: false, from, to: from, error: targetStep + ': ' + e.message };
  }
}

// ── Cancel Order ────────────────────────────────────────────

async function cancelOrder(orderId, tracked) {
  const { rows } = await db.query('SELECT status FROM orders WHERE id = $1', [orderId]);
  if (!rows.length) return { success: false, error: 'Commande introuvable' };
  const from = rows[0].status;

  const result = await transitionOrderStatus({
    orderId,
    newStatus: 'cancelled',
    actor: SIM_ACTOR,
    source: 'simulator',
  });

  if (!result.success) return { success: false, from, to: from, error: 'cancel: ' + (result.error || 'transition refusée') };
  return { success: true, from, to: 'cancelled', action: 'cancel' };
}

// ── Refund Order ────────────────────────────────────────────

async function refundOrder(orderId, tracked) {
  const { rows } = await db.query('SELECT status, payment_status, total_kmf, user_id FROM orders WHERE id = $1', [orderId]);
  if (!rows.length) return { success: false, error: 'Commande introuvable' };
  const order = rows[0];
  const from = order.status;

  const result = await transitionOrderStatus({
    orderId,
    newStatus: 'refunded',
    actor: SIM_ACTOR,
    source: 'simulator',
  });

  if (!result.success) {
    return { success: false, from, to: from, error: 'refund: ' + (result.error || 'transition refusée par la state machine') };
  }

  // Le statut financier est lui aussi muté par son owner canonique.
  if (order.payment_status === 'paid') {
    const payment = await markRefunded(orderId);
    if (!payment.changed) {
      return { success: false, from, to: 'refunded', error: 'refund: payment_status → refunded refusé' };
    }
  }

  // L'ancien store_credits est retiré du chemin simulateur : le wallet unifié
  // reçoit un crédit idempotent, comme les autres flux modernes de remboursement.
  if (order.user_id && order.total_kmf) {
    await walletService.credit(db, {
      userId: order.user_id,
      amountKmf: order.total_kmf,
      reason: 'simulator_refund',
      referenceId: orderId,
      idempotencyKey: `simulator_refund_${orderId}`,
      note: 'Remboursement simulateur',
    });
  }

  const { rows: parcelsToCancel } = await db.query(
    "SELECT id FROM parcels WHERE order_id = $1 AND status != 'cancelled'",
    [orderId]
  );
  for (const p of parcelsToCancel) {
    await transitionParcelStatus(db, p.id, 'cancelled', { skipValidation: true }).catch(() => {});
  }

  return { success: true, from, to: 'refunded', action: 'refund' };
}

module.exports = { execute, executeChaosImpact };
