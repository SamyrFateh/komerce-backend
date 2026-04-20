'use strict';

/**
 * KOMERCE — services/notification-service.js
 * ═══════════════════════════════════════════════════════════════════════
 * Orchestre toutes les notifications clients (WhatsApp via AuthKey, SMS fallback, email).
 *
 * Fonctions publiques (signatures préservées pour compatibilité) :
 *   - notifyOrderCreated(order, smsPhones, userEmail, emailItems, relais, cashSmsText)
 *   - notifyPaymentConfirmed(orderId, orderReference)
 *   - notifyStatusChange(order, newStatus)
 *   - notifyCancellation(order, smsRefundInfo)
 *   - notifyParcelCreated(parcelRef, orderId, orderReference)       ← [P0-2] ajouté
 *   - notifyParcelScan(parcelId, parcelRef, parcelStatus)           ← [P0-2] ajouté
 *   - sendWhatsAppTwilio(phone, message)                            ← [P0-1] ajouté (OTP auth)
 *
 * Toutes les notifications sont non-bloquantes et loggées en DB (notification_log).
 * ═══════════════════════════════════════════════════════════════════════
 */

const db = require('../db');
const {
  notifyOrderCreated: waOrderCreated,
  notifyPaymentConfirmed: waPaymentConfirmed,
  notifyOrderShipped: waOrderShipped,
  notifyOrderDelivered: waOrderDelivered,
  notifyOrderCancelled: waOrderCancelled,
} = require('./authkey-client');

// [P0-1/P0-2] Canal secondaire : WhatsApp Meta (templates auth, notifs transactionnelles)
let sendTemplateWhatsApp = null;
try {
  ({ sendTemplateWhatsApp } = require('./whatsapp-meta'));
} catch (e) {
  console.warn('[notification-service] whatsapp-meta not available:', e.message);
}

// [P0-1] Fallback SMS pour OTP quand WhatsApp est indisponible
let sendSMS = null;
try {
  ({ sendSMS } = require('../utils/sms'));
} catch (e) {
  console.warn('[notification-service] sms util not available:', e.message);
}

// ─── Logger interne ────────────────────────────────────────────────────
async function logNotification({ orderRef, parcelRef, channel, event, recipient, status, detail }) {
  try {
    await db.query(
      `INSERT INTO notification_log
         (order_ref, parcel_ref, channel, event, recipient, status, detail, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [orderRef || null, parcelRef || null, channel, event, recipient || null,
       status, detail ? (typeof detail === 'string' ? detail : JSON.stringify(detail)) : null]
    );
  } catch (err) {
    if (err.code === '42P01') {
      // Table pas encore créée — on ignore
      console.warn('[notification-service] table notification_log absente, log skipped');
    } else {
      console.error('[notification-service] log error', err.message);
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
  // Priorité : tracking_phone > recipient_phone > user_phone > fallback array
  return order.tracking_phone
      || order.recipient_phone
      || order.user_phone
      || (Array.isArray(fallback) ? fallback[0] : fallback)
      || null;
}

// ═══════════════════════════════════════════════════════════════════════
//  1. Commande créée
// ═══════════════════════════════════════════════════════════════════════
async function notifyOrderCreated(order, smsPhones, userEmail, emailItems, relais, cashSmsText) {
  const phone = pickPhone(order, smsPhones);
  const name = firstName(order.recipient_name || order.user_full_name);

  if (!phone) {
    console.warn('[notif][order-created] no phone', order.reference);
    await logNotification({
      orderRef: order.reference, channel: 'whatsapp', event: 'order_created',
      status: 'skipped', detail: 'no_phone'
    });
    return;
  }

  try {
    const result = await waOrderCreated({
      mobile: phone,
      name,
      orderRef: order.reference,
      amount: formatAmount(order.total_kmf),
    });

    await logNotification({
      orderRef: order.reference,
      channel: 'whatsapp',
      event: 'order_created',
      recipient: phone,
      status: result.ok ? 'sent' : 'failed',
      detail: result.ok ? { messageId: result.messageId } : { error: result.error },
    });

    // TODO : email fallback si userEmail + emailItems fournis et result.ok === false
  } catch (err) {
    console.error('[notif][order-created]', err.message);
    await logNotification({
      orderRef: order.reference, channel: 'whatsapp', event: 'order_created',
      recipient: phone, status: 'failed', detail: err.message,
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  2. Paiement confirmé
// ═══════════════════════════════════════════════════════════════════════
async function notifyPaymentConfirmed(orderId, orderReference) {
  try {
    // Récupère le contact depuis la DB car la signature n'a pas l'objet complet
    const { rows: [order] } = await db.query(
      `SELECT o.id, o.reference, o.tracking_phone, o.recipient_phone, o.recipient_name,
              u.phone AS user_phone, u.full_name AS user_full_name
         FROM orders o
         LEFT JOIN users u ON u.id = o.user_id
        WHERE o.id = $1`,
      [orderId]
    );

    if (!order) {
      console.warn('[notif][payment-confirmed] order not found', orderId);
      return;
    }

    const phone = pickPhone(order);
    const name = firstName(order.recipient_name || order.user_full_name);

    if (!phone) {
      await logNotification({
        orderRef: orderReference, channel: 'whatsapp', event: 'payment_confirmed',
        status: 'skipped', detail: 'no_phone'
      });
      return;
    }

    const result = await waPaymentConfirmed({
      mobile: phone,
      name,
      orderRef: orderReference,
    });

    await logNotification({
      orderRef: orderReference,
      channel: 'whatsapp',
      event: 'payment_confirmed',
      recipient: phone,
      status: result.ok ? 'sent' : 'failed',
      detail: result.ok ? { messageId: result.messageId } : { error: result.error },
    });
  } catch (err) {
    console.error('[notif][payment-confirmed]', err.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  3. Changement de statut (shipped, delivered, collected...)
// ═══════════════════════════════════════════════════════════════════════
async function notifyStatusChange(order, newStatus) {
  // Map des statuts Komerce → fonction AuthKey
  const mapping = {
    shipped:   { fn: waOrderShipped,   event: 'order_shipped' },
    delivered: { fn: waOrderDelivered, event: 'order_delivered' },
    collected: { fn: waOrderDelivered, event: 'order_collected' }, // même template
  };

  const entry = mapping[newStatus];
  if (!entry) {
    // Pas de notif pour ce statut (paid, processing, etc.)
    return;
  }

  const phone = pickPhone(order);
  const name = firstName(order.recipient_name || order.user_full_name);

  if (!phone) {
    await logNotification({
      orderRef: order.reference, channel: 'whatsapp', event: entry.event,
      status: 'skipped', detail: 'no_phone'
    });
    return;
  }

  try {
    const params = {
      mobile: phone,
      name,
      orderRef: order.reference,
    };

    // Pour 'shipped', ajouter le point relais
    if (newStatus === 'shipped') {
      params.relayPoint = order.relais_name || 'votre point relais';
    }

    const result = await entry.fn(params);

    await logNotification({
      orderRef: order.reference,
      channel: 'whatsapp',
      event: entry.event,
      recipient: phone,
      status: result.ok ? 'sent' : 'failed',
      detail: result.ok ? { messageId: result.messageId } : { error: result.error },
    });
  } catch (err) {
    console.error(`[notif][${entry.event}]`, err.message);
    await logNotification({
      orderRef: order.reference, channel: 'whatsapp', event: entry.event,
      recipient: phone, status: 'failed', detail: err.message,
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  4. Annulation
// ═══════════════════════════════════════════════════════════════════════
async function notifyCancellation(order, smsRefundInfo) {
  const phone = pickPhone(order);
  const name = firstName(order.recipient_name || order.user_full_name);

  if (!phone) {
    await logNotification({
      orderRef: order.reference, channel: 'whatsapp', event: 'order_cancelled',
      status: 'skipped', detail: 'no_phone'
    });
    return;
  }

  try {
    const result = await waOrderCancelled({
      mobile: phone,
      name,
      orderRef: order.reference,
    });

    await logNotification({
      orderRef: order.reference,
      channel: 'whatsapp',
      event: 'order_cancelled',
      recipient: phone,
      status: result.ok ? 'sent' : 'failed',
      detail: result.ok ? { messageId: result.messageId, refund: smsRefundInfo } : { error: result.error },
    });
  } catch (err) {
    console.error('[notif][cancellation]', err.message);
    await logNotification({
      orderRef: order.reference, channel: 'whatsapp', event: 'order_cancelled',
      recipient: phone, status: 'failed', detail: err.message,
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  5. [P0-2] Colis créé — notifie le client qu'un colis vient d'être formé
// ═══════════════════════════════════════════════════════════════════════
/**
 * notifyParcelCreated(parcelRef, orderId, orderReference)
 *
 * Appelée depuis order-api-v2.js après création d'un colis.
 * Non-bloquante : toujours return, les erreurs sont loggées.
 */
async function notifyParcelCreated(parcelRef, orderId, orderReference) {
  try {
    const { rows: [order] } = await db.query(
      `SELECT o.reference, o.tracking_phone, o.recipient_phone, o.recipient_name,
              u.phone AS user_phone, u.full_name AS user_full_name,
              r.name  AS relais_name
         FROM orders o
         LEFT JOIN users  u ON u.id = o.user_id
         LEFT JOIN relais r ON r.id = o.relais_id
        WHERE o.id = $1`,
      [orderId]
    );

    if (!order) {
      console.warn('[notif][parcel-created] order not found', orderId);
      return;
    }

    const phone = pickPhone(order);
    if (!phone) {
      await logNotification({
        orderRef: orderReference, parcelRef, channel: 'whatsapp',
        event: 'parcel_created', status: 'skipped', detail: 'no_phone'
      });
      return;
    }

    // Pas de template AuthKey dédié pour "parcel_created" — on log seulement
    // en attendant qu'un template Meta/AuthKey soit approuvé.
    // Si whatsapp-meta est configuré avec un template "parcel_created", utiliser sendTemplateWhatsApp ici.
    await logNotification({
      orderRef: orderReference, parcelRef, channel: 'whatsapp',
      event: 'parcel_created', recipient: phone,
      status: 'skipped',
      detail: { reason: 'no_template_configured', note: 'Ajouter WID_PARCEL_CREATED (AuthKey) ou template Meta pour activer' }
    });
  } catch (err) {
    console.error('[notif][parcel-created]', err.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  6. [P0-2] Scan colis — notifie le client lors de shipped / available / etc.
// ═══════════════════════════════════════════════════════════════════════
/**
 * notifyParcelScan(parcelId, parcelRef, parcelStatus)
 *
 * Appelée depuis scan-engine.js, transitaire-api.js, parcel-api-v2.js.
 * Délègue à notifyStatusChange pour réutiliser le mapping existant (shipped/collected).
 * Pour 'available' et 'in_transit', log uniquement (pas de template dédié pour l'instant).
 */
async function notifyParcelScan(parcelId, parcelRef, parcelStatus) {
  try {
    // Charger la commande liée au colis (parcel.order_id)
    const { rows: [order] } = await db.query(
      `SELECT o.id, o.reference, o.tracking_phone, o.recipient_phone, o.recipient_name,
              u.phone AS user_phone, u.full_name AS user_full_name,
              r.name  AS relais_name
         FROM parcels p
         LEFT JOIN orders o ON o.id = p.order_id
         LEFT JOIN users  u ON u.id = o.user_id
         LEFT JOIN relais r ON r.id = o.relais_id
        WHERE p.id = $1`,
      [parcelId]
    );

    if (!order || !order.id) {
      console.warn('[notif][parcel-scan] order not found for parcel', parcelId);
      return;
    }

    // Pour shipped/collected, on réutilise notifyStatusChange (template AuthKey existant)
    if (['shipped', 'collected'].includes(parcelStatus)) {
      await notifyStatusChange(order, parcelStatus);
      return;
    }

    // Pour available, in_transit : pas de template AuthKey spécifique → log seulement
    // (le SMS "disponible" est déjà envoyé en dur dans logistics.js à l'arrivée conteneur)
    const phone = pickPhone(order);
    await logNotification({
      orderRef: order.reference, parcelRef, channel: 'whatsapp',
      event: `parcel_${parcelStatus}`,
      recipient: phone,
      status: 'skipped',
      detail: { reason: 'no_template_for_status', status: parcelStatus }
    });
  } catch (err) {
    console.error('[notif][parcel-scan]', err.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  7. [P0-1] OTP via WhatsApp — nom historique "Twilio", utilise Meta WA + fallback SMS
// ═══════════════════════════════════════════════════════════════════════
/**
 * sendWhatsAppTwilio(phone, message)
 *
 * Nom historique préservé pour ne pas casser routes/otp.js:8.
 * Implémentation réelle :
 *   1. Essaie Meta WhatsApp (template "authentication_code" si configuré)
 *   2. Fallback SMS Africa's Talking
 *   3. Si les deux indisponibles → return { success:false, reason:'no_channel' } (pas de crash)
 *
 * Retourne toujours un objet { success, ... } — jamais throw.
 */
async function sendWhatsAppTwilio(phone, message) {
  // ── 1. Tentative Meta WhatsApp via template ──────────────────────────
  // Nécessite un template approuvé nommé via META_WA_OTP_TEMPLATE (défaut: 'otp_komerce')
  // Le template doit accepter 1 paramètre body = le code OTP.
  const OTP_TEMPLATE = process.env.META_WA_OTP_TEMPLATE || 'otp_komerce';
  const OTP_LANG     = process.env.META_WA_OTP_LANG     || 'fr';

  if (sendTemplateWhatsApp && process.env.META_WA_TOKEN) {
    try {
      // Extraire le code OTP du message (6 chiffres entre deux *)
      const codeMatch = String(message).match(/\*(\d{4,8})\*/);
      const otpCode = codeMatch ? codeMatch[1] : null;

      if (otpCode) {
        const result = await sendTemplateWhatsApp({
          to: phone,
          templateName: OTP_TEMPLATE,
          lang: OTP_LANG,
          components: [
            {
              type: 'body',
              parameters: [{ type: 'text', text: otpCode }]
            }
          ]
        });

        if (result.success) {
          return { success: true, channel: 'whatsapp_meta', messageId: result.message_id };
        }
        console.warn('[sendWhatsAppTwilio] Meta failed, trying SMS fallback:', result.error);
      }
    } catch (err) {
      console.warn('[sendWhatsAppTwilio] Meta error, trying SMS fallback:', err.message);
    }
  }

  // ── 2. Fallback SMS (Africa's Talking) ───────────────────────────────
  if (sendSMS) {
    try {
      const smsResult = await sendSMS(phone, message, 'otp', null);
      if (smsResult.success) {
        return { success: true, channel: 'sms' };
      }
      return { success: false, channel: 'sms', error: smsResult.error };
    } catch (err) {
      console.error('[sendWhatsAppTwilio] SMS fallback error:', err.message);
      return { success: false, error: err.message };
    }
  }

  // ── 3. Aucun canal disponible — return graceful (pas de crash) ──────
  console.warn('[sendWhatsAppTwilio] No WhatsApp nor SMS channel configured');
  return { success: false, reason: 'no_channel' };
}

module.exports = {
  notifyOrderCreated,
  notifyPaymentConfirmed,
  notifyStatusChange,
  notifyCancellation,
  notifyParcelCreated,   // [P0-2]
  notifyParcelScan,      // [P0-2]
  sendWhatsAppTwilio,    // [P0-1]
};
