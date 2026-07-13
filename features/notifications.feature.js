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
      // tests/unit/authkey-client.test.js rehomé depuis auth-identity (O7.1)
      'tests/unit/authkey-client.test.js',
      'tests/notifications/notification-service-internals.test.js',
      'tests/notifications/notification-service-order-parcel-otp-auth-loyalty-misc.test.js',
      'tests/notifications/whatsapp-meta-alert-engine.test.js',
      'tests/notifications/notification-api-meta-whatsapp-alerts.test.js',
      // Rapatriés depuis features/notification.feature.js (doublon singulier
      // supprimé, audit 2026-07-06 §2d) — vérifié empiriquement, ces fichiers
      // testent bien des modules déjà possédés ci-dessus (notifications/*,
      // whatsapp-meta.js, email.js), pas les 6 tests orders-*-route qui
      // étaient mal rangés dans ce même manifeste (rapatriés vers orders).
      'tests/notifications/notification-api-meta-whatsapp-alerts-branches.test.js',
      'tests/unit/email.test.js',
      'tests/unit/notification-internals.test.js',
      'tests/unit/notification-misc.test.js',
      'tests/unit/notification-otp-auth.test.js',
      'tests/unit/notification-service-barrel.test.js',
      'tests/unit/notification-service.test.js',
      'tests/unit/notification-whatsapp-meta.test.js',
      'tests/unit/order-notification.test.js',
      'tests/unit/parcel-notification.test.js',
    ],
    migrations: [
      'migrations/022b_sms_queue.sql',
      'migrations/023b_whatsapp_phone.sql',
      'migrations/024_notification_log.sql',
      'migrations/058_notification_log_recipient_nullable.sql',
      'migrations/089_notification_log_ref_widening.sql',
    ],
    utils: [
      'utils/email.js',
    ],
    services: [
      'services/whatsapp-meta.js',
      // services/authkey-client.js rehomé depuis auth-identity (O7.1,
      // REHOME_CONSUMER, docs/O7_1_OWNERSHIP_ANALYSIS.md CAS A) — adaptateur
      // externe WhatsApp du fournisseur authkey.io, 100% consommé par
      // services/notifications/*, aucune logique d'authentification.
      'services/authkey-client.js',
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
  docs: [
    'docs/D1_CARTOGRAPHIE_PROVIDER_NOTIFICATIONS.md',
    'docs/audit/PROMPT_SONNET_NOTIFICATIONS_PROVIDER_KOMERCE.md',
    'docs/chantier/F1B_NOTIFICATION_LOGGER_CODEMOD.md',
  ],

  // ── Tables DB (inféré, audit 2026-07-06, §axe2) ─────────────────────────
  // Généré par parsing réel des appels .query() (pas un grep de mots) :
  // R = lu par cette feature, W = écrit par cette feature, RW = les deux.
  // Une table listée ici pour PLUSIEURS features est une vraie propriété
  // partagée détectée dans le code, pas un artefact de méthode — à
  // documenter explicitement si volontaire, ou à re-scoper sinon.
  // Champ auto-généré : à corriger à la main si une requête dynamique
  // (nom de table construit par variable) a échappé au scan.
  db: {
    tables: [
      'alerts: W',
      'incidents: RW',
      'notification_log: RW',
      'orders: R',
      'parcels: R',
      'recipients: R',
      'relais: R',
      'scan_events: R',
      'users: R',
    ],
  },

  security: {
    status: 'CONFIRMED_WEBHOOK_SIGNED',
    authedRoutesDetected: 2,
    totalRoutes: 4,
    note: "2/4 routes internes protégées. 2 routes webhook WhatsApp (GET + POST /webhook/meta-whatsapp) : protégées par signature HMAC-SHA256 (META_WA_APP_SECRET) + verify token — pas de middleware Express authenticate, d'où UNKNOWN dans le scanner statique. Protection applicative confirmée dans routes/meta-whatsapp.js.",
  },
  contract: {
    exposes: [
      'GET /api/v2/notifications',
      'GET /api/v2/notifications/stats',
      // Rapatriées depuis le route-registry (audit 2026-07-06, lot interface-inverse)
      // — routes réelles câblées via bootstrap/api-routes.js, jamais déclarées jusqu'ici.
      'GET /webhook/meta-whatsapp',
      'POST /webhook/meta-whatsapp',
    ],
    internalApi: [
      { fn: 'notifyOrder*',   file: 'services/notifications/order.js' },
      { fn: 'notifyParcel*',  file: 'services/notifications/parcel.js' },
      { fn: 'sendOtpMessage / sendMagicLink', file: 'services/notifications/otp-auth.js' },
      { fn: 'notifyLoyaltyEarned', file: 'services/notifications/loyalty.js' },
      { fn: 'notifyText',    file: 'services/notifications/misc.js' },
    ],
    consumes: [
      'toutes les features emettrices (orders, payments, shared-cart, refunds...) en entree evenementielle uniquement',
    ],
  },

  // ── Dette assumée / documentée ────────────────────────────────────────────
  // (audit 2026-07-06, §2a — reclassé après vérification empirique)
  debt: {
    knownGaps: [
      { gap: 'contrat historique "POST /api/notifications/send" : aucune route ne le sert. ' +
             'L\'émission se fait exclusivement par appel de fonction interne ' +
             '(notifyOrder*, notifyParcel*, ...), jamais par HTTP — ce qui est cohérent ' +
             'avec l\'invariant déjà déclaré ("notifications est un puits d\'événements — ' +
             'elle ne décide jamais elle-même qu\'un evenement metier a eu lieu"). ' +
             'La seule surface HTTP réelle est la lecture admin (GET / et GET /stats, ' +
             'montées sous /api/v2/notifications).',
        risk: 'aucun — le contrat déclaré contredisait l\'invariant de la feature elle-même ; ' +
              'ce n\'est pas une régression mais une intention jamais cohérente avec la ' +
              'doctrine fire-and-forget déjà en place.',
      },
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
