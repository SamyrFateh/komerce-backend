/**
 * @feature       shared-cart
 * @domain        panier-partage
 * @status        production
 * @owner         backend-core
 * @since         2026-03
 * @doctrine      docs/doctrine/PANIER_PARTAGE_BOUTIQUE_FIRST.md
 * @registry      docs/doctrine/APP_FEATURE_REGISTRY.md
 */
'use strict';

module.exports = {

  // ── Identité ─────────────────────────────────────────────────────────────
  name:     'shared-cart',
  type:     'feature',   // feature | transversal
  domain:   'shared-cart',
  status:   'production',   // draft | staging | production | deprecated
  owner:    'backend-core',
  since:    '2026-03',
  doctrine: 'docs/doctrine/PANIER_PARTAGE_BOUTIQUE_FIRST.md',

  // ── Service rendu ──────────────────────────────────────────────────────────
  service: 'Permettre à plusieurs participants de composer et financer un panier ' +
           'commun, de la création à la commande finale.',

  // ── Périmètre ────────────────────────────────────────────────────────────
  perimeter: {
    in: [
      'création, contribution, clôture, annulation du panier partagé',
      'estimation et garde financière du panier (financial guard)',
      'transitions d\'état v4/v4.1 et réparation des réservations stock collectives',
    ],
    out: [
      'paiement carte/PayPal lui-même (feature payments)',
      'création de la commande finale (feature orders, consommée en sortie)',
      'crédit wallet (feature wallet, consommée en sortie)',
    ],
  },

  // ── Autorité ─────────────────────────────────────────────────────────────
  authority: 'backend-core — tout changement de machine d\'état v4/v4.1 doit être ' +
             'validé par le propriétaire de shared-cart-engine.js',

  // ── Périmètre fichiers ────────────────────────────────────────────────────
  files: {
    services: [
      'services/shared-cart-engine.js',          // barrel — Lot C1 2026-06-28
      'services/shared-cart-internals.js',       // CONFIG, helpers, audit
      'services/shared-cart-creation.js',        // createFromBasket, createFromCartItems, clearCreatorBasket
      'services/shared-cart-reads.js',           // getForPublic, getForOwner, listMy, incrementViewCount
      'services/shared-cart-contributions.js',   // startContribution, attachStripe, markFailed
      'services/shared-cart-lifecycle.js',       // closeCart, convertToOrder, cancel, stateMachine, expire
      'services/shared-cart-financial-guard.js',
      'services/shared-cart-queries.js',
      'services/shared-cart-items-service.js',
      'services/shared-cart-cash-service.js',
      'services/shared-cart-estimation-service.js',
      'services/shared-cart-refund-queue.js',
      'services/shared-cart-v41-transitions.js',
      'services/cancel-shared-cart-with-refunds.js',
    ],
    routes: [
      'routes/shared-cart.js',
      'routes/shared-cart-cash.js',
      'routes/shared-cart-from-order.js',
      'routes/shared-cart-refund-admin.js',
    
      'routes/baskets.js',
      'routes/shares.js',],
    migrations: [
      'migrations/044_shared_cart.sql',
      'migrations/048_collective_workspaces.sql',
      'migrations/052_contributions_optional_amount.sql',
      'migrations/057_cart_event_shares.sql',
      'migrations/059_group_order.sql',
      'migrations/071b_shared_cart_commitments.sql',
      'migrations/073_shared_cart_cash_contributions.sql',
      'migrations/073a_shared_cart_cash_contributions.sql',
      'migrations/073b_shared_cart_cash_contributions.sql',
      'migrations/074_add_v4_status_values.sql',
      'migrations/075_hub_shares_collective_schema.sql',
      'migrations/080_v41_shared_cart_state_machine.sql',
      'migrations/085_shared_cart_cash_contributions.sql',
      'migrations/099_drop_zombie_shared_cart_commitments.sql',
    ],
    tests: [
      // E2E fonctionnel Feature First — shared-cart est PROPRIETAIRE ;
      // payments, auth-identity, catalog et logistics sont traversees.
      'tests/e2e-api/shared-cart.contribution-webhook.e2e.test.js',
      'tests/unit/baskets.test.js',
      'tests/unit/shared-cart-branches.test.js',
      'tests/unit/shared-cart-cash-route.test.js',
      'tests/unit/shared-cart-cash-service.test.js',
      'tests/unit/shared-cart-contributions.test.js',
      'tests/unit/shared-cart-creation.test.js',
      'tests/unit/shared-cart-creator-route.test.js',
      'tests/unit/shared-cart-engine.test.js',
      'tests/unit/shared-cart-estimation-service.test.js',
      'tests/unit/shared-cart-from-order.test.js',
      'tests/unit/shared-cart-internals.test.js',
      'tests/unit/shared-cart-items-service.test.js',
      'tests/unit/shared-cart-public-route.test.js',
      'tests/unit/shared-cart-reads.test.js',
      'tests/unit/shared-cart-refund-admin.test.js',
      'tests/unit/shares-route.test.js',
      'tests/unit/shared-cart-v41-transitions.test.js',
      'tests/unit/shared-cart-lifecycle.test.js',
      'tests/unit/shared-cart-financial-guard.test.js',
      'tests/unit/shared-cart-queries.test.js',
      'tests/unit/shared-cart-refund-queue.test.js',
      'tests/unit/cancel-shared-cart-with-refunds.test.js',
      'tests/unit/shared-cart-edit-mode.test.js',
      'tests/unit/shared-cart-lot9-business.test.js',
      'tests/unit/shared-cart-v4-2-creation.test.js',
      'tests/unit/shared-cart-v41-reconciliation.test.js',
    ],
    boutique: [
      'js/b-group-cart-flow.js',
      'js/b-share-cart.js',
      'js/b-group-view.js',
      'js/b-group-banner.js',
      'js/b-friendly-group-redirect.js',
      'js/b-share-phone-guard.js',
      // Backfill gouvernance globale (governance/boutique-global-ownership) :
      // header @komerce-arch confirme domain=shared-cart pour ces 6 fichiers
      // (docs/BOUTIQUE_360.json) — non couverts avant cette passe.
      'js/group/group-api.js',
      'js/group/group-helpers.js',
      'js/group/group-render-creator.js',
      'js/group/group-state.js',
      'css/group-cart-flow.css',
      'css/share-cart.css',
      'css/hero-cart-proxy.css',
      'css/shared-followup.css',
    ],
      dash: [
      // dashboards/admin views — Lot 4
      'dashboards/admin/js/views/SharedCartsView.js',
      'dashboards/admin/js/views/EventWorkspacesView.js',
    ],
},

  // ── Dépôts ───────────────────────────────────────────────────────────────
  // Cette feature est répartie sur 2 dépôts distincts (pas un monorepo) :
  repos: {
    backend: 'services/ + routes/ ci-dessus',
    boutique: 'js/ + css/ ci-dessus — dépôt "bout", gouverné en détail par ' +
              'docs/BOUTIQUE_COMPONENT_OWNERSHIP.md et docs/BOUTIQUE_OWNERSHIP_LIVE.md ' +
              '(auto-généré par scripts/gen-ownership.js du dépôt bout — source de vérité ' +
              'pour le détail CSS/DOM, ne pas dupliquer ici)',
  },

  // ── Contrat d'interface ───────────────────────────────────────────────────
  docs: [
    'docs/backend/PANIER_COLLECTIF_BACKEND_DELTA.md',
    'docs/chantier/FLOW_AUDIT_COLLECTIVE_G3.md',
    'docs/chantier/STATUS_SONNET_PANIER_V42.md',
    'docs/doctrine/DOCTRINE_PANIER_COLLECTIF.md',
    'docs/doctrine/DOCTRINE_PANIER_PARTAGE.md',
    'docs/doctrine/DOCTRINE_PANIER_PARTAGE_SURCOUVERTURE.md',
    'docs/doctrine/PANIER_PARTAGE_BOUTIQUE_FIRST.md',
    'docs/implementation/PANIER_PARTAGE_BOUTIQUE_FIRST.md',
    'docs/specs/collective-workspaces-v1.md',
    'docs/specs/event-flow-v2.md',
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
      'basket_items: RW',
      'baskets: RW',
      'cart_contributions: RW',
      'cart_shares: RW',
      'finance_config: R',
      'order_items: RW',
      // order_status_history : W-via:order-status-machine (appendOrderHistoryNote — shared-cart-lifecycle.js)
      'orders: RW',
      'products: R',
      'recipients: RW',
      // refunds : W-via:refund-service (recordExternalRefund — shared-cart-refund-queue.js, cancel-shared-cart-with-refunds.js)
      'relais: R',
      'shared_cart_contributions: RW',
      'shared_cart_estimations: RW',
      'shared_cart_events: RW',
      'shared_cart_items: RW',
      'shared_carts: RW',
      'stripe_events_processed: RW',
      // transaction_documents retiré (2026-07-07) : délégué à
      // services/documents/refund-receipt.js — shared-cart ne lit/écrit
      // jamais cette table en direct (voir MULTI_WRITER_TABLES.md).
      'users: R',
    ],
  },

  security: {
    status: 'CONFIRMED_MIXED',
    authedRoutesDetected: 0,
    totalRoutes: 33,
    note: "0/33 routes avec middleware Express authenticate — toutes les routes shared-cart opèrent sur capability tokens (:token dans le path) validés applicativement. Point d'attention §5 : POST /api/shares et POST /api/shares/:token/contributions ne sont couverts que par le globalLimiter (500 req/15 min/IP), pas de limiteur dédié — vecteur potentiel de spam de paniers partagés à évaluer.",
  },
  contract: {
    exposes: [
      'POST   /api/shared-carts/from-cart-items',
      'POST   /api/shared-carts/from-basket',
      'POST   /api/shared-carts/from-order',
      'GET    /api/shared-carts/mine',
      'GET    /api/shared-carts/:id',
      'GET    /api/shared-carts/:id/as-cart-items',
      'PUT    /api/shared-carts/:id/items',
      'POST   /api/shared-carts/:id/close',
      'POST   /api/shared-carts/:id/finalize',
      'POST   /api/shared-carts/:id/awaiting-choice/complete',
      'POST   /api/shared-carts/:id/awaiting-choice/adjust',
      'POST   /api/shared-carts/:id/awaiting-choice/cancel',
      'POST   /api/shared-carts/:id/extend-window',
      'POST   /api/shared-carts/:id/cancel',
      'GET    /api/shared-carts/public/:token',
      'GET    /api/shared-carts/public/:token/estimations',
      'POST   /api/shared-carts/public/:token/estimations',
      'DELETE /api/shared-carts/public/:token/estimations/:estimationId',
      'GET    /api/shared-carts/public/:token/estimations/by-phone',
      'POST   /api/shared-carts/public/:token/contributions',
      'POST   /api/shared-carts/public/:token/contributions/cash',
      'POST   /api/shared-carts/contributions/:id/confirm-cash',
      'GET    /api/admin/shared-carts',
      'GET    /api/admin/shared-carts/refund-queue',
      'GET    /api/admin/shared-carts/:id',
      'POST   /api/admin/shared-carts/:id/expire',
      'POST   /api/admin/shared-carts/:id/extend',
      'POST   /api/admin/shared-carts/:id/note',
      'POST   /api/admin/shared-carts/refund-queue/:contributionId/mark-refunded',
      // Rapatriées depuis le route-registry (audit 2026-07-06, lot interface-inverse)
      // — routes réelles câblées via bootstrap/api-routes.js (routes/shares.js,
      // déjà dans le périmètre de fichiers), jamais déclarées jusqu'ici.
      'POST /api/shares',
      'GET /api/shares/:token',
      'POST /api/shares/:token/contributions',
      'PATCH /api/shares/:token/contributions/:id',
    ],
    consumes: [
      "refunds (FF-C1 2026-07-29 — orchestration du remboursement ; preuve: services/shared-cart-refund-queue.js -> services/refund-service.js ; services/cancel-shared-cart-with-refunds.js -> services/refund-service.js)",
'orders',        // domaine propriétaire : order-status-machine
      'wallet',        // domaine propriétaire : wallet-service
      'products',      // lecture seule
      'notification', // émission uniquement,
      'auth',
      'customs',
      'documents',
      'logistics',
      'loyalty (declenche le recalcul de palier apres commande group panier confirmee — services/loyalty-service.js handleOrderConfirmed, O7.3 provider loyalty)',
      'payments (reutilise makeInput pour un style de champ uniforme au checkout — public/boutique/js/b-checkout.js, scope boutique, O7.3 provider payments)',
      'auth-identity (reutilise makeIntlPhoneInput — public/boutique/js/b-phone.js, scope boutique, O7.3 provider payments : couture initialement artificielle via b-checkout.js, corrigee vers le vrai proprietaire)',
    ],
  },

  // ── Dette assumée / documentée ────────────────────────────────────────────
  // (audit 2026-07-06, §2a — reclassé après vérification empirique)
  debt: {
    knownGaps: [
      { gap: 'contrat historique en style verbe simple sur :id ("/:id/contribute", ' +
             '"/cash/:id/contribute", "/refund-admin/:id") : aucune route ne sert ce style. ' +
             'La doctrine "paiement = engagement" du panier partagé s\'incarne dans le code ' +
             'réel en ressources nommées, pas en verbes : une contribution est un enregistrement ' +
             '(POST .../public/:token/contributions[/cash]), jamais une action fugace sur ' +
             'l\'identifiant du panier lui-même. Le flux de remboursement admin est de même ' +
             'un enregistrement de file (POST /api/admin/shared-carts/refund-queue/:contributionId/mark-refunded), ' +
             'pas un endpoint /refund-admin/:id générique.',
        risk: 'aucun consommateur externe connu de l\'ancien style verbe. Les 29 endpoints ' +
              'ci-dessus sont la surface réelle complète, vérifiée contre route-registry.json.',
      },
    ],
  },

  // ── Invariants propres ────────────────────────────────────────────────────
  // Complémentaires aux invariants globaux de ZONE_IMPACT.md (I-01..I-10).
  invariants: [
    'snapshot figé après 1ère contribution payée',
    { statement: 'idempotence webhook Stripe sur shared_cart_contributions',
      test: 'tests/e2e-api/shared-cart.contribution-webhook.e2e.test.js' },
    { statement: 'fenêtre paiement 48h — aucune extension sans machine de statut',
      test: 'tests/e2e-api/shared-cart.contribution-webhook.e2e.test.js' },
    'annulation restores wallet si contribution confirmée',
    'lien partagé ouvre une boutique — jamais un guichet (Boutique First)',
    'participant consulte en lecture seule — règle sa part seulement si panier payable',
  ],

  // ── Classification ────────────────────────────────────────────────────────
  // Vérifiable par : npm run feature:classification
  classification: {
    kind:     'business-feature',
    decision: 'feature-autonome',
    signals: {
      ownsTables:          true,  // shared_carts, shared_cart_contributions, collective_workspaces…
      ownsLifecycle:       true,  // machine d'état v4.1 : OPEN→CLOSED→AWAITING_CHOICE→ORDERED/CANCELLED
      activeService:       true,  // crée, contribue, clôture, annule
      multiConsumer:       false, // consommée par orders en sortie, pas l'inverse
      ownsMigrations:      true,  // 8 migrations dédiées
      externalSideEffect:  'payment', // Stripe webhooks + PayPal
      surface:             'api',
    },
    rationale: [
      'écrit dans des tables propriétaires (shared_carts, shared_cart_contributions, collective_workspaces)',
      'porte une machine de statut propre à 5 états avec invariant de fenêtre 48h',
      'rend un service métier autonome de bout en bout (création → commande finale)',
      'effet externe critique : idempotence Stripe sur webhook de contribution',
    ],
  },

};
