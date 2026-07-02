// features/dashboard.feature.js
// Backfill complet — 2026-06-28
// Couverture dashboard : 82 fichiers (socle + legacy)
// 16 views métier re-routées vers economic-engine, customs, catalog, shared-cart, inventory, logistics
//
// Re-routing validé 2026-06-28.
'use strict';

module.exports = {
  name:     'dashboard',
  type:     'feature',
  domain:   'dashboard',
  status:   'production',
  owner:    'backend-core',
  since:    '2025-09',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  // ── Service rendu ──────────────────────────────────────────────────────
  service: 'Exposer en lecture agrégée les données opérationnelles et financières pour le contrôle total de la plateforme via les dashboards admin (Control Tower, Pilotage, Santé, Clients, Hub, Relais).',

  // ── Périmètre ──────────────────────────────────────────────────────────
  perimeter: {
    in: [
      'routes agrégées dashboard admin (KPIs, clients, opérations, hub, relais, radar, risques)',
      'queries de métriques et cache dashboard',
      'shell admin SPA + views opérationnelles (ControlTower, Pilotage, Santé, Simulator, ActionCenter)',
      'admin-legacy Control Tower v7 (actif en prod)',
      'auth-guard et composants partagés du shell admin',
    ],
    out: [
      'mutations de données (chaque feature métier owns ses mutations)',
      'logique panier, commandes, paiements (feature orders / payments / shared-cart)',
      'moteur tarifaire (feature economic-engine)',
      'views métier déléguées : PricingView, ProductsView, CategoriesView, etc.',
    ],
  },

  // ── Contrat d'interface ────────────────────────────────────────────────
  contract: {
    exposes: [
      'GET /api/admin/dashboard',
      'GET /api/admin/dashboard/clients',
      'GET /api/admin/dashboard/ops',
      'GET /api/admin/dashboard/hub',
      'GET /api/dashboard',
      'GET /api/dashboard-clients',
      'GET /api/dashboard-ops',
      'GET /api/dashboard-shared',
      'GET /api/hub-dashboard',
      'GET /api/relay-dashboard',
      'GET /api/admin-radar',
      'GET /api/admin-rules',
      'GET /api/admin-loyalty',
      'GET /api/admin-risk-provisions',
      'GET /api/admin/partners',
      'GET /api/admin/system',
      'GET /api/admin/users',
      'GET /api/admin/index',
    ],
    consumes: ['orders (lecture commandes)',
      'payments (lecture paiements)',
      'logistics (lecture colis)',
      'inventory (lecture stock)',
      'economic-engine (métriques financières)',
      'wallet (soldes et crédits)',
      'auth',
      'customs',
      'documents',
      'recommendations',
    ],
  },

  // ── Autorité ───────────────────────────────────────────────────────────
  authority: 'backend-core — tout ajout de route agrégée ou de requête de métriques doit être validé par le propriétaire de dashboard-metrics.js et dashboard-cache.js',

  // ── Invariants ─────────────────────────────────────────────────────────
  invariants: [
    'dashboard = lecture seule : aucune mutation de données dans les routes et services dashboard',
    'les métriques passent par dashboard-cache.js (pas de requêtes directes dupliquées)',
    'admin-legacy ct-app-v7.js / ct-views-v7.js sont actifs en prod — ne pas supprimer sans migration',
    'auth-guard.js protège toutes les routes admin ; aucune route admin sans vérification de token',
  ],

  // ── Vérification gouvernance ───────────────────────────────────────────
  verification: [
    'npm run dashboards:360:check',
    'npm run map:check',
  ],

  // ── Périmètre fichiers ─────────────────────────────────────────────────
  files: {
    services: [
      'services/dashboard-cache.js',
      'services/dashboard-clients-queries.js',
      'services/dashboard-metrics/_helpers.js',
      'services/dashboard-metrics/control-tower.js',
      'services/dashboard-metrics/costing.js',
      'services/dashboard-metrics/index.js',
      'services/dashboard-metrics/logistics.js',
      'services/dashboard-metrics/workspaces.js',
      'services/dashboard-ops-queries.js',
      'services/hub-dashboard-queries.js',
      'services/purchasing-admin-service.js',
      'services/relay-dashboard-queries.js',
    ],
    routes: [
      'routes/admin/dashboard.js',
      'routes/admin/index.js',
      'routes/admin/partners.js',
      'routes/admin/system.js',
      'routes/admin/users.js',
      'routes/admin-dashboard.js',
      'routes/admin-loyalty.js',
      'routes/admin-radar.js',
      'routes/admin-risk-provisions.js',
      'routes/admin-rules.js',
      'routes/admin.js',
      'routes/dashboard-clients.js',
      'routes/dashboard-hub.js',
      'routes/dashboard-ops.js',
      'routes/dashboard-shared.js',
      'routes/dashboard.js',
      'routes/hub-dashboard.js',
      'routes/relay-dashboard.js',
    ],
    migrations: [
      'migrations/071_relay_dashboard_tables.sql',
    ],
    dash: [
      // ── Entrées déclarées avant backfill ──────────────────────────
      'dashboards/admin/index.html',
      'dashboards/admin/portal-pilotage.html',
      'dashboards/admin/portal-pilotage.js',
      'hub/index.html',
      'relais/index.html',
      'js/auth-guard.js',
      'js/parcel-components.js',
      'js/qr-viewer.js',

      // ── Socle Lot 4 : shell, API client, utils, composants ────────
      'dashboards/admin/js/app.js',
      'dashboards/admin/js/api-client.js',
      'dashboards/admin/js/api-client-unsold.js',
      'dashboards/admin/js/utils.js',
      'dashboards/admin/js/filters-store.js',
      'dashboards/admin/js/product-card-model.admin.js',
      'dashboards/admin/js/ClientsView.js',
      'dashboards/admin/js/components/Charts.js',
      'dashboards/admin/js/components/KpiCard.js',
      'dashboards/admin/js/components/UI.js',

      // ── CSS Lot 4 ─────────────────────────────────────────────────
      'dashboards/admin/css/ac-styles.css',
      'dashboards/admin/css/components.css',
      'dashboards/admin/css/layout.css',
      'dashboards/admin/css/responsive.css',
      'dashboards/admin/css/shell.css',
      'dashboards/admin/css/tokens.css',

      // ── Views Lot 4 — domaine "dashboard / operations" ──────────
      'dashboards/admin/js/views/ClientsView.js',
      'dashboards/admin/js/views/SettingsView.js',
      'dashboards/admin/js/views/ActionCenterView.js',
      'dashboards/admin/js/views/ProblemsView.js',
      'dashboards/admin/js/views/SanteView.js',
      'dashboards/admin/js/views/SimulatorView.js',
      'dashboards/admin/js/views/ControlTowerView.js',
      'dashboards/admin/js/views/ProductsView.js',
      'dashboards/admin/js/views/CategoriesView.js',
      'dashboards/admin/js/views/SalesView.js',
      'dashboards/admin/js/views/PilotageView.js',
      'dashboards/admin/js/views/PilotageFinView.js',
      'dashboards/admin/js/views/AccountingView.js',
      'dashboards/admin/js/views/InvoicesView.js',

      // ── admin-legacy — ACTIF (CT v7 en prod) ─────────────────────
      'dashboards/admin-legacy/control-tower.html',
      'dashboards/admin-legacy/css/ct-inventory.css',
      'dashboards/admin-legacy/js/ct-api.js',
      'dashboards/admin-legacy/js/ct-app.js',           // deprecated v5
      'dashboards/admin-legacy/js/ct-app-v6.js',        // deprecated v6
      'dashboards/admin-legacy/js/ct-app-v7.js',        // ACTIF
      // ct-notifications.js supprimé (deprecated v5) — ref retirée 2026-07-01
      'dashboards/admin-legacy/js/ct-platform.js',
      'dashboards/admin-legacy/js/ct-scenarios.js',     // deprecated v5
      'dashboards/admin-legacy/js/ct-views.js',         // deprecated v5
      'dashboards/admin-legacy/js/ct-views-v6.js',      // deprecated v6
      'dashboards/admin-legacy/js/ct-views-v7.js',      // ACTIF
      'dashboards/admin-legacy/js/ct-views-accounting.js',
      'dashboards/admin-legacy/js/ct-views-action-center.js',
      'dashboards/admin-legacy/js/ct-views-clients.js',
      'dashboards/admin-legacy/js/ct-views-customs.js',
      'dashboards/admin-legacy/js/ct-views-dashboard-radar.js',
      'dashboards/admin-legacy/js/ct-views-economic-legacy.js',
      'dashboards/admin-legacy/js/ct-views-economic.js',
      'dashboards/admin-legacy/js/ct-views-hub-relais.js',
      'dashboards/admin-legacy/js/ct-views-inventory.js',
      'dashboards/admin-legacy/js/ct-views-pickup-secret.js',
      'dashboards/admin-legacy/js/ct-views-pilotage-fin.js',
      'dashboards/admin-legacy/js/ct-views-pilotage-op.js',
      'dashboards/admin-legacy/js/ct-views-pilotage.js',
      'dashboards/admin-legacy/js/ct-views-previsions.js',
      'dashboards/admin-legacy/js/ct-views-pricing-strategy.js',
      'dashboards/admin-legacy/js/ct-views-pricing-workshop.js',
      'dashboards/admin-legacy/js/ct-views-pricing.js',
      'dashboards/admin-legacy/js/ct-views-problems.js',
      'dashboards/admin-legacy/js/ct-views-sales.js',
      'dashboards/admin-legacy/js/ct-views-sante.js',
      'dashboards/admin-legacy/js/ct-views-settings.js',
      'dashboards/admin-legacy/js/ct-views-shared-carts.js',
      'dashboards/admin-legacy/js/ct-views-simulator.js',
      'dashboards/admin-legacy/js/ct-views-sourcing-scanner.js',
      'dashboards/admin-legacy/js/ct-views-sourcing.js',
      'dashboards/admin-legacy/js/ct-views-suppliers.js',
      'dashboards/admin-legacy/js/ct-views-transitaire.js',

      // ── Racine public/ ────────────────────────────────────────────
      'login.html',
      'manifest.json',
      'sw.js',
      'chart.umd.min.js',
      'css/ct-inventory.css',
    ],
    tests: [
      'tests/test-dashboard.js',
      'tests/unit/admin-costing-full.test.js',
      'tests/unit/admin-dashboard-route.test.js',
      'tests/unit/admin-dashboard.test.js',
      'tests/unit/admin-facades-route.test.js',
      'tests/unit/admin-loyalty.test.js',
      'tests/unit/admin-orders-route.test.js',
      'tests/unit/admin-radar.test.js',
      'tests/unit/admin-risk-provisions.test.js',
      'tests/unit/admin-rules.test.js',
      'tests/unit/admin-system.test.js',
      'tests/unit/dashboard-cache.test.js',
      'tests/unit/dashboard-clients-route.test.js',
      'tests/unit/dashboard-control-tower.test.js',
      'tests/unit/dashboard-costing.test.js',
      'tests/unit/dashboard-finance-route.test.js',
      'tests/unit/dashboard-helpers.test.js',
      'tests/unit/dashboard-hub-route.test.js',
      'tests/unit/dashboard-metrics-helpers.test.js',
      'tests/unit/dashboard-ops-route.test.js',
      'tests/unit/dashboard-route.test.js',
      'tests/unit/dashboard-shared.test.js',
      'tests/unit/dashboard-workspaces.test.js',
      'tests/unit/hub-dashboard-queries.test.js',
      'tests/unit/hub-dashboard-route.test.js',
      'tests/unit/partners.test.js',
      'tests/unit/relay-dashboard-route.test.js',
      'tests/unit/system.test.js',
      'tests/unit/users.test.js',
      'tests/unit/dashboard-clients-queries.test.js',
      'tests/unit/dashboard-finance-metrics.test.js',
      'tests/unit/dashboard-metrics.test.js',
      'tests/unit/dashboard-ops-queries.test.js',
      'tests/unit/radar-queries.test.js',
      'tests/unit/relay-dashboard-queries.test.js',
    ],
  },

  // ── Classification ────────────────────────────────────────────────────────
  classification: {
    kind:     'business-transversal',
    decision: 'aggregation-lecture',
    signals: {
      ownsTables:          false, // pas de tables propriétaires — agrège les données des features métier
      ownsLifecycle:       false,
      activeService:       false, // agréger = passif pour l'essentiel
      multiConsumer:       false, // c'est dashboard qui consomme les autres, pas l'inverse
      ownsMigrations:      false,
      externalSideEffect:  'none',
      surface:             'api+spa',
    },
    rationale: [
      'pas de table propriétaire — consomme les données des features métier sans les posséder',
      'lifecycle UI indépendant (SPA admin/hub/relais) justifie un manifest propre vs rattachement',
      'certaines routes admin opérationnelles (hub, relay) écrivent des données — pas strictement lecture seule',
      'cas particulier : agrégation + opérations admin — business-transversal reflète mieux la réalité',
    ],
  },
};
