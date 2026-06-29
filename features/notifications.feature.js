/**
 * @feature       notifications
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
  name:     'notifications',
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
  },

  // ── Contrat d'interface ──────────────────────────────────────────────────
  contract: {
    exposes: [
      'POST /api/notifications/send',
    ],
    consumes: [
      'toutes les features emettrices (orders, payments, shared-cart, refunds...) en entree evenementielle uniquement',
    ],
  },

  // ── Autorite ─────────────────────────────────────────────────────────────
  authority: 'backend-core — tout changement de template ou de canal doit etre valide par le proprietaire de notification-service.js',

  // ── Invariants propres ───────────────────────────────────────────────────
  invariants: [
    'notifications est un puits d\'evenements — elle ne decide jamais elle-meme qu\'un evenement metier a eu lieu',
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
      multiConsumer:       true,  // consommée par orders, payments, shared-cart, refunds, auth-identity
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
