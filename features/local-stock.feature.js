/**
 * @feature       local-stock
 * @type          feature
 * @domain        local-stock
 * @status        staging
 * @owner         backend-core
 * @since         2026-08
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 * @registry      docs/doctrine/APP_FEATURE_REGISTRY.md
 */
'use strict';

module.exports = {

  // ── Identite ─────────────────────────────────────────────────────────────
  name:     'local-stock',
  nature:   'feature',   // feature | capability | governance-unit
  type:     'feature',
  domain:   'local-stock',
  status:   'staging',   // draft | staging | production | deprecated
  owner:    'backend-core',

  classification: {
    axis:     'business',   // business | support
    kind:     'business-feature',
    rationale: [
      'Autorité de mutation exclusive sur local_stock — le stock physique ' +
      'vendable détenu par Komerce dans un marché. Cycle de vie propre ' +
      '(déclaration/ajustement d\'un opérateur), distinct de celui ' +
      'd\'inventory (réception/dispatch hub, invariant "jamais négatif") et ' +
      'de catalog (products.stock/product_skus.stock, stock import/national).',
      'Frontière market-scoped dédiée : local_stock porte une quantité physique ' +
      'par marché et peut évoluer indépendamment du cycle logistique hub/transit ' +
      'et du stock catalogue import/national.',
    ],
  },

  since:    '2026-08',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  // ── Service rendu ────────────────────────────────────────────────────────
  service: 'Porter le stock physique vendable détenu par Komerce dans un ' +
    'marché donné, projeter une disponibilité calculée — jamais stockée — ' +
    'à partir de ce stock déduction faite des allocations actives, et ' +
    'engager/consommer/libérer ce stock au fil du cycle de vie d\'une ' +
    'commande (Vague 2 D2). Toujours shadow côté FRONTEND ' +
    '(IMPACT_FEATURE_FIRST_DISCOVERY_LOCALE.md, RECHALLENGE_DOCTRINE_' +
    'DISCOVERY_LOCALE_V2.md §I) : commercial_exposure reste DISABLED par ' +
    'défaut, aucune route HTTP publique, aucun composant Boutique — mais ' +
    'depuis D2, deux points d\'intégration backend délibérés et revus ' +
    '(routes/orders/create.js, order-status-machine.js) protègent déjà le ' +
    'stock réel dès la première commande, sans qu\'aucune exposition ne ' +
    'soit visible côté client.',

  // ── Perimetre ────────────────────────────────────────────────────────────
  perimeter: {
    in: [
      'table local_stock (product_id, market_id, location texte, qty_physical, ' +
        'commercial_exposure DISABLED par défaut — Vague 2 D2)',
      'table local_stock_allocations (engagement d\'une commande sur un stock ' +
        'local, avant tout paiement — Vague 2 D2)',
      'projection availability calculée (AVAILABLE_NOW | UNAVAILABLE), jamais ' +
        'persistée, déduit les allocations actives (qty_physical - SUM(actives))',
      'isStockExposable() — exposure ENABLED ET quantité réellement disponible ' +
        '(allocations actives déduites), jamais l\'un sans l\'autre',
      'ajustement du stock local par un opérateur (mutation directe, tracée updated_by)',
      'cycle allocate (création commande) -> consume (paiement confirmé) | ' +
        'release (annulation/échec/abandon) — idempotent par construction ' +
        '(WHERE consumed_at IS NULL AND released_at IS NULL), pas de ' +
        'qty_allocated matérialisé (calculé à la volée, micro-arbitrage validé)',
    ],
    out: [
      'stock hub/transit (feature inventory — inventory_items, invariant propre)',
      'stock import/national (feature catalog — products.stock, product_skus.stock)',
      'réservation panier avec TTL / expiration automatique / cron dédié ' +
        '(le release se déclenche uniquement sur un événement réel déjà émis ' +
        'par orders — annulation, échec paiement, abandon cash — jamais une ' +
        'horloge inventée par ce domaine)',
      'branchement sur unsold-resolution (étage différent : stock déjà ' +
        'CONSOMMÉ, commande jamais retirée — pas un échec avant consommation)',
      'référentiel de lieux multiples (un seul entrepôt KM_MAIN au lancement — ' +
        'location est un texte, jamais une FK, tant qu\'un deuxième lieu réel n\'existe pas)',
      'granularité variant_combo (scope product_id uniquement à ce stade — ' +
        'limitation explicite, pas un oubli)',
      'toute exposition Boutique/checkout (Vague 2, lots D3+, hors périmètre de cette feature)',
      'ETA / délai (appartient au domaine transport rail — DOCTRINE_TRANSPORT_RAILS.md ' +
        '— jamais un concept produit par local-stock)',
    ],
  },

  // ── Perimetre fichiers ───────────────────────────────────────────────────
  files: {
    services: [
      'services/local-stock-service.js',
    ],
    tests: [
      'tests/unit/local-stock-service.test.js',
    ],
  },

  // ── Tables DB ────────────────────────────────────────────────────────────
  db: {
    tables: [
      'local_stock: RW',
      'local_stock_allocations: RW',
      'products: R',
      'markets: R',
    ],
  },

  security: {
    status: 'NO_ROUTE_YET',
    note: 'Shadow côté frontend — aucune route HTTP publique dans cette PR. ' +
      'Le service est appelé directement (scripts/tests) et depuis deux ' +
      'points d\'intégration backend revus (routes/orders/create.js, ' +
      'order-status-machine.js, tous deux dans la feature orders — voir ' +
      'features/orders.feature.js contract.consumes). Une route admin ' +
      'd\'ajustement sera un lot séparé, avec sa propre revue d\'autorisation.',
  },

  contract: {
    exposes: [
      // Aucune route HTTP dans cette PR — appel direct du service.
    ],
    consumes: [
      'catalog (produit concerné — lecture seule, jamais products.stock)',
      'market (référentiel markets — lecture seule)',
      'infrastructure (dépendance technique transversale : db.js)',
    ],
  },

  // ── Autorite ─────────────────────────────────────────────────────────────
  authority: 'backend-core — tout changement du calcul de disponibilité locale ' +
    'doit être validé par le propriétaire de local-stock-service.js',

  // ── Invariants propres ───────────────────────────────────────────────────
  invariants: [
    { statement: 'qty_physical ne descend jamais sous zéro',
      test: 'tests/unit/local-stock-service.test.js' },
    { statement: 'la disponibilité n\'est jamais lue depuis products.stock ' +
      'ou product_skus.stock — uniquement depuis local_stock',
      test: 'tests/unit/local-stock-service.test.js' },
    { statement: 'availability/isStockExposable déduisent toujours les ' +
      'allocations actives (consumed_at IS NULL AND released_at IS NULL) — ' +
      'jamais qty_physical brut seul, sinon le badge mentirait sur une ' +
      'unité déjà engagée par une autre commande en cours de paiement',
      test: 'tests/unit/local-stock-service.test.js' },
    { statement: 'allocateForOrderItem/consumeAllocationsForOrder/' +
      'releaseAllocationsForOrder exigent un client de transaction explicite ' +
      '(jamais le pool global) — reste atomique avec la mutation orders qui les entoure',
      test: 'tests/unit/local-stock-service.test.js' },
    { statement: 'consume et release sont idempotents par construction ' +
      '(WHERE consumed_at IS NULL AND released_at IS NULL dans la requête ' +
      'elle-même) — un webhook rejoué ou une double annulation sont des ' +
      'no-op, jamais un double décrément ni une double libération',
      test: 'tests/unit/local-stock-service.test.js' },
    { statement: 'allocateForOrderItem verrouille la ligne local_stock ' +
      '(FOR UPDATE) avant de calculer la disponibilité — deux allocations ' +
      'concurrentes sur le même produit sont sérialisées, jamais une survente',
      test: 'tests/unit/local-stock-service.test.js (mock) + vérifié réellement ' +
        'contre Postgres, verrou bloquant confirmé par timeout' },
    { statement: 'release ne touche jamais qty_physical (l\'unité n\'a ' +
      'jamais été réellement prélevée avant consume)',
      test: 'tests/unit/local-stock-service.test.js' },
    { statement: 'aucune ligne local_stock n\'est visible ou consommée par un ' +
      'chemin Boutique/checkout tant que l\'exposition n\'est pas activée ' +
      '(shadow frontend strict, y compris après D2)',
      test: 'tests/unit/shadow-domains-boundary.test.js' },
  ],

  // ── Historique ───────────────────────────────────────────────────────────
  // 2026-08-24 — création (PR A, Vague 1 Shadow). Capacité sœur d'inventory,
  // jamais une extension : voir rationale ci-dessus et
  // IMPACT_FEATURE_FIRST_DISCOVERY_LOCALE.md §2.1.
  // 2026-08-28 — Vague 2 D2 : commercial_exposure sur local_stock, table
  // local_stock_allocations, cycle allocate/consume/release. Deux points
  // d'intégration backend délibérés dans la feature orders
  // (routes/orders/create.js, order-status-machine.js — voir
  // features/orders.feature.js contract.consumes) — jamais de logique
  // métier propriétaire migrée dans orders, orders n'est qu'un appelant.
  // Micro-arbitrage validé : pas de qty_allocated matérialisé, pas de TTL,
  // pas de branchement unsold-resolution. Voir RECHALLENGE_DOCTRINE_
  // DISCOVERY_LOCALE_V2.md §I et migration 157 pour l'arbitrage complet.

};
