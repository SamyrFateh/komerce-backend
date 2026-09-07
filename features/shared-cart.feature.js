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
  service: 'Permettre à un créateur de publier une liste immuable par lien public ; ' +
           'chaque acheteur sélectionne une ou plusieurs lignes disponibles, ' +
           'passe par le récapitulatif puis le checkout canonique sans mélanger son panier personnel ; ' +
           'la liste se ferme automatiquement lorsque sa dernière ligne est réclamée.',

  // ── Périmètre ────────────────────────────────────────────────────────────
  perimeter: {
    in: [
      'création puis publication immuable, fermeture explicite ou automatique et annulation de la liste partagée',
      'lecture publique et propriétaire (avec statut de réclamation dérivé par jointure)',
      'réconciliation de complétion : dernière ligne réclamée => OPEN -> CLOSED',
    ],
    out: [
      'paiement carte/PayPal/cash (feature payments, consommée en sortie)',
      'arbitrage de la réclamation d\'un article (index unique order_items.shared_cart_item_id, migration 123 — feature orders)',
      'création de la commande (feature orders)',
      'crédit wallet (feature wallet)',
    ],
  },

  // ── Autorité ─────────────────────────────────────────────────────────────
  authority: 'backend-core — le domaine shared-cart est seul autorisé à écrire son lifecycle : ' +
             'close/cancel explicites via shared-cart-lifecycle.js ; fermeture automatique de complétion ' +
             'via la frontière cross-feature cart-share-service.js appelée par orders.',

  // ── Périmètre fichiers ────────────────────────────────────────────────────
  files: {
    services: [
      'services/shared-cart-engine.js',          // barrel
      'services/shared-cart-internals.js',       // CONFIG, helpers, audit
      'services/shared-cart-creation.js',        // createFromBasket, createFromCartItems, clearCreatorBasket
      'services/shared-cart-reads.js',           // getForPublic, getForOwner, listMy (total + claimed dérivés)
      'services/shared-cart-lifecycle.js',       // closeCart, cancelSharedCart
      'services/shared-cart-library.js',         // getSharedCartLibrary, saveSharedCartForUser (Amendement V2 §D)
      'services/shared-cart-queries.js',
      // Frontière publique cross-feature du domaine shared-cart (campagne
      // gouvernance WRITER-NOT-OWNER, 2026-08 ; étendue 2026-09) — orders
      // l'appelle pour cart_shares ET pour réconcilier la fermeture d'une
      // liste dont toutes les lignes viennent d'être réclamées, jamais par
      // SQL direct dans shared_carts/shared_cart_events.
      'services/cart-share-service.js',
      'services/shared-cart-user-cleanup.js', // lifecycle-owned cleanup appelé par l'admin users
    ],
    routes: [
      'routes/shared-cart.js',
      'routes/shared-cart-saved.js',    // DELETE /saved/:id — retrait explicite d'un signet « Mes listes »
      'routes/baskets.js',
      'routes/shares.js',
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
      'migrations/125_shared_cart_minimal_domain.sql',       // domaine minimal, colonnes financières retirées
      'migrations/127_shared_cart_saved_access.sql',         // bibliothèque "Mes listes" (Amendement V2 §D)
      'migrations/128_shared_list_pickup_code_recipient.sql', // destinataire vérifié du secret de retrait
      'migrations/129_shared_cart_one_open_per_organizer.sql',// cardinalité V1 : 0..1 OPEN par organisateur
      'migrations/190_shared_cart_auto_close_backfill.sql',   // répare les listes historiques 100% réclamées restées OPEN
    ],
    tests: [
      'tests/unit/baskets.test.js',
      'tests/unit/shared-cart-creation.test.js',
      'tests/unit/shared-cart-creator-route.test.js',
      'tests/unit/shared-cart-saved.test.js',
      'tests/unit/shared-cart-engine.test.js',
      'tests/unit/shared-cart-internals.test.js',
      'tests/unit/shared-cart-library.test.js',
      'tests/unit/shared-cart-public-route.test.js',
      'tests/unit/shared-cart-reads.test.js',
      'tests/unit/shares-route.test.js',
      'tests/unit/shared-cart-lifecycle.test.js',
      'tests/unit/shared-cart-queries.test.js',
      'tests/unit/cart-share-service.test.js',
      'tests/unit/shared-cart-user-cleanup.test.js',
      // NOTE (2026-08) : ces fichiers de test existent encore dans le repo
      // mais testent l'ancien domaine V4.1 (contributed_kmf, estimations,
      // awaiting_choice...) et n'ont pas encore été réécrits contre le code
      // ci-dessus. Ne pas les considérer comme couverture valide tant qu'ils
      // n'ont pas été repassés — voir LOT23_README.md de cette livraison.
    ],
    boutique: [
      // Frontend réécrit depuis (mandat de correction post-audit UX +
      // amendement V2 cartSurface, cf. PROMPT_FINAL_IMPLEMENTATION_
      // LISTE_PARTAGEABLE_SIDE_CART_V2) — liste alignée sur le manifeste
      // canonique public/boutique/features/shared-cart.feature.js.
      // Résidus retirés (introuvables sur disque, FILE-DECLARED-INEXISTANT) :
      // js/b-group-cart-flow.js, js/group/group-render-list.js (remplacé
      // par group-side-cart.js), css/group-cart-flow.css,
      // css/shared-followup.css, css/share-cart.css.
      'js/b-share-cart.js',
      'js/b-group-banner.js',
      'js/b-share-phone-guard.js',
      'js/group/group-api.js',
      'js/group/group-checkout-adapter.js',
      'js/group/group-list-labels.js',
      'js/group/group-side-cart.js',
      'js/group/group-state.js',
      'css/hero-cart-proxy.css',
      'css/shared-list-side-cart.css',
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
      'cart_shares: RW!',  // OWNER (campagne WRITER-NOT-OWNER, 2026-08)
      'order_items: R',            // lecture pour le statut "réclamé" dérivé (migration 123)
      'orders: R',                 // lecture user_id de la commande réclamante — nom acheteur, créateur uniquement
      'products: R',
      'shared_cart_events: RW',
      'shared_cart_items: RW',
      'shared_cart_saved_access: RW',   // bibliothèque "Mes listes" (Amendement V2 §D)
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
      'GET    /api/shared-carts/library',     // Amendement V2 §D
      'POST   /api/shared-carts/save',        // Amendement V2 §D
      'DELETE /api/shared-carts/saved/:sharedCartId',
      'POST   /api/shares',
      'GET    /api/shares/:token',
      'GET    /api/shared-carts/:id',
      'POST   /api/shared-carts/:id/close',
      'POST   /api/shared-carts/:id/cancel',
      'GET    /api/admin/shared-carts',
      'GET    /api/admin/shared-carts/:id',
      'POST   /api/admin/shared-carts/:id/expire',
      'POST   /api/admin/shared-carts/:id/note',
    ],
    internalApi: [
      { fn: 'deleteUserBasketData', file: 'services/shared-cart-user-cleanup.js' },
      { fn: 'markShareConvertedToOrder', file: 'services/cart-share-service.js' },
      { fn: 'closeCompletedSharedCartForOrderItems', file: 'services/cart-share-service.js' },
    ],
    consumes: [
      'recommendations (modal partagé consomme suggestions via interface /api/boutique/suggestions)',
      'platform-ops (monitoring/exploitation transverse observé dans le code)',
      'infrastructure (dépendance technique transversale observée : DB, logger, helpers ou bootstrap possédés par infrastructure)',
      'orders (arbitrage de la réclamation via order_items.shared_cart_item_id — feature orders, migration 123)',
      'catalog (lecture seule des produits)',
      'notifications (émission uniquement — WhatsApp création de liste)',
      'auth',
      'auth-identity (projection boutique : b-share-cart.js consomme identité et téléphone)',
    ],
  },

  // ── Dette assumée / documentée ────────────────────────────────────────────
  debt: {
    knownGaps: [],
  },

  // ── Invariants propres ────────────────────────────────────────────────────
  invariants: [
    'une liste publiée est un snapshot structurellement immuable : OPEN signifie achetable, jamais éditable',
    'tant que les listes V1 ne sont pas nommables, un créateur possède au maximum une liste OPEN',
    'Mon panier reste indépendant ; une seule liste OPEN peut occuper le slot partagé local',
    'une sélection de liste est locale, ne réserve rien et passe toujours par récapitulatif puis checkout canonique',
    'une commande porte soit sur PERSONAL_CART soit sur SHARED_LIST, jamais les deux',
    'un article de liste n\'est jamais réclamable deux fois — arbitré par index unique, pas par verrou applicatif (migration 123)',
    'dès que toutes les lignes possèdent un order_items.shared_cart_item_id, la liste passe automatiquement OPEN -> CLOSED ; aucun état observable 100% réclamé + OPEN',
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
      ownsLifecycle:       true,   // open → closed/cancelled ; close explicite ou automatique
      activeService:       true,
      multiConsumer:       false,
      ownsMigrations:      true,
      externalSideEffect:  'none', // plus de paiement groupé, plus de webhook Stripe propre
      surface:             'api',
    },
    rationale: [
      'écrit dans des tables propriétaires (shared_carts, shared_cart_items)',
      'porte un cycle de vie propre à 3 états, avec fermeture automatique quand la dernière ligne est réclamée',
      'rend un service métier autonome : composer et partager une liste — l\'achat lui-même est délégué à la feature orders',
    ],
  },

};