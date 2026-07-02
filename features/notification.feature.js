/**
 * @feature       notification
 * @type          feature
 * @domain        notification
 * @status        production
 * @owner         backend-core
 * @since         2025-09
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 * @registry      docs/doctrine/APP_FEATURE_REGISTRY.md
 */
'use strict';

module.exports = {

  // ── Identite ─────────────────────────────────────────────────────────────
  name:     'notification',
  type:     'feature',   // feature | transversal
  domain:   'notification',
  status:   'production',   // draft | staging | production | deprecated
  owner:    'backend-core',
  since:    '2025-09',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  // ── Service rendu ────────────────────────────────────────────────────────
  service: 'Emettre une alerte ou un message sortant (WhatsApp, notification interne) declenche par une autre feature.',

  // ── Perimetre ───────────────────────────────────────────────────────────
  perimeter: {
    in: [
      'envoi WhatsApp via Meta',
      'moteur d\'alertes internes',
      'routes d\'emission de notification',
    ],
    out: [
      'decision de declencher une notification (reste a la feature emettrice : orders, payments, etc.)',
      'tests/unit/notification-service.test.js',
    ],
  },

  // ── Perimetre fichiers ───────────────────────────────────────────────────
  files: {
    tests: [
      'tests/notifications/notification-api-meta-whatsapp-alerts-branches.test.js',
      'tests/unit/email.test.js',
      'tests/unit/notification-internals.test.js',
      'tests/unit/notification-misc.test.js',
      'tests/unit/notification-otp-auth.test.js',
      'tests/unit/notification-service-barrel.test.js',
      'tests/unit/notification-service.test.js',
      'tests/unit/notification-whatsapp-meta.test.js',
      'tests/unit/order-notification.test.js',
      'tests/unit/orders-aggregator-route.test.js',
      'tests/unit/orders-cancel-route.test.js',
      'tests/unit/orders-create-route.test.js',
      'tests/unit/orders-detail.test.js',
      'tests/unit/orders-list.test.js',
      'tests/unit/orders-status-route.test.js',
      'tests/unit/parcel-notification.test.js',
      'core/test-whatsapp-notifications.js',
      'tests/notifications/notification-service-internals.test.js',
      'tests/notifications/notification-service-order-parcel-otp-auth-loyalty-misc.test.js',
      'tests/notifications/whatsapp-meta-alert-engine.test.js',
      'tests/notifications/notification-api-meta-whatsapp-alerts.test.js',
    ],
    utils: [
      'utils/email.js',
    ],
    services: [
      'services/whatsapp-meta.js',
      'services/notification-service.js',        // barrel historique
      'services/notifications/notification-service.js', // barrel interne — Lot C2 2026-06-28
      'services/notifications/internals.js',     // helpers partagés, logNotification
      'services/notifications/order.js',         // notifyOrder*
      'services/notifications/parcel.js',        // notifyParcel*, _loadOrderFromParcel
      'services/notifications/otp-auth.js',      // sendOtpMessage, sendMagicLink
      'services/notifications/loyalty.js',       // notifyLoyaltyEarned
      'services/notifications/misc.js',          // notifyText
      'services/alert-engine.js',
    ],
    routes: [
      'routes/notification-api.js',
      'routes/meta-whatsapp.js',
      'routes/alerts.js',
    ],
    migrations: [
      'migrations/022b_sms_queue.sql',
      'migrations/023b_whatsapp_phone.sql',
      'migrations/024_notification_log.sql',
      'migrations/058_notification_log_recipient_nullable.sql',
      'migrations/089_notification_log_ref_widening.sql',
    ],
  },

  // ── Contrat d'interface ──────────────────────────────────────────────────
  contract: {
    exposes: [
      'POST /api/notification/send',
    ],
    consumes: ['toutes les features emettrices (orders, payments, shared-cart, refunds...) en entree evenementielle uniquement',
      'auth',
      'recommendations',
    ],
  },

  // ── Autorite ─────────────────────────────────────────────────────────────
  authority: 'backend-core — tout changement de template ou de canal doit etre valide par le proprietaire de notification-service.js',

  // ── Invariants propres ───────────────────────────────────────────────────
  invariants: [
    'notification est un puits d\'evenements — elle ne decide jamais elle-meme qu\'un evenement metier a eu lieu',
    'livraison outbound best-effort — l\'echec d\'envoi WhatsApp ne doit jamais bloquer la transaction emettrice (fire-and-forget)',
  ],

  // ── Classification ────────────────────────────────────────────────────────
  classification: {
    kind:     'business-transversal',
    decision: 'feature-transverse',
    signals: {
      ownsTables:          true,  // notification_log, sms_log
      ownsLifecycle:       false, // pas de machine de statut propre — reçoit un événement, émet, log
      activeService:       true,  // émet activement vers Meta WhatsApp / canaux externes
      multiConsumer:       true,  // consommée par orders, payments, shared-cart, refunds, auth
      ownsMigrations:      false,
      externalSideEffect:  'outbound-message', // WhatsApp Meta API, SMS
      surface:             'service',
    },
    rationale: [
      'consommée symétriquement par toutes les features émettrices — pas rattachable à une seule',
      'effet externe critique : appel WhatsApp Meta API — canal outbound',
      'ne décide jamais elle-même l\'événement métier (invariant documenté)',
      'pas de machine de statut propre — transverse par nature',
    ],
  },

};
