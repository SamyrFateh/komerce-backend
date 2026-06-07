'use strict';

/**
 * KOMERCE â€" services/notification-service.js
 * â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
 * Orchestre toutes les notifications clients (WhatsApp via AuthKey, SMS fallback, email).
 *
 * Fonctions publiques (signatures prÃ©servÃ©es pour compatibilitÃ©) :
 *   - notifyOrderCreated(order, smsPhones, userEmail, emailItems, relais, cashSmsText)
 *   - notifyPaymentConfirmed(orderId, orderReference)
 *   - notifyStatusChange(order, newStatus)
 *   - notifyCancellation(order, smsRefundInfo)
 *
 * Toutes les notifications sont non-bloquantes et loggÃ©es en DB (notification_log).
 * â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
 */

const db = require('../db');
const log = require('../utils/logger').child({ module: 'notification-service' });
const {
  notifyOrderCreated: waOrderCreated,
  notifyPaymentConfirmed: waPaymentConfirmed,
  notifyOrderShipped: waOrderShipped,
  notifyOrderDelivered: waOrderDelivered,
  notifyOrderCancelled: waOrderCancelled,
  callAuthKey,
  callAuthKeyText,
  WID,
} = require('./authkey-client');

// WID dÃ©diÃ© OTP â€" Ã  configurer dans Railway env : WID_OTP=xxxxx

// D4 FIX â€" Helper alerte sur Ã©chec notification critique
// Fire-and-forget : ne crashe jamais l'appelant.
function _alertNotificationFailure({ event, orderRef, orderId, error }) {
  db.query(
    `INSERT INTO alerts (level, source, message, payload)
     VALUES ('elevated', 'notification_service', $1, $2)`,
    [
      `Notification '${event}' Ã©chouÃ©e â€" commande ${orderRef || orderId || '?'}`,
      JSON.stringify({ event, orderRef, orderId, error: String(error) }),
    ]
  ).catch(e => log.error({ err: e }, 'Failed to insert notification alert'));
}

// Si non configurÃ©, l'OTP passera par un canal de fallback (SMS, etc. selon config)
const WID_OTP = process.env.WID_OTP || null;

// WID dÃ©diÃ© magic link â€" template texte qui contient un lien cliquable
// Ã€ configurer dans Railway : WID_MAGIC_LINK=xxxxx
// Fallback : si non configurÃ©, rÃ©utilise WID_OTP (moins idÃ©al mais fonctionne)
const WID_MAGIC_LINK = process.env.WID_MAGIC_LINK || null;

// â"€â"€â"€ Logger interne â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
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
      // Table pas encore crÃ©Ã©e â€" on ignore
      log.warn({ table: 'notification_log' }, 'Notification log table missing, log skipped');
    } else {
      log.error({ err }, 'Notification log write failed');
    }
  }
}

// â"€â"€â"€ Helpers â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

function firstName(fullName) {
  if (!fullName) return 'Client';
  return String(fullName).trim().split(/\s+/)[0];
}

function formatAmount(kmf) {
  if (kmf == null) return '';
  return Number(kmf).toLocaleString('fr-FR').replace(/,/g, ' ');
}

function pickPhone(order, fallback) {
  // [LEGACY] PrioritÃ© : tracking_phone > recipient_phone > phone_payer > user_phone > fallback
  // ConservÃ©e pour rÃ©tro-compat. Les nouvelles fonctions utilisent pickRecipients().
  return order.tracking_phone
      || order.recipient_phone        // via JOIN users r ON r.id = o.recipient_id
      || order.phone_payer            // via JOIN users u ON u.id = o.user_id
      || order.user_phone
      || (Array.isArray(fallback) ? fallback[0] : fallback)
      || null;
}

/**
 * Retourne la liste des tÃ©lÃ©phones qui doivent recevoir la notif selon l'Ã©vÃ©nement.
 * 
 * StratÃ©gie Komerce (payeur diaspora â‰  bÃ©nÃ©ficiaire Comores) :
 *   - order_created    â†' payeur + bÃ©nÃ©ficiaire (si diffÃ©rents) : les deux doivent savoir
 *   - payment_confirmed â†' payeur uniquement : seul lui a besoin de rassurance dÃ©bit
 *   - order_shipped    â†' payeur + bÃ©nÃ©ficiaire : les deux suivent la progression
 *   - order_delivered  â†' bÃ©nÃ©ficiaire uniquement : c'est lui qui vient chercher
 *   - order_cancelled  â†' payeur uniquement : remboursement le concerne
 *   - abandoned_cart   â†' payeur uniquement : remarketing
 * 
 * DÃ©doublonne automatiquement : si payeur === bÃ©nÃ©ficiaire (achat local), on envoie 1 seule fois.
 */
function pickRecipients(order, event) {
  // payeur : tracking_phone (prioritaire) > phone_payer (migration 040) > user_phone
  // bÃ©nÃ©ficiaire : recipient_phone (via JOIN users r) > phone_beneficiary > user_phone si pas de recipient distinct
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
      // Si pas de payeur distinct (achat local), on utilise le bÃ©nÃ©ficiaire
      if (result.length === 0) add(benef, 'beneficiary');
      break;

    case 'order_delivered':
    case 'order_collected':
      add(benef, 'beneficiary');
      // Fallback : si pas de bÃ©nÃ©ficiaire, on notifie le payeur
      if (result.length === 0) add(payer, 'payer');
      break;

    default:
      // Fallback gÃ©nÃ©rique : l'un ou l'autre
      add(payer, 'payer');
      if (result.length === 0) add(benef, 'beneficiary');
  }

  return result;
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  1. Commande crÃ©Ã©e
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
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

  // Envoi Ã  chaque destinataire (payeur + bÃ©nÃ©ficiaire si diffÃ©rents)
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

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  2. Paiement confirmÃ©
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
async function notifyPaymentConfirmed(orderId, orderReference) {
  try {
    // RÃ©cupÃ¨re le contact depuis la DB car la signature n'a pas l'objet complet
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
       LEFT JOIN users r ON r.id = o.recipient_id
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

    // ── Lien facture post-paiement (fire-and-forget, non-bloquant) ─────────
    // stripe_eur  → facture disponible immédiatement (paiement déjà encaissé)
    // cash_relais → facture disponible après confirmPaymentCycle (payment_status='paid')
    // Dans les deux cas, on est appelé POST-COMMIT : payment_status est déjà 'paid'.
    try {
      const invoiceService = require('./invoice-service');
      const invoice = await invoiceService.getOrCreateInvoice(orderId);
      const appUrl = process.env.APP_URL || process.env.PUBLIC_URL || 'https://app.komerce.km';
      const invoiceUrl = `${appUrl}/api/invoices/${orderId}`;

      const msg = order.payment_mode === 'cash_relais'
        ? `Komerce : votre paiement est enregistre. Recapitulatif : ${invoiceUrl}`
        : `Komerce : votre facture est disponible : ${invoiceUrl}`;

      await notifyText(phone, msg, 'invoice_ready', orderId);
      log.info({ order_ref: orderReference, invoice_number: invoice.invoice_number }, '🧾 Invoice link sent');
    } catch (invErr) {
      // Non-bloquant : race condition payment_status possible, on log et on passe.
      log.warn({ err: invErr, order_ref: orderReference }, '🧾 Invoice notification skipped (non-fatal)');
    }
  } catch (err) {
    log.error({ err, order_id: orderId, order_ref: orderReference }, 'Payment confirmed notification failed');
    // D4 FIX â€" remonter dans alerts pour visibilitÃ© radar
    _alertNotificationFailure({ event: 'payment_confirmed', orderRef: orderReference, orderId, error: err.message });
  }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  3. Changement de statut (shipped, delivered, collected...)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
async function notifyStatusChange(order, newStatus) {
  // Map des statuts Komerce â†' fonction AuthKey
  const mapping = {
    shipped:   { fn: waOrderShipped,   event: 'order_shipped' },
    delivered: { fn: waOrderDelivered, event: 'order_delivered' },
    collected: { fn: waOrderDelivered, event: 'order_collected' }, // mÃªme template
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

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  4. Annulation
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
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
    // D4 FIX â€" remonter dans alerts pour visibilitÃ© radar
    _alertNotificationFailure({ event: 'order_cancelled', orderRef: order.reference, error: err.message });
  }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  5. Helper : charge l'order complet Ã  partir d'un parcelId
//  â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
//  Permet de rÃ©utiliser notifyStatusChange (qui attend un order complet)
//  depuis les appelants qui n'ont qu'un parcelId (scan-engine, parcel-api,
//  transitaire-api) â€" sans dupliquer la logique payeur/bÃ©nÃ©ficiaire.
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
async function _loadOrderFromParcel(parcelId) {
  try {
    const { rows } = await db.query(
      `SELECT
         o.id,
         o.reference,
         o.tracking_phone,
         o.user_id, o.recipient_id,
         u.phone       AS user_phone,
         u.full_name   AS user_full_name,
         u.phone_payer,
         u.phone_beneficiary,
         r.phone       AS recipient_phone,
         r.full_name   AS recipient_name,
         o.total_kmf,
         rel.name      AS relais_name,
         p.reference AS parcel_reference
       FROM parcels p
       LEFT JOIN orders o   ON o.id = p.order_id
       LEFT JOIN users u    ON u.id = o.user_id
       LEFT JOIN users r    ON r.id = o.recipient_id
       LEFT JOIN relais rel ON rel.id = o.relais_id
       WHERE p.id = $1
       LIMIT 1`,
      [parcelId]
    );
    return rows[0] || null;
  } catch (err) {
    log.error({ err, parcel_id: parcelId }, 'Load order from parcel failed');
    return null;
  }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  6. Notification de scan colis â€" faÃ§ade vers notifyStatusChange
//  â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
//  AppelÃ©e par scan-engine.js, parcel-api-v2.js, transitaire-api.js
//  quand un colis change de statut.
//
//  Signature : notifyParcelScan(parcelId, parcelReference, parcelStatus)
//    parcelId        â€" ID UUID du colis
//    parcelReference â€" RÃ©fÃ©rence humaine (ex: "CLK-2026-0123")
//    parcelStatus    â€" 'in_transit' | 'shipped' | 'available'
//
//  Mapping parcel status â†' order status (pour rÃ©utiliser notifyStatusChange) :
//    in_transit / shipped â†' 'shipped'    (colis en route vers relais)
//    available            â†' 'delivered'  (colis prÃªt au relais Ã  rÃ©cupÃ©rer)
//
//  DÃ©lÃ¨gue Ã  notifyStatusChange qui gÃ¨re payeur + bÃ©nÃ©ficiaire via pickRecipients.
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
async function notifyParcelScan(parcelId, parcelReference, parcelStatus) {
  if (!parcelId || !parcelStatus) {
    log.warn({ parcel_id: parcelId, parcel_status: parcelStatus }, 'Parcel scan notification skipped: missing params');
    return;
  }

  // Map parcel â†' order status
  const statusMap = {
    in_transit: 'shipped',
    shipped:    'shipped',
    available:  'delivered',
  };

  const orderStatus = statusMap[parcelStatus];
  if (!orderStatus) {
    log.warn({ parcel_status: parcelStatus }, 'Parcel scan notification skipped: unmapped status');
    return;
  }

  // Charger l'order complet pour avoir les tÃ©lÃ©phones payeur + bÃ©nÃ©ficiaire
  const order = await _loadOrderFromParcel(parcelId);
  if (!order) {
    log.warn({ parcel_id: parcelId, parcel_ref: parcelReference }, 'Parcel scan notification skipped: order not found');
    await logNotification({
      parcelRef: parcelReference,
      channel: 'whatsapp',
      event: `parcel_${parcelStatus}`,
      status: 'skipped',
      detail: { reason: 'order_not_found', parcelId },
    });
    return;
  }

  log.info({ parcel_ref: parcelReference, order_ref: order.reference, parcel_status: parcelStatus, order_status: orderStatus }, 'Parcel scan notification dispatched');

  // DÃ©lÃ¨gue : notifyStatusChange gÃ¨re dÃ©jÃ  payeur/bÃ©nÃ©ficiaire + log DB
  return notifyStatusChange(order, orderStatus);
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  7. Envoi OTP via WhatsApp (fallback SMS si Ã©chec)
//  â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
//  UtilisÃ©e par routes/otp.js pour envoyer un code Ã  6 chiffres.
//
//  Signature : sendOtpMessage({ phone, code, name, expiryMin })
//    â†' Promise<{ success, channel, messageId?, reason?, error? }>
//
//  channel = 'whatsapp' | 'sms' | 'none'
//  Cette fonction ne lance JAMAIS d'exception â€" elle retourne toujours
//  un objet avec success:false en cas de problÃ¨me pour ne pas casser le flow.
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
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
    error: 'Impossible d'envoyer l'OTP : texte libre refusé et aucun WID_OTP configuré',
  };
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  8. Notification colis crÃ©Ã© (commande passÃ©e en prÃ©paration)
//  â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
//  AppelÃ©e par order-api-v2.js quand un colis est crÃ©Ã© pour une commande.
//  Envoie une notification "ðŸ"¦ Votre commande a Ã©tÃ© prÃ©parÃ©e".
//
//  Signature : notifyParcelCreated(parcelRef, orderId, orderReference)
//
//  ImplÃ©mentation : rÃ©utilise notifyStatusChange avec statut 'preparation'
//  â†' si aucun template n'est mappÃ© Ã  'preparation' dans notifyStatusChange,
//    l'appel est un no-op silencieux (comportement dÃ©jÃ  gÃ©rÃ©).
//  Log quand mÃªme l'Ã©vÃ©nement pour audit.
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
async function notifyParcelCreated(parcelRef, orderId, orderReference) {
  if (!orderId) {
    log.warn({ parcel_ref: parcelRef, order_ref: orderReference }, 'Parcel created notification skipped: missing orderId');
    return;
  }

  try {
    // Charge l'order complet pour bÃ©nÃ©ficier de pickRecipients
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
       LEFT JOIN users r    ON r.id = o.recipient_id
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

    // DÃ©lÃ¨gue Ã  notifyStatusChange avec 'preparation'.
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
    // il faut crÃ©er un template dÃ©diÃ© 'parcel_created' et l'ajouter au mapping
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

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  9. Envoi magic link via WhatsApp (reconnexion 1-clic)
//  â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
//  UtilisÃ©e par routes/client-auth.js quand un user veut revenir sur
//  son espace "Mes commandes" aprÃ¨s expiration du JWT.
//
//  Signature : sendMagicLink({ phone, name, magicLink, expiryMin })
//    phone      â€" numÃ©ro E.164 du user
//    name       â€" nom d'affichage (pour personnalisation)
//    magicLink  â€" URL complÃ¨te "https://komerce.xyz/mon-compte?token=xxx"
//    expiryMin  â€" durÃ©e de validitÃ© (dÃ©faut 15 minutes)
//
//  â†' Promise<{ success, channel, messageId?, reason?, error? }>
//
//  StratÃ©gie de fallback :
//    1. Template WID_MAGIC_LINK si configurÃ© (recommandÃ© Meta)
//    2. Sinon, tente WID_OTP en rÃ©utilisant la variable (moins propre)
//    3. Sinon, retourne success:false avec reason explicite (pas de crash)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
async function sendMagicLink({ phone, name, magicLink, expiryMin }) {
  if (!phone || !magicLink) {
    return { success: false, channel: 'none', reason: 'missing_params' };
  }

  const customerName = firstName(name);
  const expiry = String(expiryMin || 15);

  // Choisir le WID : magic link dÃ©diÃ© > OTP (fallback) > rien
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
      error: 'Aucun template WhatsApp configurÃ© pour le magic link',
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

// â"€â"€â"€ Notification fidÃ©litÃ© â€" cadeau Ã©ligible â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
/**
 * Notifie un client qu'il est Ã©ligible au cadeau de fidÃ©litÃ©.
 * AppelÃ© par loyalty-service.js quand le seuil de gros paniers est atteint.
 *
 * @param {object} opts - { userId, userName, phone, orderRef, basketCount }
 */
async function notifyLoyaltyEarned({ userId, userName, phone, orderRef, basketCount }) {
  if (!phone) {
    log.warn({ user_id: userId, order_ref: orderRef, basket_count: basketCount }, 'Loyalty notification skipped: no phone');
    return { success: false, reason: 'no_phone' };
  }

  const name = firstName(userName);
  const message = `ðŸŽ‰ Bravo ${name} ! Vous avez atteint ${basketCount} gros paniers chez Komerce ! Un cadeau de fidÃ©litÃ© vous attend. Notre Ã©quipe vous contactera bientÃ´t. Merci de votre confiance ! ðŸ‡°ðŸ‡²`;

  try {
    // Utiliser le WID gÃ©nÃ©rique (pas de template dÃ©diÃ© pour l'instant)
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
  // Fonctions historiques (flux commande)
  notifyOrderCreated,
  notifyPaymentConfirmed,
  notifyStatusChange,
  notifyCancellation,

  // Nouvelles fonctions (flux colis + OTP)
  notifyParcelCreated,
  notifyParcelScan,
  sendOtpMessage,
  sendMagicLink,

  // ZG-1 — texte libre (remplace sendSMS legacy)
  notifyText,

  // Fidélité
  notifyLoyaltyEarned,

  // Helper interne exposé pour tests
  _loadOrderFromParcel,
};


