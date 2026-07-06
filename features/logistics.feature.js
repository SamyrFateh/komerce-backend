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
      // ── 2026-07 : densite de valeur + qualite hub Dubai ──
      'consignes hub prescrites au scan : repack, mesure volume, photo de scelle (bornes de responsabilite)',
      'saisie volumes produits (POST /hub/volume) et photos de scelle (POST /hub/photo)',
    ],
    out: [
      'cout du transport (feature economic-engine)',
      'declaration douaniere (feature customs)',
      'preuve de retrait document (feature documents, consommee ici)',
    ],
  },

  // ── Perimetre fichiers ───────────────────────────────────────────────────
  files: {
    middleware: [
      'middleware/upload-hub.js',
    ],
    migrations: [
      'migrations/095_value_density_foundation.sql',
      'migrations/096_quality_foundation.sql',
    ],
    docs: [
      'docs/doctrine/DOCTRINE_DENSITE_VALEUR.md',
      'docs/doctrine/DOCTRINE_NON_CONFORMITE.md',
      'docs/ops/NOTE_OPS_CALIBRATION_DENSITE_V5.md',
    ],
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
      'tests/integration/test-harness/seed-helpers.js',
      'tests/unit/auto-distribute-api.test.js',
      'tests/unit/auto-parcel.test.js',
      'tests/unit/carriers.test.js',
      'tests/unit/client-tracking.test.js',
      'tests/unit/cost-allocation-helpers.test.js',
      'tests/unit/cost-allocation-index.test.js',
      'tests/unit/dashboard-logistics.test.js',
      'tests/unit/dashboard-metrics-index.test.js',
      'tests/unit/finance-metrics-index.test.js',
      'tests/unit/hub.test.js',
      'tests/unit/logistics.test.js',
      'tests/unit/parcel-api-v2-helpers.test.js',
      'tests/unit/parcel-api-v2-index.test.js',
      'tests/unit/parcel-api-v2-scans.test.js',
      'tests/unit/parcel-label.test.js',
      'tests/unit/parcel-security.test.js',
      'tests/unit/parcel-service.test.js',
      'tests/unit/parcelOptimizationService.test.js',
      'tests/unit/parcelSync.test.js',
      'tests/unit/pickup-receipt-html.test.js',
      'tests/unit/pickup-secret.test.js',
      'tests/unit/relais.test.js',
      'tests/unit/routing.test.js',
      'tests/unit/scans.test.js',
      'tests/unit/sourcing-scanner.test.js',
      'tests/unit/tracking.test.js',
      'tests/unit/transit-dashboard.test.js',
      'tests/unit/transitaire-api.test.js',
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
      'GET /api/tracking/:token',
    ],
    consumes: ['orders (commande rattachee au colis)',
      'customs (statut declaration)',
      'auth',
      'catalog',
      'economic-engine',
      'notification',
      'payment',
      'refunds',
      'wallet',
    ],
  },

  // ── Autorite ─────────────────────────────────────────────────────────────
  authority: 'backend-core — tout changement de la machine de scan doit etre valide par le proprietaire de scan-engine.js',

  // ── Invariants propres ───────────────────────────────────────────────────
  invariants: [
    'le fret maritime ne se ventile jamais au poids : volume si snapshot, repartition egale confidence low sinon',
    'un produit tague fragile ne se repacke jamais (repack_exempt) : la protection prime sur le volume',
    'la photo de scelle Dubai est la borne 1 de responsabilite : avant = fournisseur, apres = transport',
    'le systeme prescrit (repack/measure/photo), l agent execute, jamais l inverse (R2)',
    'un colis ne change de statut que via une sequence de scan validee',
    'secret de retrait a usage unique',
  ],

};
