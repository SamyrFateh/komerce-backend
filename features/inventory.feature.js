/**
 * @feature       inventory
 * @type          feature
 * @domain        inventory
 * @status        staging
 * @owner         backend-core
 * @since         2026-01
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 * @registry      docs/doctrine/APP_FEATURE_REGISTRY.md
 */
'use strict';

module.exports = {

  // ── Identite ─────────────────────────────────────────────────────────────
  name:     'inventory',
  type:     'feature',   // feature | transversal
  domain:   'inventory',
  status:   'staging',   // draft | staging | production | deprecated
  owner:    'backend-core',
  since:    '2026-01',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  // ── Classification ────────────────────────────────────────────────────────
  classification: {
    axis: 'business',
    kind: 'business-feature',
    decision: 'feature-autonome',
    signals: { ownsTables: true, ownsLifecycle: true, activeService: true, externalSideEffect: 'none', surface: 'api+service' },
    rationale: [
      "possède le stock hub et le cycle réception-affectation-dispatch, avec invariant de stock non négatif",
      "inventory décide l’état physique disponible au hub ; catalog, orders et logistics ne font que traverser ou consommer ce service",
    ],
  },

  // ── Service rendu ────────────────────────────────────────────────────────
  service: 'Réceptionner, affecter et dispatcher les articles au hub.',

  // ── Perimetre ────────────────────────────────────────────────────────────
  perimeter: {
    in: [
      'suivi de stock et endpoint de lecture/mise a jour',
    ],
    out: [
      'decision de publication produit (feature catalog, qui consomme inventory)',
    ],
  },

  // ── Perimetre fichiers ───────────────────────────────────────────────────
  files: {
    services: [
      'services/inventory-service.js',
    ],
    routes: [
      'routes/inventory-api.js',
    ],
      dash: [
      // dashboards/admin views — Lot 4
      'dashboards/admin/js/views/InventoryView.js',
    ],
        tests: [
      'tests/unit/inventory-api-route.test.js',
      'tests/unit/inventory-service.test.js',
      'tests/integration/parcel-auto-create-cash-payment.test.js',
      // E2E fonctionnel Feature First — inventory est PROPRIETAIRE du scenario ;
      // orders, payments, catalog et logistics sont traversees.
      'tests/e2e-api/inventory.stock-never-negative.e2e.test.js',
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
      'inventory_items: RW',
      'order_items: R',
      'orders: RW',
      'parcel_items: RW',
      'parcels: R',
      'products: R',
    ],
  },

  security: {
    status: 'CONFIRMED_PROTECTED',
    authedRoutesDetected: 8,
    totalRoutes: 8,
    note: "8/8 routes protégées via authenticate + requireRole(['admin']) ou requireAdminOrFounder. Confirmé via gen-security-360.js. " +
          "(les 7 routes /api/unsold/* ont été scindées vers unsold-resolution.feature.js, Lot O2)",
  },
  contract: {
    exposes: [
      // Rapatriées depuis le route-registry (audit 2026-07-06, lot interface-inverse)
      // — routes réelles câblées via bootstrap/api-routes.js, jamais déclarées jusqu'ici.
      'GET /api/hub/inventory/buffer',
      'GET /api/hub/inventory/open-parcels',
      'GET /api/hub/inventory/order/:id/dispatch',
      'GET /api/hub/inventory/proposals',
      'POST /api/hub/inventory/propose-all',
      'POST /api/hub/inventory/receive',
      'POST /api/hub/inventory/scan-assign',
      'GET /api/hub/inventory/stats',
    ],
    consumes: ['catalog (produit concerne)',
      'auth',
    ],
  },

  // ── Dette assumée / documentée ────────────────────────────────────────────
  // (audit 2026-07-06, §2a — reclassé après vérification empirique)
  debt: {
    knownGaps: [
      { gap: 'contrat historique "GET /api/inventory/:productId" : aucune route ne le sert. ' +
             'Le stock disponible est porté par product_variants.stock (lu via GET /api/products/:id, ' +
             'feature catalog) pour la vitrine, et par les endpoints opérationnels hub ' +
             '(GET /api/hub/inventory/*, non exposés dans ce contrat car domaine hub, pas ' +
             'consultation par produit).',
        risk: 'faible — aucune consommation connue d\'un endpoint pricing/inventory par ' +
              'productId séparé du catalogue. À confirmer avant suppression définitive.',
      },
    ],
  },

  // ── Autorite ─────────────────────────────────────────────────────────────
  authority: 'backend-core — tout changement de calcul de disponibilite doit etre valide par le proprietaire de inventory-service.js',

  // ── Invariants propres ───────────────────────────────────────────────────
  invariants: [
    { statement: 'le stock ne descend jamais sous zero sans flag explicite de surventee assumee',
      test: 'tests/e2e-api/inventory.stock-never-negative.e2e.test.js' },
  ],

  // ── Historique ───────────────────────────────────────────────────────────
  // Lot O2 (2026-07-12, BUSINESS_FEATURE_ONTOLOGY_O2) : SPLIT — routes/unsold.js,
  // tests/unit/unsold.test.js, unsold_items et v_unsold_pipeline retirés de ce
  // manifest et déplacés vers features/unsold-resolution.feature.js. Zéro
  // dépendance croisée constatée (grep croisé négatif dans les deux sens) entre
  // inventory-service.js et routes/unsold.js.

};
