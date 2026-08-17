/**
 * @feature       auth-passkey
 * @type          transversal
 * @domain        auth-passkey
 * @status        staging
 * @owner         backend-core
 * @since         2026-08
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 * @registry      docs/doctrine/APP_FEATURE_REGISTRY.md
 */
'use strict';

module.exports = {

  // ── Identite ─────────────────────────────────────────────────────────────
  name:     'auth-passkey',
  nature:   'feature',
  type:     'transversal',
  domain:   'auth-passkey',
  status:   'staging',   // passe à production après AUTH-3/4 (adoption UI + login nominal)
  owner:    'backend-core',

  // ── Classification d'ontologie ────────────────────────────────────────────
  classification: {
    axis:     'business',
    kind:     'business-feature',
    rationale: [
      'Propriétaire exclusif de `webauthn_credentials` et `webauthn_challenges` (AUTH-2, ' +
        '2026-08). Créée pour éviter un WRITER-NOT-OWNER sur auth-identity : cycle de vie ' +
        'propre (enregistrement/vérification de passkeys), distinct de OTP/magic-link/guest.',
    ],
  },
  since:    '2026-08',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  // ── Service rendu ────────────────────────────────────────────────────────
  service: 'Enregistrer et vérifier des passkeys WebAuthn L3 (authentificateur cryptographique, ' +
           'K2 de la doctrine auth) pour un utilisateur déjà identifié — capacité serveur ' +
           'uniquement à ce stade (AUTH-2). L\'UI et le login-passkey nominal viennent en AUTH-3/4.',

  // ── Perimetre ────────────────────────────────────────────────────────────
  perimeter: {
    in: [
      'génération des options WebAuthn (register/login), vérification cryptographique via ' +
        '@simplewebauthn/server, stockage/rotation des credentials et des challenges éphémères',
    ],
    out: [
      'UI/bouton "Sécuriser Komerce" (AUTH-3)',
      'login-passkey comme parcours nominal / step-up (AUTH-4/5)',
      'recovery et gestion multi-appareils (AUTH-6/7)',
      'toute logique OTP/magic-link/guest-checkout — reste dans auth-identity',
    ],
  },

  // ── Perimetre fichiers ───────────────────────────────────────────────────
  files: {
    services: [
      'services/webauthn-service.js',
    ],
    routes: [
      'routes/auth-passkey.js',
    ],
    migrations: [
      'migrations/133_webauthn_credentials.sql',
    ],
    tests: [
      'tests/unit/auth-passkey.test.js',
    ],
  },

  // ── Contrat d'interface ──────────────────────────────────────────────────
  docs: [],

  // ── Tables DB ────────────────────────────────────────────────────────────
  db: {
    tables: [
      'webauthn_credentials: RW',   // OWNER exclusif (AUTH-2)
      'webauthn_challenges: RW',    // OWNER exclusif (AUTH-2) — éphémère, TTL 2 min
      'users: R',                   // lecture seule (identité), jamais de mutation ici
    ],
  },

  security: {
    status: 'CONFIRMED_MIXED',
    authedRoutesDetected: 2,
    totalRoutes: 4,
    note: 'register/options et register/verify exigent authenticate (K1 minimum — on ne pose ' +
          'une passkey que sur un compte déjà prouvé). login/options et login/verify sont ' +
          'publics par nature (c\'est le mécanisme de login) ; leur sécurité vient de la ' +
          'vérification cryptographique, pas d\'un middleware d\'auth.',
  },
  contract: {
    exposes: [
      'POST /api/auth/passkey/register/options',
      'POST /api/auth/passkey/register/verify',
      'POST /api/auth/passkey/login/options',
      'POST /api/auth/passkey/login/verify',
    ],
    consumes: [
      'auth-identity (middleware/auth.js — authenticate, utils/auth-cookie.js — setAuthCookie, ' +
        'AUTH-8 — même politique de session que le login OTP)',
      'infrastructure (db.js, utils/logger.js)',
    ],
  },

  // ── Décisions actées (2026-08, AUTH-2) ────────────────────────────────────
  debt: {
    knownGaps: [
      {
        gap: 'Challenges stockés en table (webauthn_challenges), pas en cookie signé — décision ' +
             'actée pour ne pas dépendre de la politique cookie AUTH-8b/c encore en cours de ' +
             'durcissement, et pour une consommation atomique en SQL (UPDATE ... RETURNING).',
        risk: 'faible — ligne de plus par tentative register/login, TTL 2 min, purge possible ' +
              'par cron ultérieur (hors périmètre AUTH-2).',
      },
      {
        gap: 'Login username-first (phone fourni) ET discoverable (phone absent) sont tous deux ' +
             'supportés côté serveur — le choix du parcours par défaut revient à AUTH-3/4 (UI).',
        risk: 'aucun côté serveur — les deux chemins passent par la même vérification stricte.',
      },
      {
        gap: 'attestationType = "none" (doctrine §19) : aucune vérification de la provenance ' +
             'matérielle de l\'authentificateur, seulement de la possession de la clé privée.',
        risk: 'accepté par doctrine — Komerce ne fait pas de contrôle de flotte d\'appareils.',
      },
    ],
  },

  // ── Autorite ─────────────────────────────────────────────────────────────
  authority: 'backend-core — toute vérification WebAuthn passe exclusivement par ' +
             '@simplewebauthn/server ; aucune ré-implémentation crypto/CBOR locale.',

  // ── Invariants propres ───────────────────────────────────────────────────
  invariants: [
    'un challenge register/login est à usage unique — sa consommation est atomique ' +
      '(UPDATE ... WHERE consumed_at IS NULL RETURNING) et couvre rejeu + expiration',
    'un challenge émis pour un user ne peut jamais être consommé au bénéfice d\'un autre user',
    'expectedOrigin et expectedRPID viennent exclusivement de la config serveur, jamais du client',
    'une réponse register ne peut pas être vérifiée comme login, et inversement (ceremony_type strict)',
    'requireUserVerification est vérifié par la lib, pas seulement demandé à l\'authenticator',
    'credential_id est unique (contrainte DB + vérification applicative avant insert)',
    'une credential revoked_at non nul est inutilisable au login, sans exception',
    'sign_count : régression rejetée pour les credentials non sauvegardées (backup_state=false) ; ' +
      'tolérée et tracée pour les passkeys synchronisées (backup_state=true)',
  ],

};
