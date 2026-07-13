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
  callAuthKey,
  callAuthKeyText,
  WID,
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

/**
 * notifyInvoiceReady — transport dédié pour le message "facture prête".
 *
 * POST-O8 (INVOICE_AUTHKEY_WID) : restaure le routage template historique
 * (commit 0eb3a5e "route invoice text through authkey wid when configured")
 * perdu en O7.2 (Cycle A), SANS réintroduire la dépendance cross-feature
 * notifications -> orders.
 *
 * Séparation des responsabilités préservée :
 *   - `orders` (services/invoice-service.js) POSSÈDE la représentation publique
 *     de la facture : il construit l'URL publique signée et la passe ici dans
 *     un payload déjà prêt ({ publicUrl, message, invoiceNumber }).
 *   - `notifications` POSSÈDE le transport : il choisit le canal AuthKey
 *     approprié — template WID si AUTHKEY_WID_INVOICE_READY est configuré
 *     (obligatoire pour un message business-initiated hors fenêtre 24 h côté
 *     WhatsApp), sinon repli texte libre à l'identique du comportement O7.2.
 *
 * Ne lève jamais (doctrine notification_non_bloquante).
 *
 * @param {string} phone
 * @param {{ publicUrl:string, message:string, invoiceNumber?:string }} payload
 * @param {string|null} orderId
 */
async function notifyInvoiceReady(phone, payload = {}, orderId = null) {
  const { publicUrl, message, invoiceNumber } = payload;
  if (!phone || (!publicUrl && !message)) {
    log.warn({ order_id: orderId }, '[notifyInvoiceReady] skipped: no phone or payload');
    return { ok: false, reason: 'no_phone_or_payload' };
  }

  try {
    let result;
    let channel;

    if (WID.invoiceready) {
      // Transport template : le fournisseur substitue {#invoice_url#} /
      // {#invoice_number#} depuis bodyValues.
      channel = 'wid';
      result = await callAuthKey({
        wid: WID.invoiceready,
        mobile: phone,
        variables: {
          invoice_url: publicUrl,
          ...(invoiceNumber ? { invoice_number: invoiceNumber } : {}),
        },
      });
    } else {
      // Repli texte libre — comportement O7.2 inchangé.
      channel = 'free_text';
      result = await callAuthKeyText({ mobile: phone, message });
    }

    await logNotification({
      orderRef: orderId || null,
      channel: 'whatsapp',
      event: 'invoice_ready',
      recipient: phone,
      status: result.ok ? 'sent' : 'failed',
      detail: result.ok
        ? { messageId: result.messageId, transport: channel }
        : { error: result.error, transport: channel },
    });

    if (!result.ok) {
      log.warn({ phone, order_id: orderId, transport: channel, error: result.error },
        '[notifyInvoiceReady] delivery failed');
    }

    return result;
  } catch (err) {
    log.error({ err, phone, order_id: orderId }, '[notifyInvoiceReady] error');
    _alertNotificationFailure({ event: 'invoice_ready', orderId, error: err.message });
    return { ok: false, error: err.message };
  }
}

module.exports = { notifyText, notifyInvoiceReady };
