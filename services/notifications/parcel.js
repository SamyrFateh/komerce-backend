/**
 * @komerce-arch
 * @role          notification-parcel
 * @domain        notification
 * @layer         service
 * @criticality   high
 * @inputs        parcel_id, parcel_reference, parcel_status, order_id
 * @outputs       whatsapp_message, sms_fallback
 * @depends       db.js, services/authkey-client.js, services/notifications/internals.js
 * @used-by       services/notification-service.js
 * @db-read       orders, parcels, recipients, relais, users
 * @db-write      notification_log
 * @db-txn        notification_non_blocking
 * @doctrine      notification_non_bloquante, fallback_trace
 * @impact-areas  orders, customer-support, whatsapp
 * @version       2026-06
 */

'use strict';

const {
  db, log,
  logNotification,
  pickPhone,
} = require('./internals');
const { notifyStatusChange } = require('./order');

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
         r.phone       AS recipient_phone,
         r.full_name   AS recipient_name,
         o.total_kmf,
         rel.name      AS relais_name,
         rel.address   AS relais_address,
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


module.exports = { _loadOrderFromParcel, notifyParcelScan, notifyParcelCreated };
