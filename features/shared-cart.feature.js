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
  type:     'feature',
  domain:   'shared-cart',
  status:   'production',
  owner:    'backend-core',
  since:    '2026-03',
  doctrine: 'docs/doctrine/PANIER_PARTAGE_BOUTIQUE_FIRST.md',

  // ── Service rendu ──────────────────────────────────────────────────────────
  // Réécrit (Lot 2/3, migration 124) : le panier partagé n'est plus un
  // véhicule de paiement groupé — c'est une liste de souhaits partageable.
  service: 'Permettre à un créateur de composer une liste de produits ' +
           'partageable par lien public ; chaque participant réclame un ' +
           'article en l\'achetant individuellement via le checkout canonique.',

  // ── Périmètre ────────────────────────────────────────────────────────────
  perimeter: {
    in: [
      'création, édition (statut open), fermeture, annulation de la liste partagée',
      'lecture publique et propriétaire (avec statut de réclamation dérivé par jointure)',
    ],
    out: [
      'paiement carte/PayPal/cash (feature payments, consommée en sortie)',
      'arbitrage de la réclamation d\'un article (index unique order_items.shared_cart_item_id, migration 123 — feature orders)',
      'création de la commande (feature orders)',
      'crédit wallet (feature wallet)',
    ],
  },

  // ── Autorité ─────────────────────────────────────────────────────────────
  authority: 'backend-core — tout changement de statut (open/closed/cancelled) ' +
             'doit être validé par le propriétaire de shared-cart-lifecycle.js',

  // ── Périmètre fichiers ────────────────────────────────────────────────────
  files: {
    services: [
      'services/shared-cart-engine.js',          // barrel
      'services/shared-cart-internals.js',       // CONFIG, helpers, audit
      'services/shared-cart-creation.js',        // createFromBasket, createFromCartItems, clearCreatorBasket
      'services/shared-cart-reads.js',           // getForPublic, getForOwner, listMy (total + claimed dérivés)
      'services/shared-cart-lifecycle.js',       // closeCart, cancelSharedCart
      'services/shared-cart-queries.js',
      'services/shared-cart-items-service.js',
    ],
    routes: [
      'routes/shared-cart.js',
      'routes/baskets.js',
    ],
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
      'migrations/123_shared_cart_item_claim_bridge.sql',    // pont order_items <-> shared_cart_items
      'migrations/124_shared_cart_minimal_domain.sql',       // domaine minimal, colonnes financières retirées
    ],
    tests: [
      'tests/unit/baskets.test.js',
      'tests/unit/shared-cart-creation.test.js',
      'tests/unit/shared-cart-creator-route.test.js',
      'tests/unit/shared-cart-engine.test.js',
      'tests/unit/shared-cart-internals.test.js',
      'tests/unit/shared-cart-items-service.test.js',
      'tests/unit/shared-cart-public-route.test.js',
      'tests/unit/shared-cart-reads.test.js',
      'tests/unit/shared-cart-lifecycle.test.js',
      'tests/unit/shared-cart-queries.test.js',
      // NOTE (2026-08) : ces fichiers de test existent encore dans le repo
      // mais testent l'ancien domaine V4.1 (contributed_kmf, estimations,
      // awaiting_choice...) et n'ont pas encore été réécrits contre le code
      // ci-dessus. Ne pas les considérer comme couverture valide tant qu'ils
      // n'ont pas été repassés — voir LOT23_README.md de cette livraison.
    ],
    boutique: [
      // Non retouché dans ce lot (backend uniquement) — ces fichiers
      // référencent encore contributed_kmf/remaining_kmf et doivent être
      // mis à jour dans un lot frontend séparé avant merge complet.
      'js/b-group-cart-flow.js',
      'js/b-share-cart.js',
      'js/b-group-view.js',
      'js/b-group-banner.js',
      'js/b-friendly-group-redirect.js',
      'js/b-share-phone-guard.js',
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
      // Non retouché dans ce lot — référence encore l'ancien domaine.
      'dashboards/admin/js/views/SharedCartsView.js',
    ],
  },

  // ── Dépôts ───────────────────────────────────────────────────────────────
  repos: {
    backend: 'services/ + routes/ ci-dessus',
    boutique: 'js/ + css/ ci-dessus — dépôt "bout", gouverné en détail par ' +
              'docs/BOUTIQUE_COMPONENT_OWNERSHIP.md et docs/BOUTIQUE_OWNERSHIP_LIVE.md',
  },

  // ── Contrat d'interface ───────────────────────────────────────────────────
  docs: [
    'docs/doctrine/PANIER_PARTAGE_BOUTIQUE_FIRST.md',
    // Les documents suivants décrivent l'ancien domaine V4/V4.1 et doivent
    // être mis à jour ou archivés (hors périmètre de ce lot, code-only) :
    // docs/doctrine/DOCTRINE_PANIER_COLLECTIF.md,
    // docs/doctrine/DOCTRINE_PANIER_PARTAGE.md,
    // docs/doctrine/DOCTRINE_PANIER_PARTAGE_SURCOUVERTURE.md
  ],

  // ── Tables DB ────────────────────────────────────────────────────────────
  // Réécrit pour le domaine minimal — shared_cart_contributions,
  // shared_cart_estimations, cart_contributions supprimées par la
  // migration 124 ; stripe_events_processed n'est plus touché par cette
  // feature (plus de webhook shared-cart).
  db: {
    tables: [
      'basket_items: RW',
      'baskets: RW',
      'cart_shares: RW',
      'order_items: R',            // lecture pour le statut "réclamé" dérivé (migration 123)
      'products: R',
      'shared_cart_events: RW',
      'shared_cart_items: RW',
      'shared_carts: RW',
      'users: R',
    ],
  },

  security: {
    status: 'CONFIRMED_MIXED',
    note: 'Routes créateur/admin sous authenticate/requireAdmin. GET /public/:token ' +
          'reste un capability token applicatif (pas de middleware auth) — surface ' +
          'réduite au strict affichage (plus de contribution ni d\'estimation en écriture publique).',
  },
  contract: {
    exposes: [
      'GET    /api/shared-carts/public/:token',
      'POST   /api/shared-carts/from-cart-items',
      'POST   /api/shared-carts/from-basket',
      'GET    /api/shared-carts/mine',
      'GET    /api/shared-carts/:id',
      'GET    /api/shared-carts/:id/as-cart-items',
      'PUT    /api/shared-carts/:id/items',
      'POST   /api/shared-carts/:id/close',
      'POST   /api/shared-carts/:id/cancel',
      'GET    /api/admin/shared-carts',
      'GET    /api/admin/shared-carts/:id',
      'POST   /api/admin/shared-carts/:id/expire',
      'POST   /api/admin/shared-carts/:id/note',
    ],
    consumes: [
      'orders (arbitrage de la réclamation via order_items.shared_cart_item_id — feature orders, migration 123)',
      'products (lecture seule)',
      'notification (émission uniquement — WhatsApp création de liste)',
      'auth',
    ],
  },

  // ── Dette assumée / documentée ────────────────────────────────────────────
  debt: {
    knownGaps: [
      { gap: 'PUT /:id/items ne bloque pas l\'édition d\'une liste ayant déjà des ' +
             'articles réclamés (order_items.shared_cart_item_id non-NULL) : le ' +
             'DELETE+INSERT recrée des lignes shared_cart_items avec de nouveaux id, ' +
             'ce qui détache silencieusement une réclamation existante de sa ligne.',
        risk: 'Un créateur qui édite sa liste après qu\'un participant a déjà acheté ' +
              'un article casse le lien de traçabilité claimed→order pour cet article. ' +
              'La commande déjà passée reste valide (order_items conserve sa ligne), ' +
              'mais elle n\'apparaît plus liée à la liste. À trancher côté produit avant ' +
              'merge prod : bloquer l\'édition si des réclamations existent, ou l\'accepter ' +
              'comme comportement connu.',
      },
      { gap: 'Frontend boutique (js/b-group-view.js, js/group/*) et dashboard admin ' +
             '(SharedCartsView.js) non réécrits dans ce lot — référencent encore ' +
             'contributed_kmf/remaining_kmf, colonnes supprimées par la migration 124.',
        risk: 'Cassure UI garantie si la migration 124 est appliquée sans réécriture ' +
              'frontend correspondante (lot séparé, hors périmètre backend).',
      },
    ],
  },

  // ── Invariants propres ────────────────────────────────────────────────────
  invariants: [
    'un article de liste n\'est jamais réclamable deux fois — arbitré par index unique, pas par verrou applicatif (migration 123)',
    'aucune donnée financière n\'est stockée sur shared_carts — le total se calcule toujours par SUM() sur shared_cart_items',
    'lien partagé ouvre une boutique — jamais un guichet de paiement (Boutique First)',
    'annulation de liste (cancel) n\'effectue jamais de remboursement — aucune contribution n\'y transite',
  ],

  // ── Classification ────────────────────────────────────────────────────────
  classification: {
    kind:     'business-feature',
    decision: 'feature-autonome',
    signals: {
      ownsTables:          true,   // shared_carts, shared_cart_items, shared_cart_events
      ownsLifecycle:       true,   // open → closed → cancelled (3 états)
      activeService:       true,
      multiConsumer:       false,
      ownsMigrations:      true,
      externalSideEffect:  'none', // plus de paiement groupé, plus de webhook Stripe propre
      surface:             'api',
    },
    rationale: [
      'écrit dans des tables propriétaires (shared_carts, shared_cart_items)',
      'porte un cycle de vie propre à 3 états, réduit au strict nécessaire (migration 124)',
      'rend un service métier autonome : composer et partager une liste — l\'achat lui-même est délégué à la feature orders',
    ],
  },

};
