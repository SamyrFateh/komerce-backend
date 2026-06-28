/**
 * @komerce-arch
 * @role          customer-notification-orchestrator
 * @domain        notification
 * @layer         service
 * @criticality   high
 * @inputs        phone, template_context, notification_event
 * @outputs       whatsapp_message, sms_fallback, delivery_log
 * @depends       services/notifications/notification-service.js
 * @used-by       otp.js, payment-stripe.js, order-status-machine.js, shared-cart-engine.js
 * @db-read       orders, parcels, recipients, relais, users
 * @db-write      alerts, notification_log
 * @db-txn        notification_non_blocking
 * @doctrine      notification_non_bloquante
 * @impact-areas  otp, checkout, shared-cart, orders, customer-support
 * @version       2026-06
 */
'use strict';
/**
 * services/notification-service.js — barrel (Lot C2 — 2026-06-28)
 *
 * Le monolithe original (963L) a été découpé en services/notifications/.
 * Ce fichier redirige tous les appelants existants sans changement d'interface.
 *
 * @see services/notifications/notification-service.js
 * @see services/notifications/order.js
 * @see services/notifications/parcel.js
 * @see services/notifications/otp-auth.js
 * @see services/notifications/loyalty.js
 * @see services/notifications/misc.js
 */

module.exports = require('./notifications/notification-service');
