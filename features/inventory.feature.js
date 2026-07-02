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
      'tests/unit/hub-operations.test.js',
      'tests/unit/parcel-auto-create-service.test.js',
      'tests/unit/parcel-guards.test.js',
      'tests/unit/parcel-operations.test.js',
      'tests/unit/pickup-secret-service.test.js',
    ],
  },

  // ── Contrat d'interface ──────────────────────────────────────────────────
  docs: [],

  contract: {
    exposes: [
      'GET /api/inventory/:productId',
    ],
    consumes: ['catalog (produit concerne)',
      'auth',
    ],
  },

  // ── Autorite ─────────────────────────────────────────────────────────────
  authority: 'backend-core — tout changement de calcul de disponibilite doit etre valide par le proprietaire de inventory-service.js',

  // ── Invariants propres ───────────────────────────────────────────────────
  invariants: [
    'le stock ne descend jamais sous zero sans flag explicite de surventee assumee',
  ],

};
