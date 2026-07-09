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
