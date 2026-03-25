/**
 * KOMERCE — Utilitaire SMS via Africa's Talking
 *
 * Tous les SMS passent par cette fonction centralisée.
 * Chaque envoi est loggé en base dans la table sms_log.
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

// Initialisation conditionnelle — Africa's Talking uniquement si les clés sont renseignées.
// En mode dev (clés vides ou placeholder), les SMS sont simulés dans la console
// et loggés en base avec le statut 'dev_skipped'.
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

/**
 * Envoie un SMS et le logue en base.
 *
 * @param {string} to        - Numéro destinataire au format international (+269...)
 * @param {string} message   - Texte du SMS (max 160 caractères recommandé)
 * @param {string} type      - Type de SMS (voir liste ci-dessus)
 * @param {string} order_id  - UUID commande associée (peut être null)
 */
async function sendSMS(to, message, type, order_id = null) {
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
 * H+36 : annulation automatique + restauration stock
 */
async function processChashRelaisReminders() {
  // H+12 : commandes cash non payées créées il y a 12h, rappel pas encore envoyé
  const { rows: h12 } = await db.query(
    `SELECT o.*, u.phone AS user_phone
     FROM orders o
     LEFT JOIN users u ON u.id = o.user_id
     WHERE o.payment_mode   = 'cash_relais'
       AND o.payment_status = 'pending'
       AND o.status         = 'confirmed'
       AND o.reminder_h12_sent = FALSE
       AND o.created_at <= NOW() - INTERVAL '12 hours'`
  );

  for (const order of h12) {
    if (order.user_phone) {
      await sendSMS(
        order.user_phone,
        `Komerce : Rappel : votre commande ${order.reference} attend le paiement au relais. Code : ${order.cash_ref_code}. Delai restant : 24h.`,
        'reminder_h12', order.id
      );
    }
    await db.query(
      `UPDATE orders SET reminder_h12_sent = TRUE WHERE id = $1`,
      [order.id]
    );
  }

  // H+36 : annulation automatique
  const { rows: h36 } = await db.query(
    `SELECT o.*, u.phone AS user_phone
     FROM orders o
     LEFT JOIN users u ON u.id = o.user_id
     WHERE o.payment_mode   = 'cash_relais'
       AND o.payment_status = 'pending'
       AND o.status         = 'confirmed'
       AND o.reminder_h36_sent = FALSE
       AND o.created_at <= NOW() - INTERVAL '36 hours'`
  );

  for (const order of h36) {
    // Annuler la commande
    await db.query(
      `UPDATE orders SET
         status       = 'cancelled',
         cancelled_at = NOW(),
         cancel_reason = 'Non-paiement cash relais apres 36h'
       WHERE id = $1`,
      [order.id]
    );
    await db.query(
      `INSERT INTO order_status_history (order_id, status, note)
       VALUES ($1,'cancelled','Annulation automatique H+36 - non paiement')`,
      [order.id]
    );

    // Restaurer le stock
    const { rows: items } = await db.query(
      'SELECT product_id, quantity FROM order_items WHERE order_id = $1',
      [order.id]
    );
    for (const item of items) {
      await db.query(
        'UPDATE products SET stock = stock + $1 WHERE id = $2',
        [item.quantity, item.product_id]
      );
    }

    if (order.user_phone) {
      await sendSMS(
        order.user_phone,
        `Komerce : Votre commande ${order.reference} a ete annulee faute de paiement. Vous pouvez repasser commande a tout moment.`,
        'reminder_h36', order.id
      );
    }

    await db.query(
      `UPDATE orders SET reminder_h36_sent = TRUE WHERE id = $1`,
      [order.id]
    );
  }

  console.log(`Rappels cash relais : ${h12.length} H+12, ${h36.length} H+36 annulations`);
}

module.exports = { sendSMS, processChashRelaisReminders };
