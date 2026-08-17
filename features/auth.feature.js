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
  // Corrigé au Lot O2 (2026-07-12) — était un copié-collé du texte d'auth-identity.
  service: 'Fournir les gardes transverses d\'authentification et de vérification d\'identité ' +
           '(middlewares JWT/session/rôles) consommées par toutes les autres features.',

  // ── Perimetre ────────────────────────────────────────────────────────────
  perimeter: {
    in: [
      'middlewares de garde transverses : authentification JWT/session, vérification de rôle, ' +
        'identité vérifiée, révocation de token',
    ],
    out: [
      'logique metier propre a chaque feature consommatrice — auth ne sait rien des commandes, paniers ou paiements',
    ],
  },

  // ── Perimetre fichiers ───────────────────────────────────────────────────
  files: {
    middleware: [
      'middleware/auth.js',
      'middleware/csrf-origin.js',
      'middleware/auth-guest.js',
      'middleware/soft-auth.js',
      'middleware/require-verified-identity.js',
      'middleware/verify-authkey-webhook.js',
      'utils/user-cache.js',
    ],
    utils: [
      // AUTH-8a — source unique de vérité du cookie/session JWT Komerce.
      'utils/auth-cookie.js',
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
      'tests/unit/csrf-origin.test.js',
      'tests/unit/auth-route.test.js',
      'tests/unit/otp-route.test.js',
      'tests/unit/require-verified-identity.test.js',
      'tests/unit/soft-auth.test.js',
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
      'revoked_tokens: R',
      'users: RW',
    ],
  },

  security: {
    status: 'CONFIRMED_TRANSVERSAL',
    authedRoutesDetected: 0,
    totalRoutes: 0,
    note: "Feature transversale : aucune route HTTP exposée directement. Les middlewares authenticate, requireRole, requireAdmin sont la couche de garde de toutes les autres features. Sécurité de la feature elle-même : JWT_SECRET en env, tokens révoqués en DB (revoked_tokens), rate-limit via authLimiter.",
  },
  contract: {
    // (audit 2026-07-06, §2c — corrigé) : ce manifeste ne possède aucun
    // fichier routes/ (files.routes = []) — c'est un transversal middleware
    // pur. "POST /api/auth/otp" ne lui appartient pas : la route réelle vit
    // dans routes/otp.js, possédé par la feature auth-identity, qui la
    // déclare déjà correctement dans son propre contract.exposes.
    exposes: [],
    internalApi: [
      { fn: 'requireAuth / requireVerifiedIdentity / softAuth', file: 'middleware/auth.js, middleware/require-verified-identity.js, middleware/soft-auth.js' },
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
    'toute mutation portée par le cookie de session exige une Origin explicitement autorisée (AUTH-8b)',
  ],

};
