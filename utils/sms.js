/**
 * KOMERCE — Utilitaire SMS via Africa's Talking (sécurisé)
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

const AfricasTalking = require('africastalking');
const db = require('../db');
const { getRuleNumber } = require('./rules');

// Initialisation conditionnelle — Africa's Talking uniquement si les clés sont renseignées.
let smsClient = null;

const atKey  = process.env.AT_API_KEY;
const atUser = process.env.AT_USERNAME;

if (atKey && atUser && atKey !== '...' && atUser !== 'komerce') {
  try {
    const at = AfricasTalking({ apiKey: atKey, username: atUser });
    smsClient = at.SMS;
    console.log('📱 Africa\'s Talking initialisé — SMS actifs');
  } catch (err) {
    console.warn('⚠️  Africa\'s Talking : erreur initialisation —', err.message);
  }
} else {
  console.warn('⚠️  SMS désactivés — clés Africa\'s Talking non configurées (mode dev)');
}

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
  // ← P1 FIX : valider le numéro avant tout
  if (!isValidPhone(to)) {
    console.warn(`SMS ignoré — numéro invalide : ${to}`);
    return { success: false, error: 'invalid_phone' };
  }

  // Insérer en base avec statut pending
  const { rows: [log] } = await db.query(
    `INSERT INTO sms_log (order_id, recipient, type, message, status)
     VALUES ($1,$2,$3,$4,'pending') RETURNING id`,
    [order_id, to, type, message]
  );

  // Mode dev : simuler sans envoyer
  if (!smsClient) {
    console.log(`[SMS DEV] to=${to} | type=${type} | "${message}"`);
    await db.query(
      `UPDATE sms_log SET status = 'dev_skipped', sent_at = NOW() WHERE id = $1`,
      [log.id]
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
      [status, atId, log.id]
    );

    return { success: status === 'sent', at_message_id: atId };

  } catch (err) {
    console.error(`SMS échoué vers ${to} :`, err.message);
    await db.query(
      `UPDATE sms_log SET status = 'failed' WHERE id = $1`,
      [log.id]
    );
    return { success: false, error: err.message };
  }
}

/**
 * Rappels automatiques Cash relais
 * Appelés par un cron job toutes les heures (setInterval dans server.js)
 *
 * H+12 : rappel paiement
 * H+36 : annulation automatique + restauration stock (TRANSACTIONNEL)
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

  // ── H+36 : annulation automatique (TRANSACTIONNEL) ──────────────────────

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
    // ← P1 FIX : Transaction pour atomicité annulation + restauration stock
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      // Annuler la commande — requête paramétrée pour cancel_reason
      await client.query(
        `UPDATE orders SET
           status        = 'cancelled',
           cancelled_at  = NOW(),
           cancel_reason = $2,
           reminder_h36_sent = TRUE
         WHERE id = $1`,
        [order.id, `Non-paiement cash relais apres ${cashTimeoutHours}h`]
      );

      // Historique — requête paramétrée pour note
      await client.query(
        `INSERT INTO order_status_history (order_id, status, note)
         VALUES ($1, 'cancelled', $2)`,
        [order.id, `Annulation automatique H+${cashTimeoutHours} - non paiement`]
      );

      // Restaurer le stock
      const { rows: items } = await client.query(
        'SELECT product_id, quantity FROM order_items WHERE order_id = $1',
        [order.id]
      );
      for (const item of items) {
        await client.query(
          'UPDATE products SET stock = stock + $1 WHERE id = $2',
          [item.quantity, item.product_id]
        );
      }

      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      console.error(`H+36 annulation échouée pour order ${order.id}:`, txErr.message);
      continue; // Passer à la commande suivante, ne pas crasher le cron
    } finally {
      client.release();
    }

    // SMS hors transaction (non critique — on ne rollback pas pour un SMS raté)
    if (order.user_phone) {
      await sendSMS(
        order.user_phone,
        `Komerce : Votre commande ${order.reference} a ete annulee faute de paiement. Vous pouvez repasser commande a tout moment.`,
        'reminder_h36', order.id
      );
    }
  }

  console.log(`Rappels cash relais : ${h12.length} H+12, ${h36.length} H+36 annulations`);
}


// ── Phase 4 — Templates SMS Expédition Partielle ──────────────────────────

const PARTIAL_SHIP_SMS = {
  /**
   * Envoyé quand une expédition partielle est créée.
   * @param {string} ref - Référence commande parent
   * @param {number} shipped_count - Nb d'articles expédiés
   * @param {number} backorder_count - Nb d'articles en backorder
   */
  partial_created: (ref, shipped_count, backorder_count) =>
    `Komerce : Commande ${ref} — expedition partielle : ${shipped_count} article(s) expedie(s), ${backorder_count} en attente. Vous serez notifie pour chaque expedition.`,

  /**
   * Mise à jour sur un backorder (date estimée connue).
   * @param {string} ref - Référence sous-commande backorder
   * @param {string} estimated_date - Date estimée format lisible (ex: "15/05/2026")
   */
  backorder_update: (ref, estimated_date) =>
    `Komerce : Backorder ${ref} — date d'expedition estimee : ${estimated_date}. Nous faisons le maximum pour accelerer.`,

  /**
   * Backorder annulé avec crédit/remboursement.
   * @param {string} ref - Référence sous-commande backorder
   * @param {string} credit_amount - Montant crédité/remboursé (ex: "15 000 KMF" ou "30.50 EUR")
   */
  backorder_cancelled: (ref, credit_amount) =>
    `Komerce : Backorder ${ref} annule. ${credit_amount} credite sur votre compte. Merci de votre comprehension.`,

  /**
   * Sous-commande expédiée.
   * @param {string} ref - Référence sous-commande
   * @param {string} tracking - Référence de suivi (optionnel)
   */
  sub_order_shipped: (ref, tracking) =>
    `Komerce : Sous-commande ${ref} expediee.${tracking ? ` Suivi : ${tracking}` : ''} Arrivee estimee 3-5 semaines.`,

  /**
   * Sous-commande disponible au relais.
   * @param {string} ref - Référence sous-commande
   * @param {string} relais - Nom du point relais
   */
  sub_order_available: (ref, relais) =>
    `Komerce : Sous-commande ${ref} disponible au relais ${relais || ''}. Venez la recuperer !`,
};

// ── Phase 4 — Rappels automatiques backorder ──────────────────────────────
//
// Appelé par un cron job toutes les 6 heures.
// Détecte les backorders expirés et propose l'annulation au client par SMS.

async function processBackorderReminders() {
  try {
    const backorderMaxDays = await getRuleNumber('BACKORDER_MAX_DAYS', 45);

    // Trouver les backorders expirés non encore notifiés
    const { rows: expiredBackorders } = await db.query(
      `SELECT
         so.id AS sub_order_id,
         so.tracking_ref,
         so.estimated_date,
         so.parent_order_id,
         o.reference AS order_reference,
         o.user_id,
         u.phone AS user_phone
       FROM sub_orders so
       JOIN orders o ON o.id = so.parent_order_id
       LEFT JOIN users u ON u.id = o.user_id
       WHERE so.type = 'backorder'
         AND so.status = 'preparation'
         AND so.backorder_reminder_sent = FALSE
         AND (
           so.estimated_date < NOW()
           OR so.created_at < NOW() - INTERVAL '1 day' * $1
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

      // Marquer comme notifié pour ne pas renvoyer le SMS
      await db.query(
        `UPDATE sub_orders SET backorder_reminder_sent = TRUE, updated_at = NOW()
         WHERE id = $1`,
        [bo.sub_order_id]
      );
    }

    console.log(`[BACKORDER] Rappels backorder : ${sentCount} SMS envoyés sur ${expiredBackorders.length} backorders expirés`);
    return { processed: expiredBackorders.length, sms_sent: sentCount };

  } catch (err) {
    console.error('[BACKORDER] Erreur rappels backorder:', err.message);
    return { processed: 0, sms_sent: 0, error: err.message };
  }
}

module.exports = { sendSMS, processCashRelaisReminders, processBackorderReminders, PARTIAL_SHIP_SMS };
