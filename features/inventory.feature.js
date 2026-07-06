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

  // ── Service rendu ────────────────────────────────────────────────────────
  service: 'Suivre le niveau de stock disponible pour un produit.',

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
    
      'routes/unsold.js',],
      dash: [
      // dashboards/admin views — Lot 4
      'dashboards/admin/js/views/InventoryView.js',
    ],
        tests: [
      'tests/unit/inventory-api-route.test.js',
      'tests/unit/inventory-service.test.js',
      'tests/unit/unsold.test.js',
      'tests/integration/parcel-auto-create-cash-payment.test.js',
      'tests/parcelOptimization.test.js',
    ],
  },

  // ── Contrat d'interface ──────────────────────────────────────────────────
  docs: [],

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
      'GET /api/unsold',
      'GET /api/unsold/:id',
      'PATCH /api/unsold/:id',
      'POST /api/unsold/:id/resolve',
      'GET /api/unsold/:id/whatsapp',
      'POST /api/unsold/scan',
      'GET /api/unsold/stats/summary',
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
    'le stock ne descend jamais sous zero sans flag explicite de surventee assumee',
  ],

};
