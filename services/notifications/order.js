/**
 * @komerce-arch
 * @role          notification-order
 * @domain        notification
 * @layer         service
 * @criticality   high
 * @inputs        order, payment_event, status_change, cancellation
 * @outputs       whatsapp_message, sms_fallback, email_fallback
 * @depends       db.js, services/authkey-client.js, services/notifications/internals.js
 * @used-by       services/notification-service.js
 * @db-read       orders, recipients, relais, users
 * @db-write      notification_log
 * @db-txn        notification_non_blocking
 * @doctrine      notification_non_bloquante, fallback_trace
 * @impact-areas  checkout, orders, customer-support, whatsapp
 * @version       2026-06
 */

'use strict';

const {
  db, log,
  waOrderCreated, waPaymentConfirmed, waOrderShipped, waOrderDelivered, waOrderCancelled,
  callAuthKey, callAuthKeyText,
  _alertNotificationFailure, logNotification,
  firstName, formatAmount, pickPhone, pickRecipients,
} = require('./internals');

async function notifyOrderCreated(order, smsPhones, userEmail, emailItems, relais, cashSmsText) {
  const recipients = pickRecipients(order, 'order_created');
  const name = firstName(order.recipient_name || order.user_full_name);

  if (recipients.length === 0) {
    // Fallback array smsPhones si rien dans l'order
    const fb = Array.isArray(smsPhones) ? smsPhones[0] : smsPhones;
    if (fb) recipients.push({ phone: fb, role: 'fallback' });
  }

  if (recipients.length === 0) {
    log.warn({ order_ref: order.reference }, 'Order created notification skipped: no phone');
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
      log.error({ err, order_ref: order.reference, phone, role }, 'Order created notification failed');
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
      `SELECT
         o.id, o.reference,
         o.tracking_phone,
         o.payment_mode,
         o.user_id, o.recipient_id,
         u.phone         AS user_phone,
         u.full_name     AS user_full_name,
         u.phone_payer,
         u.phone_beneficiary,
         r.phone         AS recipient_phone,
         r.full_name     AS recipient_name
       FROM orders o
       LEFT JOIN users u ON u.id = o.user_id
       LEFT JOIN recipients r ON r.id = o.recipient_id
       WHERE o.id = $1`,
      [orderId]
    );

    if (!order) {
      log.warn({ order_id: orderId, order_ref: orderReference }, 'Payment confirmed notification skipped: order not found');
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

    // ── Lien facture post-paiement ──────────────────────────────────────────
    // O7.2 (Cycle A) : déplacé vers services/invoice-service.js (orders),
    // déclenché directement par les callers de payment confirmation
    // (payment-cash-confirm.js, payment-stripe.js, routes/cash.js,
    // routes/order-api-v2.js), en parallèle de cet appel notifyPaymentConfirmed.
    // `notifications` ne construit plus de lien facture — voir
    // docs/O7_2_CYCLE_ANALYSIS.md, Cycle A.
  } catch (err) {
    log.error({ err, order_id: orderId, order_ref: orderReference }, 'Payment confirmed notification failed');
    // D4 FIX — remonter dans alerts pour visibilité radar
    _alertNotificationFailure({ event: 'payment_confirmed', orderRef: orderReference, orderId, error: err.message });
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

      // Pour shipped/delivered/collected, ajouter le point relais
      if (newStatus === 'shipped' || newStatus === 'delivered' || newStatus === 'collected') {
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
      log.error({ err, order_ref: order.reference, event: entry.event, phone, role }, 'Status change notification failed');
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
  // P3 FIX — utilise pickRecipients (stratégie 'order_cancelled' = payeur uniquement)
  const recipients = pickRecipients(order, 'order_cancelled');
  const phone = recipients[0]?.phone || null;
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
    log.error({ err, order_ref: order.reference, phone }, 'Cancellation notification failed');
    await logNotification({
      orderRef: order.reference, channel: 'whatsapp', event: 'order_cancelled',
      recipient: phone, status: 'failed', detail: err.message,
    });
    // D4 FIX — remonter dans alerts pour visibilité radar
    _alertNotificationFailure({ event: 'order_cancelled', orderRef: order.reference, error: err.message });
  }
}


module.exports = { notifyOrderCreated, notifyPaymentConfirmed, notifyStatusChange, notifyCancellation };
