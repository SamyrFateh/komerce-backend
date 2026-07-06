/**
 * @feature       auth
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
  name:     'auth',
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
      'logique metier propre a chaque feature consommatrice — auth ne sait rien des commandes, paniers ou paiements',
    ],
  },

  // ── Perimetre fichiers ───────────────────────────────────────────────────
  files: {
    middleware: [
      'middleware/auth.js',
      'middleware/auth-guest.js',
      'middleware/soft-auth.js',
      'middleware/require-verified-identity.js',
      'middleware/verify-authkey-webhook.js',
      'utils/user-cache.js',
    ],
    services: [
    ],
    routes: [
    ],
    migrations: [
      'migrations/072_jwt_revocation.sql',
      'migrations/084_jwt_revocation.sql',
    ],
    boutique: [
      // Backfill gouvernance globale : header @komerce-arch domain=auth confirmé
      // dans docs/BOUTIQUE_360.json pour les 3 fichiers.
    ],
      tests: [
      'tests/unit/auth-guest.test.js',
      'tests/unit/auth-middleware.test.js',
      'tests/unit/auth-route.test.js',
      'tests/unit/client-auth.test.js',
      'tests/unit/otp-route.test.js',
      'tests/unit/require-verified-identity.test.js',
      'tests/unit/user-cache.test.js',
      'tests/unit/verify-authkey-webhook.test.js',
    ],
  },

  // ── Contrat d'interface ──────────────────────────────────────────────────
  docs: [
    'docs/chantier/ADMIN_AUTH_AUDIT_D1.md',
    'docs/chantier/AUTH_GUEST_AUDIT_D3.md',
    'docs/doctrine/DOCTRINE_IDENTITE_LEGERE_KOMERCE.md',
  ],

  contract: {
    exposes: [
      'middleware requireAuth / requireVerifiedIdentity / softAuth',
      'POST /api/auth/otp',
    ],
    consumes: [
      'notification',
      'operations',
      'orders',
    ],
  },

  // ── Autorite ─────────────────────────────────────────────────────────────
  authority: 'backend-core — tout changement de middleware d\'authentification doit etre valide par le proprietaire de middleware/auth.js',

  // ── Invariants propres ───────────────────────────────────────────────────
  invariants: [
    'toute route mutante passe par un middleware d\'auth declare — jamais d\'acces direct sans garde',
  ],

};
