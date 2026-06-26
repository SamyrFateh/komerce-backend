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

  // ── Perimetre ────────────────────────────────────────────────────────────
  perimeter: {
    in: [
      'envoi WhatsApp via Meta',
      'moteur d\'alertes internes',
      'routes d\'emission de notification',
    ],
    out: [
      'decision de declencher une notification (reste a la feature emettrice : orders, payments, etc.)',
    ],
  },

  // ── Perimetre fichiers ───────────────────────────────────────────────────
  files: {
    tests: [
      'core/test-whatsapp-notifications.js',
    ],
    utils: [
      'utils/email.js',
    ],
    services: [
      'services/whatsapp-meta.js',
      'services/notification-service.js',
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
  ],

};
