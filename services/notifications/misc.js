/**
 * @komerce-arch
 * @role          notification-misc
 * @domain        notification
 * @layer         service
 * @criticality   medium
 * @inputs        phone, message, event, order_id
 * @outputs       whatsapp_message
 * @depends       services/authkey-client.js, services/notifications/internals.js
 * @used-by       services/notification-service.js
 * @db-write      notification_log
 * @db-txn        notification_non_blocking
 * @doctrine      notification_non_bloquante
 * @impact-areas  customer-support, whatsapp
 * @version       2026-06
 */

'use strict';

const {
  log,
  callAuthKeyText,
  logNotification,
  _alertNotificationFailure,
} = require('./internals');

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

module.exports = { notifyText };
