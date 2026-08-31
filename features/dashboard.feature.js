// features/dashboard.feature.js
// Backfill complet — 2026-06-28
// Couverture dashboard : socle backend + deux générations UI legacy + canonical greenfield
// 16 views métier re-routées vers economic-engine, customs, catalog, shared-cart, inventory, logistics
//
// Re-routing validé 2026-06-28. Frontière Legacy / Canonical figée en LOT 2-RESET (2026-08).
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
  service: 'Exposer les agrégats de pilotage et porter la transition UI vers un admin canonique greenfield, global pour Komerce et strictement scopé par marché pour les partenaires opérateurs pays, sans réutiliser les deux générations historiques de dashboards.',

  // ── Périmètre ──────────────────────────────────────────────────────────
  perimeter: {
    in: [
      'routes agrégées dashboard admin (KPIs, clients, opérations, hub, relais, radar, risques)',
      'queries de métriques et cache dashboard',
      'Legacy 1 : public/dashboards/admin/** — runtime actuel, gelé en maintenance corrective et rollback uniquement',
      'Legacy 0 : public/dashboards/admin-legacy/** — génération antérieure deprecated, conservation historique/rollback',
      'Canonical : public/dashboards/canonical/** — seule cible autorisée pour tout nouveau développement dashboard',
      'AdminContext canonical — projection UI d\'une autorité market déjà résolue côté serveur, jamais une source d\'autorisation locale',
      'auth-guard et composants partagés des runtimes historiques tant qu’ils restent servis',
    ],
    out: [
      'mutations de données (chaque feature métier owns ses mutations)',
      'logique panier, commandes, paiements (feature orders / payments / shared-cart)',
      'moteur tarifaire (feature economic-engine)',
      'nouveau développement dashboard sous public/dashboards/admin/** ou public/dashboards/admin-legacy/** hors correctif explicite',
      'import ou héritage UI de admin/** ou admin-legacy/** depuis canonical/**',
      'migration écran-par-écran des anciennes vues : elles sont des sources de besoins, pas des unités à porter',
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
      'docs/doctrine/DOCTRINE_ADMIN_DASHBOARDS.md',
      'docs/contract/DASHBOARD_MARKET_SCOPE_2C.md',
      'docs/contract/ACTION_CENTER_4G.md',
      'docs/contract/CLIENT_INDEX_4I.md',
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
      'business_rules: R',
      'business_rules_history: R',
      'client_notifications: R',
      'customs_effective_rates: R',
      'customs_shipments: R',
      'exchange_rates: R',
      'incidents: R',  // W-via incident-management/incident-write-service - LOT9
      'invoices: RW',
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
      'transaction_documents: R',
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
      'GET /api/admin/demo/orders/:orderId/timeline',
      'GET /api/dashboard/clients',
      'GET /api/admin/entities/clients',
      'GET /api/admin/entities/clients/market/:marketCode',
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
      'GET /api/admin/partners',
      'GET /api/admin/users',
      'GET /api/admin/counts',
      'POST /api/admin/reset',
      'POST /api/admin/seed-test',
      'POST /api/admin/purchasing/repair-ordered-without-pos',
      // Rapatriées depuis le route-registry (audit 2026-07-06 §3) — routes
      // réelles câblées via bootstrap/api-routes.js, jamais déclarées jusqu'ici.
      'GET /api/admin/alerts',
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
      'shared-cart (suppression des paniers utilisateur via API interne lifecycle-owned)',
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
      'notifications (réconciliation idempotente des jalons client affichés dans le cockpit de démo)',
      'purchasing (repare les commandes sans purchase order — services/repair-ordered-without-purchase-orders.js, O7.3 provider purchasing)',
      // Déclarations FF-C1 (2026-07-29) — arêtes réelles, dashboard est
      // business-transversal (arbitrage 2026-07-29), consommations métier ordinaires.
      'business-rules (utils/rules.js — routes/dashboard-shared.js lit une règle en vigueur)',
      'decision-signals (services/radar-queries.js — routes/admin-radar.js)',
      'market (autorité horizontale des partenaires pays via requireMarketScope et operator_market_scopes)',
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
    'Legacy 0 public/dashboards/admin-legacy/** est deprecated et ne reçoit aucun nouveau développement',
    'Legacy 1 public/dashboards/admin/** reste servi mais est gelé : correctifs et rollback uniquement, aucune nouvelle capacité dashboard',
    'Canonical public/dashboards/canonical/** est la seule cible de développement des quatre dashboards futurs : Pilotage, Commerce, Opérations, Finance',
    'canonical/** ne référence ni n’importe aucun code ou CSS de admin/** ou admin-legacy/** ; les anciennes vues ne servent que de sources de besoins',
    '/admin-next sert canonical pendant la construction ; les routes /admin/* restent sur Legacy 1 jusqu’au cutover explicitement validé',
    'auth-guard.js protège toutes les routes admin historiques ; canonical valide sa session au bootstrap et ne contourne jamais /api/auth/me',
    'Komerce central et les partenaires pays partagent le même runtime canonical : aucune variante ou copie par marché',
    'le rôle vertical ne donne jamais un scope pays ; toute autorité market est résolue côté serveur puis appliquée avant agrégation',
    'un filtre pays du DashboardSchema est présentationnel : canonical ne charge jamais un agrégat global pour le filtrer ensuite côté client',
      'market est l\'unité de délégation business ; corridor reste une dimension technique/logistique sans autorité',
    'le cockpit Démo / Staging ne possède aucune transition : il délègue à la route orders et lit les notifications/documents réellement persistés',
  ],

  // ── Vérification gouvernance ───────────────────────────────────────────
  verification: [
    'npx jest tests/unit/canonical-dashboard-boundary.test.js --runInBand',
    'npx jest tests/unit/canonical-dashboard-primitives.test.js --runInBand',
    'npx jest tests/unit/canonical-dashboard-schema-renderer.test.js --runInBand',
    'npx jest tests/unit/canonical-dashboard-admin-context.test.js --runInBand',
    'npx jest tests/unit/admin-demo-order-flow.test.js tests/unit/canonical-demo-order-flow.test.js --runInBand',
    'npm run dashboards:360:check',
    'npm run map:check',
  ],

  // ── Périmètre fichiers ─────────────────────────────────────────────────
  files: {
    middleware: [
      'middleware/require-dashboard-global-authority.js',
    ],
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
      'services/finance-accounting-workspace.js',
      'services/partner-admin-service.js',
      'services/client-360.js',
      'services/client-index.js',
      'services/dashboard-admin-context.js',
      'services/dashboard-commerce.js',
      'services/dashboard-finance-canonical.js',
      'services/dashboard-operations.js',
      'services/dashboard-pilotage-market.js',
      'services/operations-workspace.js',
      'services/order-360.js',
      'services/product-360.js',
      'services/shipping-customs-workspace.js',
    ],
    routes: [
      'routes/admin/dashboard.js',
      'routes/admin/demo-order-flow.js',
      'routes/admin/index.js',
      'routes/admin/partners.js',
      'routes/admin/system.js',
      'routes/admin/users.js',
      'routes/admin-dashboard.js',
      'routes/admin-client-360.js',
      'routes/admin-client-index.js',
      'routes/admin-dashboard-market.js',
      'routes/admin-operations-workspace.js',
      'routes/admin-order-360.js',
      'routes/admin-product-360.js',
      'routes/admin-shipping-customs-workspace.js',
      'routes/admin-finance-accounting-workspace.js',
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
      'migrations/151_partner_business_ref.sql',
    ],
    dash: [
      // ── Canonical — seule cible de nouveau développement dashboard ──
      'dashboards/canonical/index.html',
      'dashboards/canonical/css/base.css',
      'dashboards/canonical/css/renderer.css',
      'dashboards/canonical/css/demo-order-flow.css',
      'dashboards/canonical/js/app.js',
      'dashboards/canonical/js/navigation.js',
      'dashboards/canonical/js/primitives.js',
      'dashboards/canonical/js/dashboard-schema.js',
      'dashboards/canonical/js/dashboard-renderer.js',
      'dashboards/canonical/js/admin-context.js',
      'dashboards/canonical/js/demo-order-flow.js',
      'dashboards/canonical/js/finance-accounting-workspace.js',
      'dashboards/canonical/js/sourcing-workspace.js',
      'dashboards/canonical/js/pricing-workspace.js',
      'dashboards/canonical/js/action-center.js',
      'dashboards/canonical/js/client-index.js',

      // ── Legacy 1 — admin actuel, gelé maintenance corrective ──────
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

      // ── Socle Legacy 1 : shell, API client, utils, composants ─────
      'dashboards/admin/js/app.js',
      'dashboards/admin/js/api-client.js',
      'dashboards/admin/js/utils.js',
      'dashboards/admin/js/filters-store.js',
      'dashboards/admin/js/product-card-model.admin.js',
      'dashboards/admin/js/ClientsView.js',
      'dashboards/admin/js/components/Charts.js',
      'dashboards/admin/js/components/KpiCard.js',
      'dashboards/admin/js/components/UI.js',

      // ── CSS Legacy 1 ───────────────────────────────────────────────
      'dashboards/admin/css/ac-styles.css',
      'dashboards/admin/css/components.css',
      'dashboards/admin/css/layout.css',
      'dashboards/admin/css/responsive.css',
      'dashboards/admin/css/shell.css',
      'dashboards/admin/css/tokens.css',

      // ── Views Legacy 1 ─────────────────────────────────────────────
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

      // ── Legacy 0 — génération antérieure deprecated ────────────────
      'dashboards/admin-legacy/control-tower.html',
      'dashboards/admin-legacy/css/ct-inventory.css',
      'dashboards/admin-legacy/js/ct-api.js',
      'dashboards/admin-legacy/js/ct-app.js',           // deprecated v5
      'dashboards/admin-legacy/js/ct-app-v6.js',        // deprecated v6
      'dashboards/admin-legacy/js/ct-app-v7.js',        // dernier runtime historique
      // ct-notifications.js supprimé (deprecated v5) — ref retirée 2026-07-01
      'dashboards/admin-legacy/js/ct-platform.js',
      'dashboards/admin-legacy/js/ct-scenarios.js',
      'dashboards/admin-legacy/js/ct-views.js',
      'dashboards/admin-legacy/js/ct-views-v6.js',
      'dashboards/admin-legacy/js/ct-views-v7.js',
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
      'tests/unit/admin-demo-order-flow.test.js',
      'tests/unit/admin-facades-route.test.js',
      'tests/unit/admin-loyalty.test.js',
      'tests/unit/admin-orders-route.test.js',
      'tests/unit/admin-radar.test.js',
      // tests/unit/admin-rules.test.js — retiré (B2, 2026-07-29) : suit routes/admin-rules.js vers business-rules.
      'tests/unit/admin-system.test.js',
      'tests/unit/canonical-dashboard-boundary.test.js',
      'tests/unit/canonical-dashboard-primitives.test.js',
      'tests/unit/canonical-dashboard-schema-renderer.test.js',
      'tests/unit/canonical-dashboard-admin-context.test.js',
      'tests/unit/canonical-navigation.test.js',
      'tests/unit/canonical-demo-order-flow.test.js',
      'tests/unit/canonical-finance-accounting-workspace-boundary.test.js',
      'tests/unit/canonical-sourcing-workspace-boundary.test.js',
      'tests/unit/canonical-action-center-boundary.test.js',
      'tests/unit/partner-admin-service.test.js',
      'tests/unit/require-dashboard-global-authority.test.js',
      'tests/unit/admin-client-360-route.test.js',
      'tests/unit/admin-client-index-route.test.js',
      'tests/unit/client-index-service.test.js',
      'tests/unit/canonical-client-index.test.js',
      'tests/unit/admin-dashboard-market.test.js',
      'tests/unit/admin-operations-workspace-route.test.js',
      'tests/unit/admin-order-360-route.test.js',
      'tests/unit/admin-product-360-route.test.js',
      'tests/unit/admin-shipping-customs-workspace-route.test.js',
      'tests/unit/client-360-service.test.js',
      'tests/unit/dashboard-admin-context.test.js',
      'tests/unit/dashboard-commerce.test.js',
      'tests/unit/dashboard-finance-canonical.test.js',
      'tests/unit/dashboard-operations.test.js',
      'tests/unit/dashboard-pilotage-market.test.js',
      'tests/unit/operations-workspace-service.test.js',
      'tests/unit/order-360-service.test.js',
      'tests/unit/product-360-service.test.js',
      'tests/unit/shipping-customs-workspace.test.js',
      'tests/unit/canonical-pricing-workspace-boundary.test.js',
      'tests/unit/finance-accounting-workspace.test.js',
      'tests/unit/admin-finance-accounting-workspace-route.test.js',
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
  classification: {
    axis:     'business',
    kind:     'business-transversal',
    decision: 'aggregation-lecture',
    signals: {
      ownsTables:          false,
      ownsLifecycle:       false,
      activeService:       false,
      multiConsumer:       false,
      ownsMigrations:      false,
      externalSideEffect:  'none',
      surface:             'api+spa',
    },
    rationale: [
      'pas de table propriétaire — consomme les données des features métier sans les posséder',
      'le domaine contient encore des routes opérationnelles historiques hybrides ; la nouvelle projection canonical est isolée sans prétendre effacer cette dette backend',
      'les deux générations UI historiques sont gelées et le nouveau développement est physiquement séparé sous public/dashboards/canonical/**',
      'dashboard ne possède jamais la vérité métier ni les runtime evidence des features qu’il agrège',
    ],
  },
};
