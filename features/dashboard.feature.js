// features/dashboard.feature.js
// Backfill complet — 2026-06-28
// Couverture dashboard : 82 fichiers (socle + legacy)
// 16 views métier re-routées vers economic-engine, customs, catalog, shared-cart, inventory, logistics
//
// Re-routing validé 2026-06-28.
'use strict';

module.exports = {
  name:     'dashboard',
  nature:   'feature',   // feature | capability | governance-unit
  type:     'transversal',
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
  docs: [
    'docs/DASHBOARDS_360.json',
    'docs/DASHBOARDS_360.md',
    'docs/adr/ADR-002-sales-analytics-v2.md',
    'docs/adr/ADR-003-accounting-v2.md',
    'docs/adr/ADR-006-clients-view.md',
    'docs/adr/ADR-007-finance-bo-hygiene.md',
    'docs/adr/ADR-008-pilotage-split-and-sante.md',
    'docs/audit/LOT7_FINAL_PARITY.md',
    'docs/audit/batch_2.md',
    'docs/audit/batch_3.md',
    'docs/audit/batch_5.md',
    'docs/audit/batch_6.md',
    'docs/chantier/lot7_final_status.ndjson',
    'docs/design/DASHBOARD_REDESIGN.md',
    'docs/design/TOUR-DE-CONTROLE-DASHBOARDS.md',
    'docs/design/analyse-dashboard-pilotage.md',
    'docs/prompts/PROMPT_DASHBOARD_ECONOMIQUE_BOITES_FLECHES.md',
  ],

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
      'basket_items: W',
      'baskets: W',
      'business_rules: R',
      'business_rules_history: R',
      'customs_effective_rates: R',
      'customs_shipments: R',
      'exchange_rates: R',
      'incidents: R',  // W-via incident-management/incident-write-service - LOT9
      'invoices: RW',
      'loyalty_rewards: RW',
      'order_comments: RW',
      'order_incidents: RW',
      'order_item_cost_imputations: R',
      'order_item_real_cost_allocations: R',
      'order_items: RW~',  // technical-writer (campagne WRITER-NOT-OWNER, 2026-08) — écriture limitée à routes/admin/system.js (POST /reset, POST /seed-test, dev/staging uniquement, bloqué en prod sauf ALLOW_SEED=true) ; propriétaire réel : orders
      'order_status_history: RW',
      'orders: RW~',  // technical-writer (campagne WRITER-NOT-OWNER, 2026-08) — idem, routes/admin/system.js uniquement (reset/seed-test) ; propriétaire réel : orders
      'parcel_items: R',  // W-via logistics/parcel-item-mutation-service - LOT7
      'parcels: R',  // W-via logistics/parcel-mutation-service - LOT8
      'partners: RW',
      'products: RW~',  // technical-writer (campagne WRITER-NOT-OWNER, 2026-08) — idem, routes/admin/system.js uniquement (reset/seed-test) ; propriétaire réel : catalog
      'recipients: RW',
      'relais: RW',
      'scan_events: RW',
      'scans: R',  // mutations via logistics/scan-write-service ? LOT6 WNO
      'signals: R',
      'sms_log: RW',
      'suppliers_stats: R',
      'users: R',   // W-via auth-identity/user-mutation-service ? LOT12
      'wallet_transactions: W',
      'wallets: W',
    ],
  },

  security: {
    status: 'CONFIRMED_PROTECTED',
    authedRoutesDetected: 70,
    totalRoutes: 70,
    note: "70/70 routes protégées via authenticate + requireRole(['admin']) monté au niveau du routeur parent (routes/dashboard.js et routes/admin.js) — les gardes sont appliquées une fois en tête de routeur, invisibles route-par-route mais confirmées empiriquement via gen-security-360.js (analyse hybride runtime + statique). (les 6 routes /api/admin/risk-provisions/* ont été scindées vers economic-engine.feature.js, Lot O2)",
  },
  contract: {
    exposes: [
      'GET /api/admin/dashboard',
      'GET /api/dashboard/clients',
      'GET /api/dashboard/ops',
      'GET /api/dashboard/hub',
      // dashboard-shared n'est pas une route HTTP : c'est un module utilitaire
      // interne (getEurKmf, cached, setCache, loadDashConfig) importé par
      // dashboard-clients/ops/hub/finance — jamais monté seul, donc absent d'exposes.
      'GET /api/hub-dash/dashboard',
      'GET /api/relay/dashboard',
      'GET /api/admin/radar',
      // 'GET /api/admin/rules' — retiré (B2, 2026-07-29) : endpoint réel de
      // routes/admin-rules.js, propriété de business-rules.
      'GET /api/admin/loyalty/pending',
      'GET /api/admin/partners',
      'GET /api/admin/users',
      'GET /api/admin/counts',
      'POST /api/admin/reset',
      'POST /api/admin/seed-test',
      'POST /api/admin/purchasing/repair-ordered-without-pos',
      // Rapatriées depuis le route-registry (audit 2026-07-06 §3) — routes
      // réelles câblées via bootstrap/api-routes.js, jamais déclarées jusqu'ici.
      'GET /api/admin/alerts',
      'GET /api/admin/loyalty/history',
      'POST /api/admin/loyalty/reward/:id',
      'POST /api/admin/loyalty/skip/:id',
      'GET /api/admin/loyalty/stats',
      'GET /api/admin/margins',
      'POST /api/admin/partners',
      'DELETE /api/admin/partners/:id',
      'GET /api/admin/partners/:id',
      'PUT /api/admin/partners/:id',
      'GET /api/admin/partners/stats',
      'GET /api/admin/radar/alerts',
      'POST /api/admin/radar/cache/invalidate',
      'GET /api/admin/radar/money',
      'GET /api/admin/radar/orders-by-detail/:detail',
      'GET /api/admin/radar/status-details',
      // 'GET /api/admin/rules/:key', 'PATCH /api/admin/rules/:key',
      // 'POST /api/admin/rules/:key/reset', 'GET /api/admin/rules/audit'
      // — retirés (B2, 2026-07-29) : propriété business-rules.
      'POST /api/admin/users',
      'DELETE /api/admin/users/:id',
      'PUT /api/admin/users/:id/password',
      'PUT /api/admin/users/:id/role',
      'GET /api/dashboard/clients/detail',
      'GET /api/dashboard/clients/list',
      'GET /api/dashboard/forecast',
      'GET /api/dashboard/global',
      'GET /api/dashboard/history',
      'GET /api/dashboard/hub-dubai',
      'GET /api/dashboard/pilotage',
      'GET /api/dashboard/pipeline',
      'GET /api/dashboard/relais',
      'GET /api/dashboard/retards',
      'GET /api/dashboard/stats',
      'GET /api/hub-dash/orders/:id',
      'POST /api/hub-dash/orders/:id/auto-prepare',
      'POST /api/hub-dash/orders/:id/backorder',
      'POST /api/hub-dash/orders/:id/comment',
      'POST /api/hub-dash/orders/:id/create-parcel',
      'POST /api/hub-dash/orders/:id/escalate',
      'POST /api/hub-dash/orders/:id/incident',
      'POST /api/hub-dash/orders/:id/start-prep',
      'POST /api/hub-dash/parcels/:id/add-item',
      'POST /api/hub-dash/parcels/:id/ready',
      'POST /api/hub-dash/parcels/:id/remove-item',
      'POST /api/hub-dash/parcels/:id/ship',
      'GET /api/hub-dash/queue',
      'GET /api/hub-dash/validate/:id',
      'GET /api/relay/orders',
      'GET /api/relay/orders/:id',
      'PATCH /api/relay/orders/:id/client-absent',
      'POST /api/relay/orders/:id/comment',
      'POST /api/relay/orders/:id/escalate',
      'POST /api/relay/orders/:id/incident',
    ],
    consumes: [
      'incident-management (incident persistence via incident-write-service)','orders (lecture commandes)',
      'infrastructure (dépendance technique transversale observée : DB, logger, helpers ou bootstrap possédés par infrastructure)',
      'payments (lecture paiements)',
      'logistics (lecture colis)',
      'inventory (lecture stock)',
      'economic-engine (métriques financières)',
      'wallet (soldes et crédits)',
      'auth',
      'auth-identity (mutations users via services/user-mutation-service.js ? LOT12)',
      'customs',
      'documents',
      'recommendations',
      'purchasing (repare les commandes sans purchase order — services/repair-ordered-without-purchase-orders.js, O7.3 provider purchasing)',
      // Déclarations FF-C1 (2026-07-29) — arêtes réelles, dashboard est
      // business-transversal (arbitrage 2026-07-29), consommations métier ordinaires.
      'business-rules (utils/rules.js — routes/dashboard-shared.js lit une règle en vigueur)',
      'decision-signals (services/radar-queries.js — routes/admin-radar.js)',
    ],
  },

  // ── Dette assumée / documentée ──────────────────────────────────────────
  // (audit 2026-07-06 §2d — vérifié empiriquement contre le route-registry)
  debt: {
    knownGaps: [
      { gap: 'ancien contrat déclaré "GET /api/admin/dashboard/clients", "/ops", "/hub" ' +
             '(nesting sous /admin/dashboard) : aucune route ne sert ce style. Les vraies ' +
             'routes sont montées sans imbrication, sous /api/dashboard/... directement ' +
             '(routes/dashboard.js monte dashboard-ops/finance/clients/hub à la racine ' +
             '/api/dashboard, cf. bootstrap/api-routes.js:131).',
        risk: 'aucun connu, mais à vérifier côté SPA admin si un ancien build appelait ' +
              'encore le chemin imbriqué.' },
      { gap: 'ancien contrat déclaré "GET /api/dashboard" (bare, sans sous-chemin) : ' +
             'aucune route ne sert la racine elle-même — dashboardRouter ne fait que ' +
             'monter ses 4 sous-routers (ops/finance/clients/hub), sans handler propre sur "/".',
        risk: 'aucun — probablement une intention de vue d\'ensemble jamais implémentée.' },
      { gap: 'ancien contrat déclaré "GET /api/admin/system" et "GET /api/admin/index" : ' +
             'ce ne sont pas des routes, ce sont des noms de fichiers (routes/admin/system.js, ' +
             'routes/admin/index.js). admin/index.js est un pur agrégateur (aucune route ' +
             'propre, seulement des router.use(\'/\', require(...))) ; admin/system.js expose ' +
             '4 vraies routes maintenant listées ci-dessus (GET /counts, POST /reset, ' +
             'POST /seed-test, POST /purchasing/repair-ordered-without-pos), montées sous ' +
             '/api/admin via adminRouter.',
        risk: 'aucun — contrat corrigé pour refléter les 4 vraies routes.' },
      { gap: 'ONTOLOGY_GAP (Lot O1.5, 2026-07-12) — ce manifest écrit réellement dans ~15 tables ' +
             'via ses routes hub/relay/admin opérationnelles (voir db.tables, entrées W/RW : ' +
             'incidents, invoices, loyalty_rewards, order_comments, order_incidents, order_items, ' +
             'order_status_history, orders, parcel_items, parcels, partners, products, ' +
             'recipients, relais, scan_events, scans, sms_log, ' +
             'users, wallet_transactions, wallets — cf. section db ci-dessus). Ces ' +
             'mutations métier n\'ont pas leur propriétaire naturel ici : elles appartiennent aux ' +
             'domaines qu\'elles touchent (logistics pour parcels/scans/relais, orders pour ' +
             'orders/order_items, wallet pour wallets/' +
             'wallet_transactions, loyalty pour loyalty_rewards, etc.). Non redistribuées dans ce ' +
             'lot : O1 est un ontology refactor de la classification et du registre, pas un product ' +
             'refactor du code runtime — aucun fichier ni route n\'a été déplacé pour ce delta. ' +
             'MISE À JOUR (Lot O2, 2026-07-12) : purchase_orders/product_suppliers/suppliers ' +
             '(services/purchasing-admin-service.js) et risk_provisions (routes/admin-risk-' +
             'provisions.js) sont sortis de ce périmètre — retaggés respectivement vers ' +
             'purchasing et economic-engine, cf. leurs manifests.',
        risk: 'classification honnête mais transitoire : tant que ces mutations restent ici, ' +
              '`dashboard` est un cas hybride agrégation+opérations, pas un `aggregation-readonly` ' +
              'pur. Un futur lot (product refactor, hors O1) doit auditer chaque table W/RW et la ' +
              'redistribuer vers sa feature propriétaire avant que ce gap puisse se refermer.' },
    ],
  },

  // ── Autorité ───────────────────────────────────────────────────────────
  authority: 'backend-core — tout ajout de route agrégée ou de requête de métriques doit être validé par le propriétaire de dashboard-metrics.js et dashboard-cache.js',

  // ── Invariants ─────────────────────────────────────────────────────────
  invariants: [
    'dashboard agrège en lecture pour les vues de pilotage/reporting (Control Tower, Pilotage, Santé, Clients, radar, risques) : ' +
      'ces surfaces-là ne mutent aucune donnée. À l\'inverse, les routes hub/relais/admin opérationnelles (voir db.tables entrées ' +
      'W/RW) écrivent réellement — ancien invariant "lecture seule" corrigé au Lot O1.5 (2026-07-12) car contredit par le code ; ' +
      'voir debt.knownGaps pour le plan de redistribution de ces mutations vers leurs features propriétaires',
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
      'services/dashboard-ops-queries.js',
      'services/hub-dashboard-queries.js',
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
      // routes/admin-rules.js — retiré (B2, 2026-07-29) : vérité mutée
      // appartient à business-rules, pas à dashboard qui ne fait qu'agréger.
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
      'hub/js/hub.js',
      'relais/index.html',
      'relais/js/relais.js',
      'js/auth-guard.js',
      'js/parcel-components.js',
      'js/qr-viewer.js',

      // ── Socle Lot 4 : shell, API client, utils, composants ────────
      'dashboards/admin/js/app.js',
      'dashboards/admin/js/api-client.js',
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
      'js/login.js',
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
      // tests/unit/admin-rules.test.js — retiré (B2, 2026-07-29) : suit routes/admin-rules.js vers business-rules.
      'tests/unit/admin-system.test.js',
      'tests/unit/dashboard-cache.test.js',
      'tests/unit/dashboard-clients-route.test.js',
      'tests/unit/dashboard-control-tower.test.js',
      'tests/unit/dashboard-costing.test.js',
      'tests/unit/dashboard-helpers.test.js',
      'tests/unit/dashboard-hub-route.test.js',
      'tests/unit/dashboard-metrics-helpers.test.js',
      'tests/unit/dashboard-ops-route.test.js',
      'tests/unit/dashboard-route.test.js',
      'tests/unit/dashboard-shared.test.js',
      'tests/unit/hub-dashboard-queries.test.js',
      'tests/unit/hub-dashboard-route.test.js',
      'tests/unit/partners.test.js',
      'tests/unit/relay-dashboard-route.test.js',
      'tests/unit/dashboard-logistics.test.js',
      'tests/unit/dashboard-metrics-index.test.js',
      'tests/unit/system.test.js',
      'tests/unit/users.test.js',
      'tests/unit/dashboard-clients-queries.test.js',
      'tests/unit/dashboard-metrics.test.js',
      'tests/unit/dashboard-ops-queries.test.js',
      'tests/unit/relay-dashboard-queries.test.js',
    ],
  },

  // ── Classification ────────────────────────────────────────────────────────
  // Revu au Lot O1.5 (2026-07-12, Business Feature Ontology Refactor) : confirmé
  // que ce manifest n'est PAS un business-feature (kind reste 'business-transversal',
  // jamais 'business-feature'). ONTOLOGY_GAP documenté plutôt que corrigé sans audit :
  // FEATURE_DOCTRINE.md §Schéma de classification cite 'dashboard' comme exemple
  // canonique du kind 'aggregation-readonly' (lecture pure), mais ce manifest écrit
  // réellement dans ~15 tables via ses routes hub/relay/admin opérationnelles
  // (voir db.tables ci-dessus, entrées W/RW). Le classer 'aggregation-readonly' serait
  // un mensonge de header — le gate feature-classification-check.js le bloquerait
  // d'ailleurs explicitement (règle : aggregation-readonly + @db-write ≠ none).
  // 'business-transversal' + decision 'aggregation-lecture' reste donc le verdict le
  // plus honnête disponible dans le schéma actuel tant que ces mutations n'ont pas
  // été auditées et redistribuées vers leurs features propriétaires (hors périmètre
  // O1, qui est un ontology refactor et non un product refactor).
  // Delta gouvernance (2026-07-12) : le champ binaire `type` (ligne ~10) restait
  // 'feature' malgré ce verdict — incohérence corrigée en 'transversal', aligné sur
  // `kind: business-transversal`. `feature-registry-check.js` compte désormais
  // `dashboard` dans les domaines transversaux, pas dans les features métier.
  classification: {
    axis:     'business',   // business | support — seule source de la binarité
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
      'Lot O1.5 (2026-07-12) : classification business-feature explicitement écartée — dashboard ne possède ' +
        'jamais la vérité métier ni les runtime evidence des features qu\'il agrège ; voir ONTOLOGY_GAP ci-dessus ' +
        'pour l\'écart entre ce verdict et l\'exemple \'aggregation-readonly\' cité par la doctrine',
    ],
  },
};
