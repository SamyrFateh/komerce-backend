/**
 * @komerce-arch
 * @role          notification-otp-auth
 * @domain        notification
 * @layer         service
 * @criticality   high
 * @inputs        phone, code, name, expiry_min, magic_link
 * @outputs       whatsapp_otp, sms_fallback
 * @depends       services/authkey-client.js, services/notifications/internals.js
 * @db-read      orders, recipients, relais, users
 * @used-by       services/notification-service.js
 * @db-write      notification_log
 * @db-txn        notification_non_blocking
 * @doctrine      notification_non_bloquante, otp_message_lisible
 * @impact-areas  otp, customer-support, whatsapp
 * @version       2026-06
 */

'use strict';

const {
  log,
  callAuthKey, callAuthKeyText,
  WID_OTP, WID_MAGIC_LINK,
  logNotification, firstName,
} = require('./internals');

async function sendOtpMessage({ phone, code, name, expiryMin }) {
  if (!phone || !code) {
    return { success: false, channel: 'none', reason: 'missing_params' };
  }

  const expiry = String(expiryMin || 10);

  const message = [
    `Code Komerce : ${code}`,
    '',
    `Valable ${expiry} min.`,
    'Ne donnez ce code à personne.',
  ].join('\n');

  // 1. Priorité : OTP généré par Komerce, envoyé comme texte libre.
  try {
    const freeTextResult = await callAuthKeyText({
      mobile: phone,
      message,
    });

    await logNotification({
      channel: 'whatsapp',
      event: 'otp_sent',
      recipient: phone,
      status: freeTextResult.ok ? 'sent' : 'failed',
      detail: freeTextResult.ok
        ? { messageId: freeTextResult.messageId, via: 'komerce_free_text' }
        : { error: freeTextResult.error, via: 'komerce_free_text' },
    });

    if (freeTextResult.ok) {
      return {
        success: true,
        channel: 'whatsapp',
        messageId: freeTextResult.messageId,
      };
    }

    log.warn({ phone, error: freeTextResult.error }, 'AuthKey free-text OTP failed, trying template fallback if configured');
  } catch (err) {
    log.error({ err, phone }, 'AuthKey free-text OTP exception');
  }

  // 2. Fallback : ancien mode template WID_OTP si configuré.
  if (WID_OTP) {
    const customerName = firstName(name);

    try {
      const result = await callAuthKey({
        wid: WID_OTP,
        mobile: phone,
        variables: {
          name: customerName,
          code,
          otp: code,
          expiry,
        },
      });

      await logNotification({
        channel: 'whatsapp',
        event: 'otp_sent',
        recipient: phone,
        status: result.ok ? 'sent' : 'failed',
        detail: result.ok
          ? { messageId: result.messageId, via: 'template_otp' }
          : { error: result.error, via: 'template_otp' },
      });

      if (result.ok) {
        return {
          success: true,
          channel: 'whatsapp',
          messageId: result.messageId,
        };
      }

      return {
        success: false,
        channel: 'whatsapp',
        error: result.error,
        reason: 'authkey_rejected',
      };
    } catch (err) {
      log.error({ err, phone }, 'WhatsApp OTP template send failed');
      return {
        success: false,
        channel: 'whatsapp',
        error: err.message,
        reason: 'exception',
      };
    }
  }

  return {
    success: false,
    channel: 'none',
    reason: 'otp_delivery_failed',
    error: 'Impossible d’envoyer l’OTP : texte libre refusé et aucun WID_OTP configuré',
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  8. Notification colis créé (commande passée en préparation)
//  ─────────────────────────────────────────────────────────────────────
//  Appelée par order-api-v2.js quand un colis est créé pour une commande.
//  Envoie une notification "📦 Votre commande a été préparée".
//
//  Signature : notifyParcelCreated(parcelRef, orderId, orderReference)
//
//  Implémentation : réutilise notifyStatusChange avec statut 'preparation'
//  → si aucun template n'est mappé à 'preparation' dans notifyStatusChange,
//    l'appel est un no-op silencieux (comportement déjà géré).
//  Log quand même l'événement pour audit.
// ═══════════════════════════════════════════════════════════════════════
async function notifyParcelCreated(parcelRef, orderId, orderReference) {
  if (!orderId) {
    log.warn({ parcel_ref: parcelRef, order_ref: orderReference }, 'Parcel created notification skipped: missing orderId');
    return;
  }

  try {
    // Charge l'order complet pour bénéficier de pickRecipients
    const { rows: [order] } = await db.query(
      `SELECT
         o.id, o.reference, o.tracking_phone,
         o.user_id, o.recipient_id,
         u.phone       AS user_phone,
         u.full_name   AS user_full_name,
         u.phone_payer,
         u.phone_beneficiary,
         r.phone       AS recipient_phone,
         r.full_name   AS recipient_name,
         o.total_kmf,
         rel.name      AS relais_name
       FROM orders o
       LEFT JOIN users u    ON u.id = o.user_id
       LEFT JOIN recipients r ON r.id = o.recipient_id
       LEFT JOIN relais rel ON rel.id = o.relais_id
       WHERE o.id = $1`,
      [orderId]
    );

    if (!order) {
      log.warn({ order_id: orderId, order_ref: orderReference, parcel_ref: parcelRef }, 'Parcel created notification skipped: order not found');
      await logNotification({
        orderRef: orderReference,
        parcelRef,
        channel: 'whatsapp',
        event: 'parcel_created',
        status: 'skipped',
        detail: { reason: 'order_not_found' },
      });
      return;
    }

    log.info({ parcel_ref: parcelRef, order_ref: order.reference }, 'Parcel created notification logged');

    // Délègue à notifyStatusChange avec 'preparation'.
    // Si aucun template ne correspond dans notifyStatusChange.mapping,
    // on log juste un 'skipped' mais on ne crash pas.
    const _phone = pickPhone(order) || 'system';
    await logNotification({
      orderRef: order.reference,
      parcelRef,
      channel: 'whatsapp',
      event: 'parcel_created',
      recipient: _phone,
      status: 'logged',
      detail: { info: 'colis cree, statut commande passe en preparation' },
    });

    // Optionnel : si tu veux vraiment envoyer une notif WhatsApp ici,
    // il faut créer un template dédié 'parcel_created' et l'ajouter au mapping
    // dans notifyStatusChange. Pour l'instant on se contente de logger.

    return { success: true, logged_only: true };
  } catch (err) {
    log.error({ err, order_id: orderId, order_ref: orderReference, parcel_ref: parcelRef }, 'Parcel created notification failed');
    await logNotification({
      orderRef: orderReference, parcelRef,
      channel: 'whatsapp', event: 'parcel_created',
      status: 'failed', detail: { error: err.message },
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  9. Envoi magic link via WhatsApp (reconnexion 1-clic)
//  ─────────────────────────────────────────────────────────────────────
//  Utilisée par routes/client-auth.js quand un user veut revenir sur
//  son espace "Mes commandes" après expiration du JWT.
//
//  Signature : sendMagicLink({ phone, name, magicLink, expiryMin })
//    phone      — numéro E.164 du user
//    name       — nom d'affichage (pour personnalisation)
//    magicLink  — URL complète "https://komerce.xyz/mon-compte?token=xxx"
//    expiryMin  — durée de validité (défaut 15 minutes)
//
//  → Promise<{ success, channel, messageId?, reason?, error? }>
//
//  Stratégie de fallback :
//    1. Template WID_MAGIC_LINK si configuré (recommandé Meta)
//    2. Sinon, tente WID_OTP en réutilisant la variable (moins propre)
//    3. Sinon, retourne success:false avec reason explicite (pas de crash)
// ═══════════════════════════════════════════════════════════════════════
async function sendMagicLink({ phone, name, magicLink, expiryMin }) {
  if (!phone || !magicLink) {
    return { success: false, channel: 'none', reason: 'missing_params' };
  }

  const customerName = firstName(name);
  const expiry = String(expiryMin || 15);

  // Choisir le WID : magic link dédié > OTP (fallback) > rien
  const wid = WID_MAGIC_LINK || WID_OTP;

  if (!wid) {
    log.warn({ phone }, 'Magic link skipped: no WhatsApp template configured');
    await logNotification({
      channel: 'whatsapp',
      event: 'magic_link_sent',
      recipient: phone,
      status: 'skipped',
      detail: { reason: 'no_template_configured' },
    });
    return {
      success: false,
      channel: 'none',
      reason: 'no_template_configured',
      error: 'Aucun template WhatsApp configuré pour le magic link',
    };
  }

  try {
    const result = await callAuthKey({
      wid,
      mobile: phone,
      variables: {
        name: customerName,
        link: magicLink,
        magic_link: magicLink,
        url: magicLink,
        expiry,
      },
    });

    await logNotification({
      channel: 'whatsapp',
      event: 'magic_link_sent',
      recipient: phone,
      status: result.ok ? 'sent' : 'failed',
      detail: result.ok
        ? { messageId: result.messageId, wid, via: WID_MAGIC_LINK ? 'dedicated' : 'fallback_otp' }
        : { error: result.error, wid },
    });

    if (result.ok) {
      log.info({ phone, message_id: result.messageId }, 'Magic link sent');
      return {
        success: true,
        channel: 'whatsapp',
        messageId: result.messageId,
      };
    }

    log.warn({ phone, error: result.error }, 'Magic link rejected by provider');
    return {
      success: false,
      channel: 'whatsapp',
      error: result.error,
      reason: 'authkey_rejected',
    };
  } catch (err) {
    log.error({ err, phone }, 'Magic link send failed');
    await logNotification({
      channel: 'whatsapp',
      event: 'magic_link_sent',
      recipient: phone,
      status: 'failed',
      detail: { error: err.message },
    });
    return {
      success: false,
      channel: 'whatsapp',
      error: err.message,
      reason: 'exception',
    };
  }
}


module.exports = { sendOtpMessage, sendMagicLink };
