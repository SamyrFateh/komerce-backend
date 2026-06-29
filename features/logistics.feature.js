/**
 * @feature       logistics
 * @type          feature
 * @domain        logistics
 * @status        production
 * @owner         backend-core
 * @since         2025-08
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 * @registry      docs/doctrine/APP_FEATURE_REGISTRY.md
 */
'use strict';

module.exports = {

  // ── Identite ─────────────────────────────────────────────────────────────
  name:     'logistics',
  type:     'feature',   // feature | transversal
  domain:   'logistics',
  status:   'production',   // draft | staging | production | deprecated
  owner:    'backend-core',
  since:    '2025-08',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  // ── Service rendu ────────────────────────────────────────────────────────
  service: 'Faire transiter un colis du scan initial au retrait final, avec tracking client et transporteur.',

  // ── Perimetre ────────────────────────────────────────────────────────────
  perimeter: {
    in: [
      'scan et operations colis',
      'creation automatique de colis',
      'secrets de retrait',
      'tracking client et transitaire',
      'relais et transporteurs',
    ],
    out: [
      'cout du transport (feature economic-engine)',
      'declaration douaniere (feature customs)',
      'preuve de retrait document (feature documents, consommee ici)',
    ],
  },

  // ── Perimetre fichiers ───────────────────────────────────────────────────
  files: {
    utils: [
      'utils/parcelSync.js',
    
      'utils/parcels.js',
      'utils/pickup-receipt-html.js',],
    services: [
      'services/parcel-operations.js',
      'services/parcel-security.js',
      'services/scan-operations.js',
      'services/scan-engine.js',
      'services/auto-parcel.js',
      'services/pickup-secret-service.js',
      'services/parcel-auto-create-service.js',
      'services/parcel-guards.js',
      'services/parcelOptimizationService.js',
      'services/parcel-service.js',
    
      'services/hub-operations.js',
      'services/routing.js',],
    routes: [
      'routes/parcels.js',
      'routes/parcel-api-v2/read.js',
      'routes/parcel-api-v2/scans.js',
      'routes/parcel-api-v2/index.js',
      'routes/parcel-api-v2/helpers.js',
      'routes/transitaire-api.js',
      'routes/client-tracking.js',
      'routes/tracking.js',
      'routes/sourcing-scanner.js',
      'routes/scans.js',
      'routes/carriers.js',
      'routes/pickup-secret.js',
      'routes/parcel-label.js',
      'routes/transit-dashboard.js',
      'routes/parcel-api-v2.js',
      'routes/relais.js',
      'routes/logistics.js',
    
      'routes/auto-distribute-api.js',
      'routes/hub.js',],
    boutique: [
      'js/b-tracking.js',
    ],
      dash: [
      // dashboards/admin views — Lot 4
      'dashboards/admin/js/views/HubRelaisView.js',
      'dashboards/admin/js/views/OrdersLogisticsView.js',
    ],
    tests: [
      'tests/integration/sourcing-engine-routes.test.js',
      'tests/integration/sourcing-flow-g5.test.js',
      'tests/unit/purchasing-admin-service.test.js',
      'tests/unit/purchasing.test.js',
      'tests/unit/sourcing-analysis.test.js',
      'tests/unit/sourcing-mutations.test.js',
    ],

},

  // ── Dépôts ───────────────────────────────────────────────────────────────
  repos: {
    backend: 'services/ + routes/ ci-dessus',
    boutique: 'js/b-tracking.js — dépôt "bout", voir docs/BOUTIQUE_OWNERSHIP_LIVE.md pour le détail DOM/CSS',
  },

  // ── Contrat d'interface ──────────────────────────────────────────────────
  contract: {
    exposes: [
      'GET/POST /api/parcels',
      'POST /api/parcels/:id/scan',
      'GET /api/tracking/:code',
    ],
    consumes: [
      'orders (commande rattachee au colis)',
      'customs (statut declaration)',
    ],
  },

  // ── Autorite ─────────────────────────────────────────────────────────────
  authority: 'backend-core — tout changement de la machine de scan doit etre valide par le proprietaire de scan-engine.js',

  // ── Invariants propres ───────────────────────────────────────────────────
  invariants: [
    'un colis ne change de statut que via une sequence de scan validee',
    'secret de retrait a usage unique',
  ],

};
