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
  name: 'local-stock',
  nature: 'feature',
  type: 'feature',
  domain: 'local-stock',
  status: 'staging',
  owner: 'backend-core',
  since: '2026-08',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  classification: {
    axis: 'business',
    kind: 'business-feature',
    rationale: [
      'Autorité exclusive sur le stock physique vendable détenu par Komerce dans un marché ; distinct du stock hub/transit et du stock catalogue import/national.',
      'La disponibilité locale est market-scoped et peut évoluer indépendamment du cycle logistique import.',
    ],
  },

  service: 'Porter le stock physique vendable local, calculer la disponibilité nette des allocations actives, projeter une disponibilité publique minimale et engager/consommer/libérer ce stock dans le cycle commande.',

  perimeter: {
    in: [
      'table local_stock : quantité physique, marché, lieu et commercial_exposure',
      'table local_stock_allocations : engagement anti-survente avant paiement',
      'projection availability calculée AVAILABLE_NOW | UNAVAILABLE, jamais persistée',
      'projection checkout read-only LOCAL_STOCK | IMPORT | REVIEW_REQUIRED, quantité-aware et relay-scoped, jamais persistée',
      'isStockExposable() : exposure ENABLED et disponibilité nette positive',
      'cycle allocate -> consume | release, atomique avec la transaction orders',
      'ajustement opérateur du stock local, tracé via updated_by',
    ],
    out: [
      'stock hub/transit : feature inventory',
      'stock import/national : feature catalog',
      'pricing transport : feature economic/transport ; local-stock ne calcule aucun fret',
      'ETA import : domaine transport rail, jamais produit par local-stock',
      'parcels et retrait : feature logistics',
      'création et lifecycle commande : feature orders',
      'autorité transactionnelle du checkout : POST /api/orders refait toujours la résolution sous verrou',
      'réservation panier avec TTL ou cron dédié',
      'granularité variant_combo : scope product_id uniquement à ce stade',
    ],
  },

  files: {
    services: [
      'services/local-stock-service.js',
      'services/local-stock-checkout-preview.js',
    ],
    routes: [
      'routes/local-stock.js',
    ],
    tests: [
      'tests/unit/local-stock-service.test.js',
      'tests/unit/local-stock-routes.test.js',
      'tests/unit/local-stock-checkout-preview.test.js',
      'tests/unit/local-stock-fulfillment-resolver.test.js',
    ],
  },

  db: {
    tables: [
      'local_stock: RW',
      'local_stock_allocations: RW',
      'products: R',
      'markets: R',
      'relais: R',
    ],
  },

  security: {
    status: 'CONFIRMED_PUBLIC_BY_DESIGN',
    authedRoutesDetected: 0,
    totalRoutes: 2,
    note: 'GET /availability et GET /checkout-preview sont des projections publiques read-only. Elles ne renvoient ni qty_physical, ni allocations actives, ni commercial_exposure brut. Le contexte marché est toujours résolu côté serveur depuis un code marché ou le relais sélectionné.',
  },

  contract: {
    exposes: [
      'GET /api/local-stock/availability?product_id=X&market=CODE — projection Discovery minimale availability/exposable ; market CODE résolu serveur',
      'GET /api/local-stock/checkout-preview?relais_id=R&product_id=P&quantity=Q — projection checkout read-only, relais -> market_id résolu serveur, jamais une réservation',
    ],
    internalApi: [
      { fn: 'resolveCheckoutFulfillmentSources', file: 'services/local-stock-service.js' },
      { fn: 'allocateForOrderItem', file: 'services/local-stock-service.js' },
      { fn: 'consumeAllocationsForOrder', file: 'services/local-stock-service.js' },
      { fn: 'releaseAllocationsForOrder', file: 'services/local-stock-service.js' },
      { fn: 'previewCheckoutFulfillmentSources', file: 'services/local-stock-checkout-preview.js' },
    ],
    consumes: [
      'catalog : existence produit uniquement ; jamais products.stock/product_skus.stock pour la vérité locale',
      'market : résolution du code marché vers markets.id',
      'logistics : lecture de relais.market_id pour la projection checkout du relais choisi',
      'infrastructure : db.js',
    ],
  },

  authority: 'backend-core — toute règle de vérité physique locale, exposition ou engageabilité reste dans la feature local-stock.',

  invariants: [
    {
      statement: 'qty_physical ne descend jamais sous zéro',
      test: 'tests/unit/local-stock-service.test.js',
    },
    {
      statement: 'la disponibilité locale n’est jamais lue depuis products.stock ou product_skus.stock',
      test: 'tests/unit/local-stock-service.test.js',
    },
    {
      statement: 'availability, preview et allocation déduisent les allocations actives ; jamais qty_physical brut seul',
      test: 'tests/unit/local-stock-checkout-preview.test.js',
    },
    {
      statement: 'la preview checkout est read-only, sans FOR UPDATE ni réservation ; elle n’est jamais l’autorité finale',
      test: 'tests/unit/local-stock-checkout-preview.test.js',
    },
    {
      statement: 'une lane locale exposée devenue insuffisante produit REVIEW_REQUIRED en preview et local_stock_insufficient au checkout transactionnel ; jamais un fallback silencieux IMPORT',
      test: 'tests/unit/local-stock-checkout-preview.test.js',
    },
    {
      statement: 'resolveCheckoutFulfillmentSources agrège les quantités par produit et verrouille les lignes locales dans un ordre déterministe',
      test: 'tests/unit/local-stock-fulfillment-resolver.test.js',
    },
    {
      statement: 'allocate/consume/release exigent le client de transaction appelant et restent atomiques avec orders',
      test: 'tests/unit/local-stock-service.test.js',
    },
    {
      statement: 'consume et release sont idempotents ; un webhook rejoué ou une double annulation ne double jamais l’effet stock',
      test: 'tests/unit/local-stock-service.test.js',
    },
    {
      statement: 'GET /availability ne fait jamais confiance à un market_id brut client : le code marché est résolu serveur',
      test: 'tests/unit/local-stock-routes.test.js',
    },
    {
      statement: 'GET /checkout-preview ne fait jamais confiance à un market_id brut client : le marché est résolu depuis relais.market_id',
      test: 'tests/unit/local-stock-routes.test.js',
    },
    {
      statement: 'les projections publiques ne renvoient jamais qty_physical, allocations actives ou commercial_exposure brut',
      test: 'tests/unit/local-stock-routes.test.js',
    },
  ],
};