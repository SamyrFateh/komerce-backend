/**
 * @komerce-arch
 * @role          notification-loyalty
 * @domain        notification
 * @layer         service
 * @criticality   medium
 * @inputs        user_id, user_name, phone, order_ref, basket_count
 * @outputs       whatsapp_message
 * @depends       services/authkey-client.js, services/notifications/internals.js
 * @used-by       services/notification-service.js
 * @db-write      notification_log
 * @db-txn        notification_non_blocking
 * @doctrine      notification_non_bloquante
 * @impact-areas  shared-cart, whatsapp
 * @version       2026-06
 */

'use strict';

const {
  log,
  callAuthKey,
  WID,
  logNotification,
} = require('./internals');

async function notifyLoyaltyEarned({ userId, userName, phone, orderRef, basketCount }) {
  if (!phone) {
    log.warn({ user_id: userId, order_ref: orderRef, basket_count: basketCount }, 'Loyalty notification skipped: no phone');
    return { success: false, reason: 'no_phone' };
  }

  const name = firstName(userName);
  const message = `🎉 Bravo ${name} ! Vous avez atteint ${basketCount} gros paniers chez Komerce ! Un cadeau de fidélité vous attend. Notre équipe vous contactera bientôt. Merci de votre confiance ! 🇰🇲`;

  try {
    // Utiliser le WID générique (pas de template dédié pour l'instant)
    const result = await callAuthKey({
      wid: WID,
      phone,
      text: message,
    });

    await logNotification({
      orderRef,
      channel: 'whatsapp',
      event: 'loyalty_earned',
      recipient: phone,
      status: result.ok ? 'sent' : 'failed',
      detail: { basketCount, userId },
    });

    if (result.ok) {
      log.info({ phone, user_id: userId, order_ref: orderRef, basket_count: basketCount }, 'Loyalty notification sent');
    } else {
      log.warn({ phone, user_id: userId, order_ref: orderRef, basket_count: basketCount, error: result.error }, 'Loyalty notification rejected by provider');
    }

    return { success: result.ok };
  } catch (err) {
    log.error({ err, phone, user_id: userId, order_ref: orderRef, basket_count: basketCount }, 'Loyalty notification failed');
    await logNotification({
      channel: 'whatsapp',
      event: 'loyalty_earned',
      recipient: phone,
      status: 'failed',
      detail: { error: err.message, basketCount, userId },
    });
    return { success: false, error: err.message };
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  ZG-1 FIX — notifyText : wrapper texte libre pour les événements sans template
//
//  Remplace les anciens sendSMS() de utils/sms.js (Africa's Talking, désactivé).
//  Utilise callAuthKeyText (WhatsApp AuthKey) + logNotification.
//  Signature intentionnellement proche de sendSMS pour minimiser la friction
//  de migration : notifyText(phone, message, event, orderId?)
//
//  Événements couverts (pas encore de template dédié) :
//   preparation, in_transit, available, anomaly_alert, partial_ship,
//   backorder_cancelled, parcel_status, sourcing_alert, purchase_manual
// ══════════════════════════════════════════════════════════════════════════════
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

module.exports = { notifyLoyaltyEarned };
