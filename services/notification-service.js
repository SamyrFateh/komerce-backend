/**
 * @komerce-arch
 * @role          customer-notification-orchestrator
 * @domain        notification
 * @layer         service
 * @criticality   high
 * @inputs        phone, template_context, notification_event, channel_preferences
 * @outputs       whatsapp_message, sms_fallback, email_fallback, delivery_log
 * @depends       services/whatsapp-meta.js, providers/authkey, email-provider
 * @used-by       otp.js, payment-stripe.js, order-status-machine.js, shared-cart-engine.js, reminders
 * @db-read       notification_templates, users, orders, shared_carts
 * @db-write      notification_logs
 * @db-txn        notification_non_blocking, failure_logged_not_rolled_back
 * @doctrine      notification_non_bloquante, otp_message_lisible, fallback_trace
 * @impact-areas  otp, checkout, shared-cart, orders, customer-support, whatsapp
 * @version       2026-06
 */

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

// WID dédié OTP — à configurer dans Railway env : WID_OTP=xxxxx

// D4 FIX — Helper alerte sur échec notification critique
// Fire-and-forget : ne crashe jamais l'appelant.
function _alertNotificationFailure({ event, orderRef, orderId, error }) {
  db.query(
    `INSERT INTO alerts (level, source, message, payload)
     VALUES ('elevated', 'notification_service', $1, $2)`,
    [
      `Notification '${event}' échouée — commande ${orderRef || orderId || '?'}`,
      JSON.stringify({ event, orderRef, orderId, error: String(error) }),
    ]
  ).catch(e => log.error({ err: e }, 'Failed to insert notification alert'));
}

// Si non configuré, l'OTP passera par un canal de fallback (SMS, etc. selon config)
const WID_OTP = process.env.WID_OTP || null;

// WID dédié magic link — template texte qui contient un lien cliquable
// À configurer dans Railway : WID_MAGIC_LINK=xxxxx
// Fallback : si non configuré, réutilise WID_OTP (moins idéal mais fonctionne)
const WID_MAGIC_LINK = process.env.WID_MAGIC_LINK || null;

// ─── Logger interne ────────────────────────────────────────────────────
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
      // Table pas encore créée — on ignore
      log.warn({ table: 'notification_log' }, 'Notification log table missing, log skipped');
    } else {
      log.error({ err }, 'Notification log write failed');
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
  // [LEGACY] Priorité : tracking_phone > recipient_phone > phone_payer > user_phone > fallback
  // Conservée pour rétro-compat. Les nouvelles fonctions utilisent pickRecipients().
  return order.tracking_phone
      || order.recipient_phone        // via JOIN recipients r ON r.id = o.recipient_id
      || order.phone_payer            // via JOIN users u ON u.id = o.user_id
      || order.user_phone
      || (Array.isArray(fallback) ? fallback[0] : fallback)
      || null;
}

/**
 * Retourne la liste des téléphones qui doivent recevoir la notif selon l'événement.
 * 
 * Stratégie Komerce (payeur diaspora â‰  bénéficiaire Comores) :
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
  // payeur : tracking_phone (prioritaire) > phone_payer (migration 040) > user_phone
  // bénéficiaire : recipient_phone (via JOIN recipients r) > phone_beneficiary > user_phone si pas de recipient distinct
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

// ═══════════════════════════════════════════════════════════════════════
//  5. Helper : charge l'order complet à partir d'un parcelId
//  ─────────────────────────────────────────────────────────────────────
//  Permet de réutiliser notifyStatusChange (qui attend un order complet)
//  depuis les appelants qui n'ont qu'un parcelId (scan-engine, parcel-api,
//  transitaire-api) — sans dupliquer la logique payeur/bénéficiaire.
// ═══════════════════════════════════════════════════════════════════════
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
       LEFT JOIN recipients r ON r.id = o.recipient_id
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

// ═══════════════════════════════════════════════════════════════════════
//  6. Notification de scan colis — façade vers notifyStatusChange
//  ─────────────────────────────────────────────────────────────────────
//  Appelée par scan-engine.js, parcel-api-v2.js, transitaire-api.js
//  quand un colis change de statut.
//
//  Signature : notifyParcelScan(parcelId, parcelReference, parcelStatus)
//    parcelId        — ID UUID du colis
//    parcelReference — Référence humaine (ex: "CLK-2026-0123")
//    parcelStatus    — 'in_transit' | 'shipped' | 'available'
//
//  Mapping parcel status → order status (pour réutiliser notifyStatusChange) :
//    in_transit / shipped → 'shipped'    (colis en route vers relais)
//    available            → 'delivered'  (colis prêt au relais à récupérer)
//
//  Délègue à notifyStatusChange qui gère payeur + bénéficiaire via pickRecipients.
// ═══════════════════════════════════════════════════════════════════════
async function notifyParcelScan(parcelId, parcelReference, parcelStatus) {
  if (!parcelId || !parcelStatus) {
    log.warn({ parcel_id: parcelId, parcel_status: parcelStatus }, 'Parcel scan notification skipped: missing params');
    return;
  }

  // Map parcel → order status
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

  // Charger l'order complet pour avoir les téléphones payeur + bénéficiaire
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

  // Délègue : notifyStatusChange gère déjà payeur/bénéficiaire + log DB
  return notifyStatusChange(order, orderStatus);
}

// ═══════════════════════════════════════════════════════════════════════
//  7. Envoi OTP via WhatsApp (fallback SMS si échec)
//  ─────────────────────────────────────────────────────────────────────
//  Utilisée par routes/otp.js pour envoyer un code à 6 chiffres.
//
//  Signature : sendOtpMessage({ phone, code, name, expiryMin })
//    → Promise<{ success, channel, messageId?, reason?, error? }>
//
//  channel = 'whatsapp' | 'sms' | 'none'
//  Cette fonction ne lance JAMAIS d'exception — elle retourne toujours
//  un objet avec success:false en cas de problème pour ne pas casser le flow.
// ═══════════════════════════════════════════════════════════════════════
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

// ─── Notification fidélité — cadeau éligible ───────────────────────────────────
/**
 * Notifie un client qu'il est éligible au cadeau de fidélité.
 * Appelé par loyalty-service.js quand le seuil de gros paniers est atteint.
 *
 * @param {object} opts - { userId, userName, phone, orderRef, basketCount }
 */
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


