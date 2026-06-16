/**
 * @komerce-arch
 * @role          orders-admin-order-refund
 * @domain        orders
 * @layer         service
 * @criticality   critical
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       @unknown
 * @used-by       @unknown
 * @db-read       orders, refunds
 * @db-write      alerts, orders
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  orders, checkout, admin-dashboard
 * @version       2026-06
 */

'use strict';

/**
 * I-SWEEP-5B — Refund admin explicite.
 *
 * Doctrine :
 * - `cancelled` = annulation métier, stock/wallet/PO sync déjà traités.
 * - `refunded` = remboursement financier effectivement enregistré.
 * - Stripe : remboursement externe via refund-service avec idempotency key stable.
 * - Cash relais : pas de cash-out automatique ; soit traitement manuel, soit crédit wallet explicite.
 */

const db = require('../db');
const { processRefund } = require('./refund-service');
const { transitionOrderStatus } = require('./order-status-machine');

async function refundCancelledOrder({ orderId, user, dryRun = true, reason = null, cashMode = 'manual' }) {
  if (!user?.id || user.role !== 'admin') {
    return { status: 403, body: { error: 'Accès réservé admin' } };
  }
  if (!orderId) {
    return { status: 400, body: { error: 'orderId requis' } };
  }

  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    const { rows: [order] } = await client.query(
      `SELECT * FROM orders WHERE id = $1 FOR UPDATE`,
      [orderId]
    );

    if (!order) {
      await client.query('ROLLBACK');
      return { status: 404, body: { error: 'Commande introuvable' } };
    }

    if (order.status !== 'cancelled') {
      await client.query('ROLLBACK');
      return {
        status: 409,
        body: {
          error: 'La commande doit être cancelled avant remboursement financier',
          current_status: order.status,
        },
      };
    }

    if (order.payment_status === 'refunded') {
      await client.query('ROLLBACK');
      return { status: 409, body: { error: 'Commande déjà marquée refunded' } };
    }

    const { rows: existingRefunds } = await client.query(
      `SELECT id, refund_method, stripe_refund_id, status, completed_at
         FROM refunds
        WHERE order_id = $1
          AND refund_type = 'full'
          AND status = 'completed'
        ORDER BY completed_at DESC NULLS LAST, id DESC
        LIMIT 1`,
      [order.id]
    );

    if (existingRefunds.length) {
      await client.query('ROLLBACK');
      return {
        status: 409,
        body: {
          error: 'Un remboursement full completed existe déjà pour cette commande',
          refund: existingRefunds[0],
        },
      };
    }

    const amountKmf = Number(order.total_kmf || 0);
    const amountEur = Number(order.total_eur || 0);
    const plannedMethod = order.payment_mode === 'stripe_eur' && order.stripe_payment_id
      ? 'stripe'
      : (cashMode === 'wallet_credit' ? 'wallet_credit' : 'manual_cash');

    if (dryRun) {
      await client.query('ROLLBACK');
      return {
        status: 200,
        body: {
          dry_run: true,
          order_id: order.id,
          reference: order.reference,
          current_status: order.status,
          payment_mode: order.payment_mode,
          payment_status: order.payment_status,
          amount_kmf: amountKmf,
          amount_eur: amountEur,
          planned_method: plannedMethod,
          doctrine: plannedMethod === 'manual_cash'
            ? 'cash relais: remboursement manuel ou relancer avec cash_mode=wallet_credit'
            : 'refund financier exécutera ensuite cancelled → refunded',
        },
      };
    }

    if (plannedMethod === 'manual_cash') {
      await client.query(
        `INSERT INTO alerts (level, source, message, payload)
         VALUES ('elevated', 'refund_manual_cash', $1, $2)`,
        [
          `Remboursement cash manuel requis — ${order.reference}`,
          JSON.stringify({ order_id: order.id, reference: order.reference, amount_kmf: amountKmf, reason }),
        ]
      );
      await client.query('COMMIT');
      return {
        status: 202,
        body: {
          success: false,
          manual_required: true,
          message: 'Remboursement cash manuel requis ; alerte créée. La commande reste cancelled tant que le remboursement financier n’est pas confirmé.',
          order_id: order.id,
          reference: order.reference,
        },
      };
    }

    const refund = await processRefund(
      client,
      order,
      amountKmf,
      amountEur,
      'full',
      reason || 'Remboursement complet après annulation',
      user.id,
      null
    );

    const statusResult = await transitionOrderStatus({
      orderId: order.id,
      newStatus: 'refunded',
      actor: { id: user.id, role: user.role },
      source: 'patch',
      note: `Remboursement financier complet — méthode ${refund.method}`,
      dbClient: client,
    });

    if (!statusResult.success && !statusResult.noop) {
      await client.query('ROLLBACK');
      return { status: 409, body: { error: statusResult.error } };
    }

    await client.query(
      `UPDATE orders SET payment_status = 'refunded', updated_at = NOW() WHERE id = $1`,
      [order.id]
    );

    await client.query('COMMIT');

    return {
      status: 200,
      body: {
        success: true,
        order_id: order.id,
        reference: order.reference,
        refund,
        status: 'refunded',
        payment_status: 'refunded',
      },
    };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { refundCancelledOrder };
