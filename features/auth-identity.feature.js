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
  },

  // ── Contrat d'interface ──────────────────────────────────────────────────
  contract: {
    exposes: [
      'middleware requireAuth / requireVerifiedIdentity / softAuth',
      'POST /api/auth/otp',
    ],
    consumes: [],
  },

  // ── Autorite ─────────────────────────────────────────────────────────────
  authority: 'backend-core — tout changement de middleware d\'authentification doit etre valide par le proprietaire de middleware/auth.js',

  // ── Invariants propres ───────────────────────────────────────────────────
  invariants: [
    'toute route mutante passe par un middleware d\'auth declare — jamais d\'acces direct sans garde',
  ],

};
