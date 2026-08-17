/**
 * @komerce-arch
 * @role          payment-cash-reminder-service
 * @domain        payment
 * @layer         service
 * @criticality   critical
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db, services/notification-service.js, services/order-status-machine.js, services/parcel-mutation-service.js, utils/logger.js, utils/rules.js
 * @used-by       bootstrap/crons.js
 * @db-read       orders, parcels, users
 * @db-write      orders
 * @db-write-via:parcel-mutation-service parcels
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  payment
 * @version       2026-06
 */

'use strict';

/**
 * services/cash-reminder-service.js
 *
 * Rappels automatiques cash relais + backorder.
 * Extrait de utils/sms.js (2026-05-30) — canal de notif migré vers WhatsApp
 * (notifyText → AuthKey) à la place de l'ancien Africa's Talking SMS désactivé.
 *
 * Fonctions exportées :
 *   processCashRelaisReminders()   — H+12 rappel paiement · H+36 annulation
 *   processBackorderReminders()    — backorder expiré > BACKORDER_MAX_DAYS
 *
 * Invariants préservés (CRIT-01 / CRIT-02) :
 *   - H+36 passe par transitionOrderStatus() (wallet reversal + stock restore)
 *   - Pas d'ALTER TABLE au runtime (colonne backorder_reminder_sent via migration 015)
 */

const db  = require('../db');
const log = require('../utils/logger').child({ module: 'cash-reminder-service' });
const { getRuleNumber }         = require('../utils/rules');
const { transitionOrderStatus } = require('./order-status-machine');
const { notifyText }            = require('./notification-service');
const { markBackorderReminderSent } = require('./parcel-mutation-service');

// ──────────────────────────────────────────────────────────────────────────────
// H+12 — rappel paiement cash · H+36 — annulation automatique
// ──────────────────────────────────────────────────────────────────────────────

async function processCashRelaisReminders() {
  const cashTimeoutHours = await getRuleNumber('CASH_PAYMENT_TIMEOUT_HOURS', 36);
  const reminderH12Hours = Math.round(cashTimeoutHours / 3); // ex : 12h pour 36h

  // ── H+12 : rappel paiement ─────────────────────────────────────────────────
  const { rows: h12 } = await db.query(
    `SELECT o.*, u.phone AS user_phone
     FROM orders o
     LEFT JOIN users u ON u.id = o.user_id
     WHERE o.payment_mode   = 'cash_relais'
       AND o.payment_status = 'pending'
       AND o.status         = 'pending'
       AND o.reminder_h12_sent = FALSE
       AND o.created_at <= NOW() - INTERVAL '1 hour' * $1`,
    [reminderH12Hours]
  );

  for (const order of h12) {
    if (order.user_phone) {
      await notifyText(
        order.user_phone,
        `Komerce : Rappel : votre commande ${order.reference} attend le paiement au relais. Code : ${order.cash_ref_code}. Délai restant : ${cashTimeoutHours - reminderH12Hours}h.`,
        'reminder_h12',
        order.id
      );
    }
    await db.query(
      `UPDATE orders SET reminder_h12_sent = TRUE WHERE id = $1`,
      [order.id]
    );
  }

  // ── H+36 : annulation via machine à états (CRIT-01) ───────────────────────
  const { rows: h36 } = await db.query(
    `SELECT o.*, u.phone AS user_phone
     FROM orders o
     LEFT JOIN users u ON u.id = o.user_id
     WHERE o.payment_mode   = 'cash_relais'
       AND o.payment_status = 'pending'
       AND o.status         = 'pending'
       AND o.reminder_h36_sent = FALSE
       AND o.created_at <= NOW() - INTERVAL '1 hour' * $1`,
    [cashTimeoutHours]
  );

  for (const order of h36) {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      const result = await transitionOrderStatus({
        orderId:      order.id,
        newStatus:    'cancelled',
        actor:        { id: null, role: 'system' },
        source:       'system',
        note:         `Annulation automatique H+${cashTimeoutHours} — non-paiement cash relais`,
        cancelReason: `Non-paiement cash relais après ${cashTimeoutHours}h`,
        dbClient:     client,
      });

      if (!result.success) {
        log.error({ order_id: order.id, error: result.error }, 'H+36 status machine failed');
        await client.query('ROLLBACK');
        continue;
      }

      await client.query(
        `UPDATE orders SET reminder_h36_sent = TRUE WHERE id = $1`,
        [order.id]
      );

      await client.query('COMMIT');

      if (result.cancelEffects) {
        log.info({
          order_id: order.id,
          wallet_reversal_amount_kmf: result.cancelEffects.walletReversalAmount,
          stock_items_restored:       result.cancelEffects.stockItemsRestored,
        }, 'H+36 order cancelled via status machine');
      }
    } catch (txErr) {
      await client.query('ROLLBACK');
      log.error({ err: txErr, order_id: order.id }, 'H+36 cancellation transaction failed');
      continue;
    } finally {
      client.release();
    }

    // Notification annulation après commit (non bloquant pour la transaction)
    if (order.user_phone) {
      await notifyText(
        order.user_phone,
        `Komerce : Votre commande ${order.reference} a été annulée faute de paiement. Vous pouvez repasser commande à tout moment.`,
        'reminder_h36',
        order.id
      );
    }
  }

  log.info({ h12_count: h12.length, h36_count: h36.length }, 'Cash relais reminders processed');
}

// ──────────────────────────────────────────────────────────────────────────────
// Backorder expiré — rappel d'annulation (CRIT-02)
// Colonne parcels.backorder_reminder_sent créée par migration 015.
// ──────────────────────────────────────────────────────────────────────────────

async function processBackorderReminders() {
  try {
    const backorderMaxDays = await getRuleNumber('BACKORDER_MAX_DAYS', 45);

    const { rows: expiredBackorders } = await db.query(
      `SELECT
         p.id                            AS sub_order_id,
         COALESCE(p.label, p.id::text)   AS tracking_ref,
         p.eta                           AS estimated_date,
         p.order_id                      AS parent_order_id,
         o.reference                     AS order_reference,
         o.user_id,
         u.phone                         AS user_phone
       FROM parcels p
       JOIN orders o ON o.id = p.order_id
       LEFT JOIN users u ON u.id = o.user_id
       WHERE p.type = 'backorder'
         AND p.status NOT IN ('collected', 'cancelled')
         AND p.backorder_reminder_sent = FALSE
         AND (
           (p.eta IS NOT NULL AND p.eta < NOW())
           OR p.created_at < NOW() - INTERVAL '1 day' * $1
         )`,
      [backorderMaxDays]
    );

    let sentCount = 0;

    for (const bo of expiredBackorders) {
      if (bo.user_phone) {
        await notifyText(
          bo.user_phone,
          `Komerce : Votre backorder ${bo.tracking_ref} (commande ${bo.order_reference}) dépasse le délai prévu. Vous pouvez l'annuler pour obtenir un crédit boutique. Contactez-nous ou annulez depuis l'app.`,
          'backorder_reminder',
          bo.parent_order_id
        );
        sentCount++;
      }

      await markBackorderReminderSent(db, bo.sub_order_id);
    }

    log.info({ sent_count: sentCount, expired_backorders_count: expiredBackorders.length }, 'Backorder reminders processed');
    return { processed: expiredBackorders.length, sms_sent: sentCount }; // sms_sent conservé pour compat log cron

  } catch (err) {
    log.error({ err }, 'Backorder reminders failed');
    return { processed: 0, sms_sent: 0, error: err.message };
  }
}

module.exports = { processCashRelaisReminders, processBackorderReminders };
