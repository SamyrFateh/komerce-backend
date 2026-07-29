/**
 * @komerce-arch
 * @role          notification-internals
 * @domain        notification
 * @layer         service
 * @criticality   high
 * @inputs        runtime_context
 * @outputs       helpers, log_entry, alert
 * @depends       db.js, services/authkey-client.js, utils/logger.js
 * @used-by       services/notifications/order.js, services/notifications/parcel.js, services/notifications/otp-auth.js, services/notifications/loyalty.js
 * @db-write      notification_log
 * @db-txn        notification_non_blocking
 * @doctrine      notification_non_bloquante, fallback_trace
 * @impact-areas  otp, checkout, shared-cart, orders, customer-support, whatsapp
 * @version       2026-06
 */

'use strict';

const db  = require('../../db');
const log = require('../../utils/logger').child({ module: 'notification-service' });
const {
  notifyOrderCreated:     waOrderCreated,
  notifyPaymentConfirmed: waPaymentConfirmed,
  notifyOrderShipped:     waOrderShipped,
  notifyOrderDelivered:   waOrderDelivered,
  notifyOrderCancelled:   waOrderCancelled,
  callAuthKey,
  callAuthKeyText,
  WID,
} = require('../authkey-client');

const WID_OTP        = process.env.WID_OTP        || null;
const WID_MAGIC_LINK = process.env.WID_MAGIC_LINK || null;

let _notificationOutcomeListener = null;

/**
 * Point d'assemblage sortant. Notifications publie un fait neutre ; le
 * composition root choisit les observateurs. Aucun transporteur de message ne
 * connaît decision-signals.
 */
function setNotificationOutcomeListener(listener) {
  if (listener !== null && typeof listener !== 'function') {
    throw new TypeError('notification outcome listener must be a function or null');
  }
  _notificationOutcomeListener = listener;
}

function _alertNotificationFailure({ event, orderRef, orderId, error }) {
  if (!_notificationOutcomeListener) {
    log.warn({ event, orderRef, orderId }, '[notification-service] notification failure has no observer');
    return;
  }

  // Fire-and-forget assumé : une alerte de pilotage ne doit jamais casser
  // l'envoi ou le parcours appelant.
  Promise.resolve()
    .then(() => _notificationOutcomeListener({
      type: 'NotificationOutcomeRecorded',
      status: 'failed',
      event,
      orderRef: orderRef || null,
      orderId: orderId || null,
      error: String(error),
    }))
    .catch(err => log.error({ err }, '[notification-service] notification outcome observer failed'));
}

// ─── Logger interne ────────────────────────────────────────────────────
async function logNotification({ orderRef, parcelRef, channel, event, recipient, status, detail }) {
  try {
    await db.query(
      `INSERT INTO notification_log
         (order_ref, parcel_ref, channel, event, recipient, status, detail, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [orderRef || null, parcelRef || null, channel, event, recipient || 'system',
       status, detail ? (typeof detail === 'string' ? detail : JSON.stringify(detail)) : null]
    );
  } catch (err) {
    if (err.code === '42P01') {
      // Table pas encore créée — on ignore
      log.warn({ table: 'notification_log' }, 'Notification log table missing, log skipped');
    } else {
      log.error({ err }, 'Notification log write failed');
    }
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────

function firstName(fullName) {
  if (!fullName) return 'Client';
  return String(fullName).trim().split(/\s+/)[0];
}

function formatAmount(kmf) {
  if (kmf == null) return '';
  return Number(kmf).toLocaleString('fr-FR').replace(/,/g, ' ');
}

function pickPhone(order, fallback) {
  // [LEGACY] Priorité : tracking_phone > recipient_phone > phone_payer > user_phone > fallback
  // Conservée pour rétro-compat. Les nouvelles fonctions utilisent pickRecipients().
  return order.tracking_phone
      || order.recipient_phone        // via JOIN recipients r ON r.id = o.recipient_id
      || order.phone_payer            // via JOIN users u ON u.id = o.user_id
      || order.user_phone
      || (Array.isArray(fallback) ? fallback[0] : fallback)
      || null;
}

/**
 * Retourne la liste des téléphones qui doivent recevoir la notif selon l'événement.
 * 
 * Stratégie Komerce (payeur diaspora â‰  bénéficiaire Comores) :
 *   - order_created    → payeur + bénéficiaire (si différents) : les deux doivent savoir
 *   - payment_confirmed → payeur uniquement : seul lui a besoin de rassurance débit
 *   - order_shipped    → payeur + bénéficiaire : les deux suivent la progression
 *   - order_delivered  → bénéficiaire uniquement : c'est lui qui vient chercher
 *   - order_cancelled  → payeur uniquement : remboursement le concerne
 *   - abandoned_cart   → payeur uniquement : remarketing
 * 
 * Dédoublonne automatiquement : si payeur === bénéficiaire (achat local), on envoie 1 seule fois.
 */
function pickRecipients(order, event) {
  // payeur : tracking_phone (prioritaire) > phone_payer (migration 040) > user_phone
  // bénéficiaire : recipient_phone (via JOIN recipients r) > phone_beneficiary > user_phone si pas de recipient distinct
  const payer = order.tracking_phone
             || order.phone_payer
             || order.user_phone
             || null;
  const benef = order.recipient_phone
             || order.phone_beneficiary
             || null;

  const result = [];
  const seen = new Set();
  const add = (phone, role) => {
    if (!phone) return;
    if (seen.has(phone)) return;
    seen.add(phone);
    result.push({ phone, role });
  };

  switch (event) {
    case 'order_created':
    case 'order_shipped':
      add(payer, 'payer');
      add(benef, 'beneficiary');
      break;

    case 'payment_confirmed':
    case 'order_cancelled':
    case 'abandoned_cart':
      add(payer, 'payer');
      // Si pas de payeur distinct (achat local), on utilise le bénéficiaire
      if (result.length === 0) add(benef, 'beneficiary');
      break;

    case 'order_delivered':
    case 'order_collected':
      add(benef, 'beneficiary');
      // Fallback : si pas de bénéficiaire, on notifie le payeur
      if (result.length === 0) add(payer, 'payer');
      break;

    default:
      // Fallback générique : l'un ou l'autre
      add(payer, 'payer');
      if (result.length === 0) add(benef, 'beneficiary');
  }

  return result;
}


/**
 * notifyText — wrapper texte libre pour les événements sans template dédié.
 *
 * Centralisée ici (au lieu d'être dupliquée/cassée dans loyalty.js et
 * appelée sans import dans order.js) car plusieurs modules en ont besoin :
 * order.js (lien facture post-paiement), et potentiellement d'autres
 * événements sans template AuthKey (preparation, in_transit, available,
 * anomaly_alert, partial_ship, backorder_cancelled, parcel_status,
 * sourcing_alert, purchase_manual...).
 *
 * Ne lève jamais — retourne toujours { ok, ... } pour ne pas casser le flow
 * appelant (doctrine notification_non_bloquante).
 */
async function notifyText(phone, message, event, orderId = null) {
  if (!phone || !message) {
    log.warn({ event, order_id: orderId }, '[notifyText] skipped: no phone or message');
    return { ok: false, reason: 'no_phone_or_message' };
  }

  try {
    const result = await callAuthKeyText({ mobile: phone, message });

    // orderId est un UUID (36 chars) — order_ref est désormais text (migration 089)
    // On le passe tel quel ; les callers qui ont la référence humaine doivent utiliser
    // logNotification() directement pour stocker la bonne valeur.
    await logNotification({
      orderRef: orderId || null,
      channel: 'whatsapp',
      event,
      recipient: phone,
      status: result.ok ? 'sent' : 'failed',
      detail: result.ok
        ? { messageId: result.messageId }
        : { error: result.error },
    });

    if (!result.ok) {
      log.warn({ event, phone, order_id: orderId, error: result.error }, '[notifyText] delivery failed');
    }

    return result;
  } catch (err) {
    log.error({ err, event, phone, order_id: orderId }, '[notifyText] error');
    _alertNotificationFailure({ event, orderId, error: err.message });
    return { ok: false, error: err.message };
  }
}

module.exports = {
  db, log,
  waOrderCreated, waPaymentConfirmed, waOrderShipped, waOrderDelivered, waOrderCancelled,
  callAuthKey, callAuthKeyText, WID,
  WID_OTP, WID_MAGIC_LINK,
  _alertNotificationFailure,
  setNotificationOutcomeListener,
  logNotification,
  notifyText,
  firstName, formatAmount, pickPhone, pickRecipients,
};
