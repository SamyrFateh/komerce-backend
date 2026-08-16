/**
 * @feature       wallet
 * @type          feature
 * @domain        wallet
 * @status        production
 * @owner         backend-core
 * @since         2025-10
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 * @registry      docs/doctrine/APP_FEATURE_REGISTRY.md
 */
'use strict';

module.exports = {

  // ── Identite ─────────────────────────────────────────────────────────────
  name:     'wallet',
  type:     'feature',   // feature | transversal
  domain:   'wallet',
  status:   'production',   // draft | staging | production | deprecated
  owner:    'backend-core',
  since:    '2025-10',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  // ── Service rendu ────────────────────────────────────────────────────────
  service: 'Tenir un solde client et son historique de credit/debit, avec application exactement une fois.',

  // ── Perimetre ────────────────────────────────────────────────────────────
  perimeter: {
    in: [
      'solde wallet et historique de credit/debit',
      'application/retrait du wallet sur une commande (orders.wallet_applied_kmf)',
    ],
    out: [
      'paiement carte/PayPal (feature payments)',
      'remboursement initiateur (feature refunds, qui credite le wallet)',
      'programme de fidelite et ses recompenses (feature loyalty, scindee de wallet-loyalty au Lot O1)',
      'emission du recu wallet (services/documents/wallet-receipt.js, @domain documents — consommateur en aval, pas ownership wallet)',
    ],
  },

  // ── Perimetre fichiers ───────────────────────────────────────────────────
  // Vérifié empiriquement (Lot O1.2, 2026-07-12) : utils/store-credits.js
  // est un module DEPRECATED (D5, "used-by: none" dans son propre header) —
  // toutes ses fonctions lèvent une erreur explicite. Conservé dans wallet
  // par continuité d'ownership de nom (store credits = concept wallet), pas
  // parce qu'il est actif.
  files: {
    services: [
      'services/wallet-service.js',
      'utils/store-credits.js',   // DEPRECATED (D5) — voir note ci-dessus
    ],
    routes: [
      'routes/wallet.js',
    ],
    migrations: [
      'migrations/066_wallet_consumptions_append_only.sql',
      'migrations/068_wallets_check_balance.sql',
    ],
    boutique: [
      'js/b-wallet.js',
      'css/wallet.css',
    ],
    tests: [
      'tests/unit/wallet-service.test.js',
      'tests/unit/store-credits.test.js',
      'tests/unit/wallet-route.test.js',
    ],
  },

  // ── Dépôts ───────────────────────────────────────────────────────────────
  repos: {
    backend: 'services/ + routes/ ci-dessus',
    boutique: 'js/b-wallet.js + css/wallet.css — dépôt boutique, gouverné localement par boutique/features/wallet.feature.js (manifest niveau 0, ownership fichiers uniquement)',
  },

  docs: [],

  // ── Tables DB (vérifiées par grep .query() réel, Lot O1.2 2026-07-12) ────
  // wallet écrit orders.wallet_applied_kmf uniquement (services/wallet-service.js
  // lignes ~300/364) — jamais le statut ni le reste de la commande. users est
  // lu seul (join pour nom/tel, aucun UPDATE users dans wallet-service.js ni
  // routes/wallet.js).
  db: {
    // Clean Signal Boundary: lifecycle ownership is table-specific.
    lifecycleOwnerOf: [
      'wallet_transactions',
      'wallets',
    ],
    tables: [
      'orders: RW',      // wallet_applied_kmf uniquement
      'users: R',
      'wallet_consumptions: RW',
      'wallet_credit_lots: RW',
      'wallet_transactions: RW',
      'wallets: RW',
    ],
  },

  security: {
    status: 'CONFIRMED_PROTECTED',
    authedRoutesDetected: 9,
    totalRoutes: 9,
    note: "9/9 routes protégées (router.use(authenticate) global en tête de routes/wallet.js) — aucune route publique côté wallet, à la différence de loyalty qui expose GET /api/loyalty/tiers en public.",
  },
  contract: {
    exposes: [
      'GET /api/wallet',
      'GET /api/wallet/transactions',
      'POST /api/wallet/apply',
      'POST /api/wallet/remove',
      'GET /api/wallet/admin',
      'GET /api/wallet/admin/:userId',
      'POST /api/wallet/admin/credit',
      'POST /api/wallet/admin/order-credit/:orderId',
      'POST /api/wallet/admin/reverse-lot',
    ],
    consumes: [
      "auth (FF-C1 2026-07-29 — garde de route et contexte d’identité ; preuve: routes/wallet.js -> middleware/auth.js)",

      "documents (FF-C1 2026-07-29 — émission ou lecture documentaire ; preuve: services/wallet-service.js -> services/documents/wallet-receipt.js ; routes/wallet.js -> services/documents/wallet-receipt.js)",

      'auth-identity (identification du client)',
      'payments (finalise le paiement — payment-service.js markPaid, transactionnel, quand le debit wallet couvre integralement la commande ; invariant D-02, payment-service reste seul proprietaire de payment_status — O7.2 Cycle D)',
    ],
  },

  // ── Dette assumée / documentée ────────────────────────────────────────────
  debt: {
    knownGaps: [
      { gap: 'ancien contrat déclaré "GET /api/wallet/:userId", "POST /api/wallet/:userId/credit" ' +
             '(ressource dans le chemin) : aucune route ne sert ce style. Le solde self-service se lit ' +
             'par session (GET /api/wallet, pas de :userId), et le crédit admin est un sous-espace ' +
             '/admin/... avec :userId ou :orderId selon l\'action, jamais un simple crédit générique.',
        risk: 'si un consommateur externe construisait encore des URLs /api/wallet/<id> ou ' +
              '/api/wallet/<id>/credit, il reçoit un 404 — confirmé sans dépendance connue.',
      },
      { gap: 'utils/store-credits.js est mort (DEPRECATED D5, used-by: none) mais reste déclaré comme ' +
             'fichier wallet — aucun code actif ne l\'appelle.',
        risk: 'aucun — conservé uniquement pour ne pas casser un import legacy hypothétique. Candidat ' +
              'à suppression pure dans un lot de nettoyage séparé (hors scope O1, qui n\'ontology-refactor ' +
              'pas la suppression de code mort).',
      },
    ],
  },

  // ── Autorite ─────────────────────────────────────────────────────────────
  authority: 'backend-core — tout changement de calcul de solde doit etre valide par le proprietaire de wallet-service.js',

  // ── Invariants propres ───────────────────────────────────────────────────
  invariants: [
    { statement: 'application wallet une seule fois par evenement source',
      test: 'tests/invariants/wallet.single-application-per-event.test.js' },
    'solde jamais negatif sans flag explicite admin',
  ],

  // ── Classification (manifest créé au Lot O1) ────────────────────────────
  classification: {
    kind:     'business-feature',
    decision: 'feature-autonome',
    signals: {
      ownsTables:          true,
      ownsLifecycle:       true,  // idempotence par événement source, séquences append-only
      activeService:       true,
      multiConsumer:       true,  // consommé par payments/refunds/checkout/order-payment-confirmation
      ownsMigrations:      true,
      externalSideEffect:  'none',
      surface:             'api+boutique',
    },
    rationale: [
      'possède ses propres tables (wallets, wallet_transactions, wallet_credit_lots, wallet_consumptions) avec invariant d\'idempotence propre',
      'scindé de wallet-loyalty (Lot O1, 2026-07-12) : le solde client et la fidélité ne partagent ni tables (hors users en lecture), ni cycle de vie, ni logique de calcul',
    ],
  },

};
