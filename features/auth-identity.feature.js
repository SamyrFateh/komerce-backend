/**
 * @feature       auth-identity
 * @type          transversal
 * @domain        auth-identity
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
  nature:   'feature',   // feature | capability | governance-unit
  type:     'transversal',   // feature | transversal
  domain:   'auth-identity',
  status:   'production',   // draft | staging | production | deprecated
  owner:    'backend-core',

  // ── Classification d'ontologie (arbitrage 2026-07-29) ────────────────────
  // `axis` est la SEULE source de la binarité business/support. `type` est un
  // champ historique de topologie et ne doit jamais servir à la dériver.
  classification: {
    axis:     'business',   // business | support
    kind:     'business-feature',
    rationale: [
      'Propriétaire de `users` et `otp_codes` (arbitrage A, 2026-07-29). Cycle de vie propre : OTP, magic-link, guest-checkout. Expose revokeSessions() comme protocole de mutation.',
    ],
  },
  since:    '2025-08',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  // ── Service rendu ────────────────────────────────────────────────────────
  // Corrigé au Lot O2 (2026-07-12) — était un copié-collé du texte d'auth.
  service: 'Authentifier un utilisateur et gérer son identité active (OTP, login/register, ' +
           'magic-link, guest-checkout, profil) via les routes exposées.',

  // ── Perimetre ────────────────────────────────────────────────────────────
  perimeter: {
    in: [
      'routes actives d\'identité : OTP (request/verify/test-reset), login/register, magic-link, ' +
        'guest-checkout, admin-reset, consultation/édition du profil et des commandes client',
    ],
    out: [
      'logique metier propre a chaque feature consommatrice — auth-identity ne sait rien des commandes, paniers ou paiements',
    ],
  },

  // ── Perimetre fichiers ───────────────────────────────────────────────────
  files: {
    services: [
      'services/otp-test-mode.js',
      // Lot 5 — autorisation nominative de retrait exceptionnel. Possède
      // user_pickup_authorizations ; expose getActiveAuthorizationForUpdate/
      // hasActiveAuthorization à logistics (jamais de requête directe côté
      // logistics sur cette table, cf. features/logistics.feature.js contract.consumes).
      'services/pickup-authorization-service.js',
      // services/authkey-client.js retiré (O7.1, REHOME_CONSUMER) — "AuthKey" est
      // le fournisseur tiers d'API WhatsApp (authkey.io), collision de nom avec
      // "auth". Le fichier n'a aucune logique d'authentification/identité ; c'est
      // un adaptateur de notification sortante, 100% consommé par
      // services/notifications/*. Rattaché à features/notifications.feature.js.
      // Voir docs/O7_1_OWNERSHIP_ANALYSIS.md, CAS A.
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
    utils: [
      // Lot 5 — partagé avec logistics (comparaison aveugle au retrait),
      // domaine shared, listé ici car c'est auth-identity qui possède la
      // comparaison de noms sur laquelle repose l'autorisation nominative.
      'utils/name-normalize.js',
    ],
    migrations: [
      'migrations/121_exceptional_pickup_authorization.sql',
    ],
      tests: [
      'tests/integration/admin-authz-probe.test.js',
      'tests/integration/otp-no-guest.test.js',
      // tests/unit/authkey-client.test.js retiré (O7.1) — suit services/authkey-client.js vers notifications.
      'tests/unit/otp-test-mode.test.js',
      'tests/unit/client-auth.test.js',
      'tests/unit/pickup-authorization-service.test.js',
      'tests/unit/name-normalize.test.js',
    ],
  },

  // ── Contrat d'interface ──────────────────────────────────────────────────
  docs: [],

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
      'invoices: R',
      'loyalty_tiers: R',
      'order_items: R',
      'orders: R',
      'otp_codes: RW',
      'parcels: R',
      'products: R',
      'relais: R',
      'revoked_tokens: W',
      'users: RW',   // OWNER (arbitrage A, 2026-07-29) — seule feature autorisée à muter, via l'API interne ci-dessous
      'user_pickup_authorizations: RW',   // OWNER (Lot 5) — autorisation nominative de retrait exceptionnel
    ],
  },

  security: {
    status: 'CONFIRMED_MIXED',
    authedRoutesDetected: 7,
    totalRoutes: 20,
    note: "7/20 routes protégées (tableau de bord, refresh, etc.). 13 routes publiques par design : OTP (cooldown 5 min/phone + plafond journalier DB, test-reset gaté par isOtpTestMode() → 404 en prod), magic-link (token signé), guest-checkout (flux boutique public), orders-by-phone (client lookup public), admin-reset gaté applicativement (ADMIN_RESET_KEY ≥ 32 chars obligatoire + ALLOW_ADMIN_RESET=true requis en prod — désactivé par défaut).",
  },
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
      // Lot 5 — autorisation nominative de retrait exceptionnel (propriétaire du compte)
      'GET /api/auth/me/pickup-authorization',
      'PUT /api/auth/me/pickup-authorization',
      'DELETE /api/auth/me/pickup-authorization',
    ],
    // O7.3 (provider auth-identity) : makeIntlPhoneInput (public/boutique/js/b-phone.js)
    // est consommé par shared-cart (b-share-cart.js) — corrigé depuis une
    // couture artificielle via payments/b-checkout.js (simple ré-export
    // historique). Scope boutique/frontend, pas un service backend. Voir
    // docs/O7_3_BOUNDARY_ANALYSIS.md, provider payments (analyse de la paire).
    internalApi: [
      { fn: 'makeIntlPhoneInput', file: 'public/boutique/js/b-phone.js' },
      // Lot 5 — seule API interne autorisée pour logistics : jamais de
      // requête directe sur user_pickup_authorizations hors de ce fichier.
      { fn: 'getActiveAuthorizationForUpdate', file: 'services/pickup-authorization-service.js' },
      { fn: 'hasActiveAuthorization', file: 'services/pickup-authorization-service.js' },
    ],
    consumes: [
      // Déclarations FF-C1 (2026-07-29) — arêtes réelles, non des inversions :
      // auth-identity est business (arbitrage A), ces dépendances sont donc
      // des consommations métier→support et métier→métier ordinaires.
      'auth (middleware/auth.js — garde authenticate/requireAdmin utilisée par routes/client-auth.js, routes/auth.js)',
      'notifications (services/notification-service.js — envoi OTP/alertes depuis routes/client-auth.js, routes/otp.js)',
    ],
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
    {
      statement: 'toute route mutante passe par un middleware d\'auth declare — jamais d\'acces direct sans garde',
      test: 'tests/invariants/auth-identity.mutating-routes-guarded.test.js',
    },
    'les routes de ce manifeste s\'appuient sur authenticate (middleware/auth.js, feature auth) — pas de garde ad-hoc',
    'une seule autorisation nominative active par utilisateur, consultée au moment exact de la remise — jamais figée par commande',
    'le nom autorisé n\'est jamais exposé au relais : logistics ne reçoit que des champs normalisés via getActiveAuthorizationForUpdate, jamais authorized_given_names/authorized_family_name en clair',
  ],

};
