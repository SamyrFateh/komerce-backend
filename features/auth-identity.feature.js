/**
 * @feature       auth-identity
 * @type          transversal
 * @domain        auth
 * @status        production
 * @owner         backend-core
 * @since         2025-08
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 * @registry      docs/doctrine/APP_FEATURE_REGISTRY.md
 */
'use strict';

module.exports = {

  // ── Identite ─────────────────────────────────────────────────────────────
  name:     'auth-identity',
  type:     'transversal',   // feature | transversal
  domain:   'auth',
  status:   'production',   // draft | staging | production | deprecated
  owner:    'backend-core',
  since:    '2025-08',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  // ── Service rendu ────────────────────────────────────────────────────────
  service: 'Authentifier un utilisateur (OTP, session, identite verifiee) pour toutes les autres features.',

  // ── Perimetre ────────────────────────────────────────────────────────────
  perimeter: {
    in: [
      'OTP, authentification client, verification d\'identite, middlewares de garde transverses',
    ],
    out: [
      'logique metier propre a chaque feature consommatrice — auth-identity ne sait rien des commandes, paniers ou paiements',
    ],
  },

  // ── Perimetre fichiers ───────────────────────────────────────────────────
  files: {
    services: [
      'services/otp-test-mode.js',
      'services/authkey-client.js',
    ],
    routes: [
      'routes/client-auth.js',
      'routes/auth.js',
      'routes/otp.js',
    ],
    boutique: [
      // Backfill gouvernance globale : header @komerce-arch domain=auth confirmé
      // dans docs/BOUTIQUE_360.json pour les 3 fichiers.
      'js/b-identity.js',
      'js/b-phone.js',
      'css/identity.css',
    ],
      tests: [
      'tests/integration/admin-authz-probe.test.js',
      'tests/integration/otp-no-guest.test.js',
      'tests/unit/authkey-client.test.js',
      'tests/unit/otp-test-mode.test.js',
      'tests/unit/soft-auth.test.js',
    ],
  },

  // ── Contrat d'interface ──────────────────────────────────────────────────
  docs: [],

  contract: {
    exposes: [
      'POST /api/auth/otp/request',
      'POST /api/auth/otp/verify',
      'POST /api/auth/otp/test-reset',
      // Rapatriées depuis le route-registry (audit 2026-07-06, lot interface-inverse)
      // — routes réelles câblées via bootstrap/api-routes.js, jamais déclarées jusqu'ici.
      'POST /api/auth/admin-reset',
      'POST /api/auth/auto-register',
      'POST /api/auth/guest-checkout',
      'GET /api/auth/invoices',
      'POST /api/auth/login',
      'POST /api/auth/logout',
      'POST /api/auth/magic-link',
      'GET /api/auth/magic-link/validate',
      'GET /api/auth/me',
      'PUT /api/auth/me',
      'GET /api/auth/orders',
      'POST /api/auth/orders-by-phone',
      'POST /api/auth/register',
      'GET /api/client/invoices',
      'POST /api/client/magic-link',
      'GET /api/client/magic-link/validate',
      'GET /api/client/orders',
    ],
    consumes: [],
  },

  // ── Dette assumée / documentée ────────────────────────────────────────────
  // (audit 2026-07-06, §2c — vérifié empiriquement contre routes/otp.js)
  debt: {
    knownGaps: [
      { gap: 'ancien contrat déclaré "POST /api/auth/otp" (sans sous-chemin) : aucune ' +
             'route ne sert ce chemin exact. Les 3 vraies routes sont sous-chemins de ' +
             'routes/otp.js : /request, /verify, /test-reset. "test-reset" est gardé par ' +
             'isOtpTestMode() (doctrine test_mode_never_prod) — routé en toute condition ' +
             'mais un no-op hors mode test, donc listé ici comme réel plutôt que dans ' +
             'plannedInterfaces.',
        risk: 'aucun — le contrat déclaré était simplement désynchronisé du découpage réel ' +
              'en sous-routes.',
      },
    ],
  },

  // ── Autorite ─────────────────────────────────────────────────────────────
  authority: 'backend-core — tout changement de middleware d\'authentification doit etre valide par le proprietaire de middleware/auth.js',

  // ── Invariants propres ───────────────────────────────────────────────────
  invariants: [
    'toute route mutante passe par un middleware d\'auth declare — jamais d\'acces direct sans garde',
    'les routes de ce manifeste s\'appuient sur authenticate (middleware/auth.js, feature auth) — pas de garde ad-hoc',
  ],

};
