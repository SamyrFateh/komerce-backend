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
 * @db-read       orders, parcels, recipients, relais, users
 * @db-write      alerts, notification_log
 * @db-txn        notification_non_blocking, failure_logged_not_rolled_back
 * @doctrine      notification_non_bloquante, otp_message_lisible, fallback_trace
 * @impact-areas  otp, checkout, shared-cart, orders, customer-support, whatsapp
 * @version       2026-06
 */

/**
 * KOMERCE — services/notifications/notification-service.js
 * ═══════════════════════════════════════════════════════════════════════
 * Barrel de ré-export — API publique inchangée.
 *
 * Découpage interne (Lot C2 — 2026-06-28) :
 *   services/notifications/internals.js  helpers partagés, logNotification, _alertNotificationFailure
 *   services/notifications/order.js      notifyOrderCreated/PaymentConfirmed/StatusChange/Cancellation
 *   services/notifications/parcel.js     notifyParcelScan, notifyParcelCreated, _loadOrderFromParcel
 *   services/notifications/otp-auth.js   sendOtpMessage, sendMagicLink
 *   services/notifications/loyalty.js    notifyLoyaltyEarned
 *   services/notifications/misc.js       notifyText, notifyInvoiceReady
 *
 * Zéro changement d'interface — tous les appelants continuent de
 * require('./notification-service') ou require('../services/notification-service').
 * ═══════════════════════════════════════════════════════════════════════
 */

'use strict';

const { notifyOrderCreated, notifyPaymentConfirmed, notifyStatusChange, notifyCancellation } = require('./order');
const { _loadOrderFromParcel, notifyParcelScan, notifyParcelCreated } = require('./parcel');
const { sendOtpMessage, sendMagicLink } = require('./otp-auth');
const { notifyLoyaltyEarned } = require('./loyalty');
const { notifyText, notifyInvoiceReady } = require('./misc');

module.exports = {
  // Flux commande
  notifyOrderCreated,
  notifyPaymentConfirmed,
  notifyStatusChange,
  notifyCancellation,

  // Flux colis
  notifyParcelCreated,
  notifyParcelScan,

  // OTP / auth
  sendOtpMessage,
  sendMagicLink,

  // ZG-1 — texte libre
  notifyText,

  // POST-O8 (INVOICE_AUTHKEY_WID) — transport dédié facture (WID template si configuré)
  notifyInvoiceReady,

  // Fidélité
  notifyLoyaltyEarned,

  // Helper interne exposé pour tests
  _loadOrderFromParcel,
};
