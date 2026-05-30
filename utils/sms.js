/**
 * utils/sms.js — ARCHIVÉ (dead code depuis 2026-05-30)
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * Ce fichier N'EST PLUS APPELÉ PAR AUCUN CODE ACTIF.
 * Migration ZG-1 : Africa's Talking SMS → WhatsApp AuthKey (notification-service)
 *   processCashRelaisReminders / processBackorderReminders
 *   → services/cash-reminder-service.js (notifyText / WhatsApp)
 * Conservé pour les tests unitaires (mock sendSMS) et l'historique CRIT-01/02.
 * À supprimer lors du prochain nettoyage de dette.
 * ══════════════════════════════════════════════════════════════════════════════
 * @deprecated 2026-05-30
 */

/**
 * KOMERCE — Utilitaire SMS via Africa's Talking (sécurisé)
 *
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  SPRINT 0 — FIX CRIT-01: H+36 cancellation now uses the           ║
 * ║  order-status-machine instead of direct SQL UPDATE.                 ║
 * ║  FIX CRIT-02: ALTER TABLE removed — use migration instead.         ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * Corrections v8.2 (Sprint 0):
 *   - CRIT-01: processCashRelaisReminders() H+36 now calls
 *     transitionOrderStatus() — wallet reversal + stock restore are handled
 *     automatically by the status machine. Manual stock restore REMOVED.
 *   - CRIT-02: ALTER TABLE IF NOT EXISTS removed from processBackorderReminders().
 *     Column backorder_reminder_sent must exist via migration 015.
 *
 * Corrections v8.1 :
 *   - Validation numéro de téléphone (format E.164)
 *   - Transaction DB pour annulation H+36 (pas de stock perdu si crash)
 *
 * Types de SMS :
 *   confirmation    -> commande créée (commanditaire)
 *   shipped         -> expédition partie (commanditaire)
 *   available       -> disponible au relais (destinataire)
 *   collected       -> colis récupéré (commanditaire)
 *   reminder_h12    -> rappel paiement cash H+12 (commanditaire)
 *   reminder_h36    -> annulation imminente H+36 (commanditaire)
 *   gift            -> code retrait cadeau (destinataire)
 *   anomaly_alert   -> anomalie logistique (admin)
 */

const db = require('../db');
const log = require('./logger').child({ module: 'sms' });
const { getRuleNumber } = require('./rules');
const { transitionOrderStatus } = require('../services/order-status-machine');

// Legacy SMS provider disabled.
// Komerce uses WhatsApp/AuthKey through services/notification-service.js.
// sendSMS() is kept as a compatibility shim for old cron flows.
let smsClient = null;

log.warn('Legacy SMS disabled — target channel: WhatsApp/AuthKey');

// ── Validation numéro de téléphone ───────────────────────────────────────────

/**
 * Vérifie qu'un numéro est au format E.164 international (+XXXXXXXXXXX)
 * @param {string} phone
 * @returns {boolean}
 */
function isValidPhone(phone) {
  return typeof phone === 'string' && /^\+[1-9]\d{6,14}$/.test(phone);
}

/**
 * Envoie un SMS et le logue en base.
 *
 * @param {string} to        - Numéro destinataire au format international (+269...)
 * @param {string} message   - Texte du SMS (max 160 caractères recommandé)
 * @param {string} type      - Type de SMS (voir liste ci-dessus)
 * @param {string} order_id  - UUID commande associée (peut être null)
 */
async function sendSMS(to, message, type, order_id = null) {
  // Valider le numéro avant tout
  if (!isValidPhone(to)) {
    log.warn({ phone: to, type, order_id }, 'SMS skipped: invalid phone number');
    return { success: false, error: 'invalid_phone' };
  }

  // Insérer en base avec statut pending
  const { rows: [logRow] } = await db.query(
    `INSERT INTO sms_log (order_id, recipient, type, message, status)
     VALUES ($1,$2,$3,$4,'pending') RETURNING id`,
    [order_id, to, type, message]
  );

  // Mode dev : simuler sans envoyer
  if (!smsClient) {
    log.info({ to, type, order_id, sms_log_id: logRow.id }, 'SMS dev skipped');
    await db.query(
      `UPDATE sms_log SET status = 'dev_skipped', sent_at = NOW() WHERE id = $1`,
      [logRow.id]
    );
    return { success: true, dev: true };
  }

  try {
    const result = await smsClient.send({
      to:      [to],
      message,
      from:    process.env.AT_SENDER_ID || 'Komerce',
    });

    const atId   = result?.SMSMessageData?.Recipients?.[0]?.messageId || null;
    const status = result?.SMSMessageData?.Recipients?.[0]?.status === 'Success'
      ? 'sent' : 'failed';

    await db.query(
      `UPDATE sms_log SET status = $1, at_message_id = $2, sent_at = NOW()
       WHERE id = $3`,
      [status, atId, logRow.id]
    );

    return { success: status === 'sent', at_message_id: atId };

  } catch (err) {
    log.error({ err, to, type, order_id, sms_log_id: logRow.id }, 'SMS send failed');
    await db.query(
      `UPDATE sms_log SET status = 'failed' WHERE id = $1`,
      [logRow.id]
    );
    return { success: false, error: err.message };
  }
}

/**
 * Rappels automatiques Cash relais
 * Appelés par un cron job toutes les heures (setInterval dans server.js)
 *
 * H+12 : rappel paiement
 * H+36 : annulation automatique via STATUS MACHINE (CRIT-01 FIX)
 *
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  CRIT-01 FIX: H+36 now uses transitionOrderStatus() instead of    ║
 * ║  direct SQL UPDATE. The status machine handles:                     ║
 * ║    - Wallet reversal (idempotent via idempotency_key)              ║
 * ║    - Stock restore (via order_items)                                ║
 * ║    - order_status_history entry                                     ║
 * ║    - Timestamp (cancelled_at)                                       ║
 * ║    - cancel_reason                                                  ║
 * ║                                                                     ║
 * ║  Before: Direct UPDATE + manual stock restore (NO wallet reversal)  ║
 * ║  After:  transitionOrderStatus() handles everything correctly.      ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */
async function processCashRelaisReminders() {
  // Seuils dynamiques depuis business_rules
  const cashTimeoutHours = await getRuleNumber('CASH_PAYMENT_TIMEOUT_HOURS', 36);
  const reminderH12Hours = Math.round(cashTimeoutHours / 3);  // 12h for 36h timeout

  // H+12 : commandes cash non payées créées il y a reminderH12Hours, rappel pas encore envoyé
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
      await sendSMS(
        order.user_phone,
        `Komerce : Rappel : votre commande ${order.reference} attend le paiement au relais. Code : ${order.cash_ref_code}. Delai restant : ${cashTimeoutHours - reminderH12Hours}h.`,
        'reminder_h12', order.id
      );
    }
    await db.query(
      `UPDATE orders SET reminder_h12_sent = TRUE WHERE id = $1`,
      [order.id]
    );
  }

  // ── H+36 : annulation automatique via STATUS MACHINE ──────────────────────
  // CRIT-01 FIX: Using transitionOrderStatus() instead of direct SQL UPDATE.
  // The status machine handles wallet reversal, stock restore, history, and timestamps.

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
    // ── Use status machine for cancellation ──────────────────────────────
    // This replaces the old direct UPDATE + manual stock restore.
    // transitionOrderStatus handles: wallet reversal, stock restore,
    // order_status_history, cancelled_at timestamp, cancel_reason.
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      const result = await transitionOrderStatus({
        orderId:      order.id,
        newStatus:    'cancelled',
        actor:        { id: null, role: 'system' },
        source:       'system',
        note:         `Annulation automatique H+${cashTimeoutHours} — non-paiement cash relais`,
        cancelReason: `Non-paiement cash relais apres ${cashTimeoutHours}h`,
        dbClient:     client,
      });

      if (!result.success) {
        log.error({ order_id: order.id, error: result.error }, 'H+36 status machine failed');
        await client.query('ROLLBACK');
        continue;
      }

      // Mark reminder as sent (separate from status transition)
      await client.query(
        `UPDATE orders SET reminder_h36_sent = TRUE WHERE id = $1`,
        [order.id]
      );

      await client.query('COMMIT');

      if (result.cancelEffects) {
        log.info({
          order_id: order.id,
          wallet_reversal_amount_kmf: result.cancelEffects.walletReversalAmount,
          stock_items_restored: result.cancelEffects.stockItemsRestored,
        }, 'H+36 order cancelled via status machine');
      }
    } catch (txErr) {
      await client.query('ROLLBACK');
      log.error({ err: txErr, order_id: order.id }, 'H+36 cancellation transaction failed');
      continue;
    } finally {
      client.release();
    }

    // Send SMS after successful cancellation
    if (order.user_phone) {
      await sendSMS(
        order.user_phone,
        `Komerce : Votre commande ${order.reference} a ete annulee faute de paiement. Vous pouvez repasser commande a tout moment.`,
        'reminder_h36', order.id
      );
    }
  }

  log.info({ h12_count: h12.length, h36_count: h36.length }, 'Cash relais reminders processed');
}


// ── Phase 4 — Templates SMS Expédition Partielle ──────────────────────────
// REMOVED: PARTIAL_SHIP_SMS templates referenced sub_orders table that doesn't exist.
// Will be rebuilt when partial shipments (parcel-first) are implemented.

// ── Rappels automatiques backorder (modèle parcel-first) ─────────────────────
//
// Appelé par un cron job toutes les 6 heures.
// Détecte les colis backorder expirés et propose l'annulation au client par SMS.
//
// ╔══════════════════════════════════════════════════════════════════════╗
// ║  CRIT-02 FIX: ALTER TABLE removed. The column                      ║
// ║  parcels.backorder_reminder_sent MUST exist via migration 015.      ║
// ║  See: migrations/015_add_backorder_reminder_sent.sql                ║
// ╚══════════════════════════════════════════════════════════════════════╝

async function processBackorderReminders() {
  try {
    const backorderMaxDays = await getRuleNumber('BACKORDER_MAX_DAYS', 45);

    // CRIT-02 FIX: Removed ALTER TABLE from runtime.
    // The column parcels.backorder_reminder_sent must be created by migration 015.
    // If the column doesn't exist, the query below will fail loudly (which is correct
    // — it means the migration hasn't been run).

    // Trouver les colis backorder expirés non encore notifiés
    const { rows: expiredBackorders } = await db.query(
      `SELECT
         p.id                            AS sub_order_id,
         COALESCE(p.label, p.id::text)   AS tracking_ref,
         p.eta                            AS estimated_date,
         p.order_id                       AS parent_order_id,
         o.reference                      AS order_reference,
         o.user_id,
         u.phone                          AS user_phone
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
        const smsText = `Komerce : Votre backorder ${bo.tracking_ref} (commande ${bo.order_reference}) depasse le delai prevu. Vous pouvez l'annuler pour obtenir un credit boutique. Contactez-nous ou annulez depuis l'app.`;

        await sendSMS(bo.user_phone, smsText, 'backorder_reminder', bo.parent_order_id);
        sentCount++;
      }

      // Marquer comme notifié pour éviter les doublons
      await db.query(
        `UPDATE parcels SET backorder_reminder_sent = TRUE, updated_at = NOW()
         WHERE id = $1`,
        [bo.sub_order_id]
      );
    }

    log.info({ sent_count: sentCount, expired_backorders_count: expiredBackorders.length }, 'Backorder reminders processed');
    return { processed: expiredBackorders.length, sms_sent: sentCount };

  } catch (err) {
    log.error({ err }, 'Backorder reminders failed');
    return { processed: 0, sms_sent: 0, error: err.message };
  }
}

module.exports = { sendSMS, processCashRelaisReminders, processBackorderReminders };

