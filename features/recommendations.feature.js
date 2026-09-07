/**
 * @feature       recommendations
 * @type          feature
 * @domain        recommendations
 * @status        staging
 * @owner         backend-core
 * @since         2026-02
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 * @registry      docs/doctrine/APP_FEATURE_REGISTRY.md
 */
'use strict';

module.exports = {

  name:     'recommendations',
  type:     'feature',
  domain:   'recommendations',
  status:   'staging',
  owner:    'backend-core',
  since:    '2026-02',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  service: 'Classer et suggérer des produits boutique selon un moteur de ranking dédié. ' +
    'Compose aussi en mémoire un rail Discovery local mixte (DiscoveryCard — Product ' +
    'Komerce, produit physique tiers, service tiers) et porte sa politique éditoriale ' +
    'd’activation serveur, sans jamais posséder ni cloner les données sources.',

  perimeter: {
    in: [
      'moteur de classement boutique',
      'endpoint de suggestions',
      'DiscoveryCard — projection de lecture mixte (product|physical_offer|service), jamais persistée',
      'politique éditoriale serveur explicite du rail local : activation globale, candidats et ordre',
      'surface read-only surface=local sur la façade /api/boutique/suggestions',
    ],
    out: [
      'données produit source (feature catalog)',
      'prix affiché (feature economic-engine)',
      'vérité d’exposabilité stock/service/offre physique (local-stock / providers-services)',
      'cycle Inquiry, paiement, réservation ou settlement',
      'taxonomie ou navigation frontend parallèle pour le local',
    ],
  },

  files: {
    ci: [
      '.github/workflows/discovery-cj-local-repair.yml',
    ],
    scripts: [
      'scripts/discovery-cj-local-repair.js',
    ],
    services: [
      'services/boutique-ranking-engine.js',
      'services/discovery-rail-composer.js',
      'services/discovery-rail-service.js',
    ],
    routes: [
      'routes/boutique-suggestions.js',
    ],
    tests: [
      'tests/unit/boutique-ranking-engine.test.js',
      'tests/unit/boutique-suggestions.test.js',
      'tests/unit/discovery-rail-composer.test.js',
      'tests/unit/discovery-rail-service.test.js',
      'tests/unit/discovery-cj-local-repair.test.js',
    ],
  },

  docs: [
    'docs/doctrine/BOUTIQUE_PERSONNALISATION_NAVIGATION.md',
    'docs/doctrine/DOCTRINE_DISCOVERY_LOCALE_UNIFIEE.md',
  ],

  db: {
    tables: [
      'markets: R',
      'order_items: R',
      'orders: R',
      'parcels: R',
      'products: R',
    ],
  },

  contract: {
    exposes: [
      'GET /api/boutique/suggestions — ranking produit historique',
      'GET /api/boutique/suggestions?surface=local&market=CODE — DiscoveryCard[] read-only, [] si activation ou données absentes',
    ],
    consumes: [
      'catalog (lecture produit)',
      'platform-ops (monitoring/exploitation transverse observé dans le code)',
      'infrastructure (DB et composition root)',
      'logistics',
      'orders (frontière frontend orders-client/cart-public-api.js consommée par b-modal-suggestions.js)',
      'market (référentiel markets — résolution code -> id côté serveur)',
      'local-stock — isStockExposable() pour la carte product du rail Discovery',
      'providers-services — isServiceExposable()/getService()/isPhysicalOfferExposable()/getPhysicalOffer() pour les cartes tierces',
    ],
  },

  security: {
    status: 'CONFIRMED_PUBLIC_BY_DESIGN',
    authedRoutesDetected: 0,
    totalRoutes: 1,
    note: 'GET /api/boutique/suggestions reste la seule route HTTP. Ses deux modes sont ' +
      'read-only et publics : ranking anonyme historique, ou surface=local qui ne retourne ' +
      'que des DiscoveryCard déjà filtrées par les owners d’exposabilité. Le client fournit ' +
      'un code marché de navigation ; le service le résout côté serveur avant composition.',
  },

  authority: 'backend-core — recommendations possède le ranking et l’ordre éditorial du rail ; ' +
    'les features sources possèdent seules leur vérité métier et leur exposabilité.',

  invariants: [
    'le ranking ne modifie jamais les données produit, lecture seule sur catalog',
    { statement: 'discovery-rail-composer.js ne fait jamais de SQL direct sur les tables ' +
      'local_stock, services ou physical_offers — uniquement via les fonctions propriétaires ; ' +
      'Discovery ne possède aucune vérité, il la compose',
      test: 'tests/unit/discovery-rail-composer.test.js' },
    { statement: 'un objet non exposable est silencieusement omis du rail, jamais un objet ' +
      'd’erreur ni le pourquoi',
      test: 'tests/unit/discovery-rail-composer.test.js' },
    { statement: 'composeDiscoveryRail ne sélectionne jamais ses propres candidats — uniquement ' +
      'ceux fournis explicitement par l’appelant',
      test: 'tests/unit/discovery-rail-composer.test.js' },
    { statement: 'la surface Discovery est OFF par défaut et n’est activée que par une politique ' +
      'serveur explicite ; aucun flag d’exposition n’est détenu par le frontend',
      test: 'tests/unit/discovery-rail-service.test.js' },
    { statement: 'l’ordre du rail suit exactement la liste éditoriale serveur, y compris lorsqu’elle ' +
      'mélange product, physical_offer et service',
      test: 'tests/unit/discovery-rail-service.test.js' },
  ],

  classification: {
    kind:     'business-feature',
    decision: 'feature-autonome',
    signals: {
      ownsTables:          false,
      ownsLifecycle:       false,
      activeService:       true,
      multiConsumer:       false,
      ownsMigrations:      false,
      externalSideEffect:  'none',
      surface:             'api',
    },
    rationale: [
      'service actif identifiable (classer/suggérer), pas une projection d’une autre feature',
      'moteur de ranking dédié avec invariant lecture-seule sur catalog',
      'DiscoveryCard est une projection composée à la volée, jamais une table ni un clone',
      'la politique d’activation/ordre est une responsabilité de sélection de recommendations, ' +
        'distincte des règles métier d’exposabilité conservées dans les features sources',
    ],
  },

  // 2026-08-28 — Vague 2 D5 : composeur DiscoveryCard shadow.
  // 2026-08-30 — V2 native Boutique : activation serveur OFF par défaut,
  // sélection éditoriale explicite et façade surface=local ; le frontend reste
  // absent lorsque cards=[] (capability != exposure).

};
