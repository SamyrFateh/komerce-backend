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
  type:     'transversal',
  domain:   'auth',
  status:   'production',
  owner:    'backend-core',
  since:    '2025-08',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  classification: {
    "axis": "support",
    "kind": "technical-transversal",
    "decision": "transversal-technique",
    "signals": {
      "ownsTables": false,
      "ownsLifecycle": false,
      "activeService": true,
      "multiConsumer": true,
      "ownsMigrations": false,
      "externalSideEffect": "none",
      "surface": "middleware+session"
    },
    "rationale": [
      "porte les gardes JWT, rôle, révocation et politique de session consommées transversalement, sans décider aucun cycle métier des consommateurs",
      "reste un transversal technique conformément à la doctrine O2 ; le DDL technique de révocation appartient à infrastructure, tandis que les mutations d identité et credentials restent à auth-identity/auth-passkey"
    ]
  },

  // ── Service rendu ────────────────────────────────────────────────────────
  service: 'Fournir les gardes transverses d\'authentification et de vérification d\'identité ' +
           '(middlewares JWT/session/rôles) consommées par toutes les autres features.',

  // ── Perimetre ────────────────────────────────────────────────────────────
  perimeter: {
    in: [
      'middlewares de garde transverses : authentification JWT/session, vérification de rôle, ' +
        'identité vérifiée, révocation de token, émission et durée canonique de session',
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
      'utils/auth-cookie.js',
      'utils/auth-session.js',
      'utils/auth-session-policy.js',
      'utils/auth-token-policy.js',
    ],
    services: [],
    routes: [],
    migrations: [
    ],
    boutique: [],
    tests: [
      'tests/unit/auth-cookie.test.js',
      'tests/unit/auth-session.test.js',
      'tests/unit/auth-session-policy.test.js',
      'tests/unit/auth-token-policy.test.js',
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

  db: {
    tables: [
      'revoked_tokens: R',
      'users: R',
    ],
  },

  security: {
    status: 'CONFIRMED_TRANSVERSAL',
    authedRoutesDetected: 0,
    totalRoutes: 0,
    note: "Feature transversale : aucune route HTTP exposée directement. Les middlewares authenticate, requireRole, requireAdmin sont la couche de garde de toutes les autres features. Sécurité de la feature elle-même : JWT_SECRET en env, tokens révoqués en DB (revoked_tokens), rate-limit via authLimiter, session absolue plafonnée à 7 jours.",
  },
  contract: {
    exposes: [],
    internalApi: [
      { fn: 'requireAuth / requireVerifiedIdentity / softAuth', file: 'middleware/auth.js, middleware/require-verified-identity.js, middleware/soft-auth.js' },
      { fn: 'signAuthToken / resolveSessionTtlSeconds / sessionClaimsVerdict', file: 'utils/auth-session.js, utils/auth-session-policy.js, utils/auth-token-policy.js' },
    ],
    consumes: [
      'auth-identity',
      'infrastructure',
      'notifications',
    ],
  },

  authority: 'backend-core — tout changement de middleware d\'authentification ou de politique de session doit etre valide par le proprietaire de auth',

  invariants: [
    'toute route mutante passe par un middleware d\'auth declare — jamais d\'acces direct sans garde',
    'toute mutation portée par le cookie de session exige une Origin explicitement autorisée (AUTH-8b)',
    'staging/production utilisent exclusivement un cookie de session __Host- Secure, Path=/ et sans Domain (AUTH-8c)',
    'la durée absolue JWT + cookie est plafonnée à 7 jours et chaque preuve OTP/passkey/step-up émet une nouvelle jti (AUTH-8d)',
    'un JWT scoped ou dépourvu des claims de session canoniques ne peut jamais être élevé en session par les middlewares génériques (AUTH-8e)',
  ],

};
