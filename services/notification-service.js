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

module.exports = {
  notifyOrderCreated,
  notifyPaymentConfirmed,
  notifyStatusChange,
  notifyCancellation,
};
