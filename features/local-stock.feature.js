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
    ],
  },

  since:    '2026-08',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  // ── Service rendu ────────────────────────────────────────────────────────
  service: 'Porter le stock physique vendable détenu par Komerce dans un ' +
    'marché donné, et projeter une disponibilité calculée — jamais ' +
    'stockée — à partir de ce stock. Shadow uniquement (Vague 1, ' +
    'IMPACT_FEATURE_FIRST_DISCOVERY_LOCALE.md) : aucune exposition ' +
    'frontend, aucun consommateur checkout/catalogue tant que ' +
    'l\'exposition n\'est pas explicitement activée.',

  // ── Perimetre ────────────────────────────────────────────────────────────
  perimeter: {
    in: [
      'table local_stock (product_id, market_id, location texte, qty_physical)',
      'projection availability calculée (AVAILABLE_NOW | UNAVAILABLE), jamais persistée',
      'ajustement du stock local par un opérateur (mutation directe, tracée updated_by)',
    ],
    out: [
      'stock hub/transit (feature inventory — inventory_items, invariant propre)',
      'stock import/national (feature catalog — products.stock, product_skus.stock)',
      'réservation de stock (L4, différé — aucun consommateur checkout aujourd\'hui)',
      'référentiel de lieux multiples (un seul entrepôt KM_MAIN au lancement — ' +
        'location est un texte, jamais une FK, tant qu\'un deuxième lieu réel n\'existe pas)',
      'granularité variant_combo (scope product_id uniquement à ce stade — ' +
        'limitation explicite, pas un oubli)',
      'toute exposition Boutique/checkout (Vague 2, hors périmètre de cette feature)',
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
      'products: R',
      'markets: R',
    ],
  },

  security: {
    status: 'NO_ROUTE_YET',
    note: 'Shadow — aucune route HTTP exposée dans cette PR. Le service est ' +
      'appelé directement (scripts/tests). Une route admin d\'ajustement ' +
      'sera un lot séparé, avec sa propre revue d\'autorisation.',
  },

  contract: {
    exposes: [
      // Aucune route HTTP dans cette PR — appel direct du service.
    ],
    consumes: [
      'catalog (produit concerné — lecture seule, jamais products.stock)',
      'market (référentiel markets — lecture seule)',
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
    { statement: 'aucune ligne local_stock n\'est visible ou consommée par un ' +
      'chemin Boutique/checkout tant que l\'exposition n\'est pas activée ' +
      '(Vague 1 = shadow strict)',
      test: 'tests/unit/local-stock-service.test.js' },
  ],

  // ── Historique ───────────────────────────────────────────────────────────
  // 2026-08-24 — création (PR A, Vague 1 Shadow). Capacité sœur d'inventory,
  // jamais une extension : voir rationale ci-dessus et
  // IMPACT_FEATURE_FIRST_DISCOVERY_LOCALE.md §2.1.

};
