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
  // [LEGACY] Priorité : tracking_phone > recipient_phone > user_phone > fallback
  // Conservée pour rétro-compat. Les nouvelles fonctions utilisent pickRecipients().
  return order.tracking_phone
      || order.recipient_phone
      || order.user_phone
      || (Array.isArray(fallback) ? fallback[0] : fallback)
      || null;
}

/**
 * Retourne la liste des téléphones qui doivent recevoir la notif selon l'événement.
 * 
 * Stratégie Komerce (payeur diaspora ≠ bénéficiaire Comores) :
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
  const payer = order.tracking_phone || order.user_phone || null;
  const benef = order.recipient_phone || null;

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

// ═══════════════════════════════════════════════════════════════════════
//  1. Commande créée
// ═══════════════════════════════════════════════════════════════════════
async function notifyOrderCreated(order, smsPhones, userEmail, emailItems, relais, cashSmsText) {
  const recipients = pickRecipients(order, 'order_created');
  const name = firstName(order.recipient_name || order.user_full_name);

  if (recipients.length === 0) {
    // Fallback array smsPhones si rien dans l'order
    const fb = Array.isArray(smsPhones) ? smsPhones[0] : smsPhones;
    if (fb) recipients.push({ phone: fb, role: 'fallback' });
  }

  if (recipients.length === 0) {
    console.warn('[notif][order-created] no phone', order.reference);
    await logNotification({
      orderRef: order.reference, channel: 'whatsapp', event: 'order_created',
      status: 'skipped', detail: 'no_phone'
    });
    return;
  }

  // Envoi à chaque destinataire (payeur + bénéficiaire si différents)
  for (const { phone, role } of recipients) {
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
        detail: result.ok
          ? { messageId: result.messageId, role }
          : { error: result.error, role },
      });
    } catch (err) {
      console.error(`[notif][order-created][${role}]`, err.message);
      await logNotification({
        orderRef: order.reference, channel: 'whatsapp', event: 'order_created',
        recipient: phone, status: 'failed', detail: { error: err.message, role },
      });
    }
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

  const recipients = pickRecipients(order, entry.event);
  const name = firstName(order.recipient_name || order.user_full_name);

  if (recipients.length === 0) {
    await logNotification({
      orderRef: order.reference, channel: 'whatsapp', event: entry.event,
      status: 'skipped', detail: 'no_phone'
    });
    return;
  }

  for (const { phone, role } of recipients) {
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
        detail: result.ok ? { messageId: result.messageId, role } : { error: result.error, role },
      });
    } catch (err) {
      console.error(`[notif][${entry.event}][${role}]`, err.message);
      await logNotification({
        orderRef: order.reference, channel: 'whatsapp', event: entry.event,
        recipient: phone, status: 'failed', detail: { error: err.message, role },
      });
    }
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

module.exports = {
  notifyOrderCreated,
  notifyPaymentConfirmed,
  notifyStatusChange,
  notifyCancellation,
};
