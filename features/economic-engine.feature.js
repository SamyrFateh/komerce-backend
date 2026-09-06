/**
 * @feature       economic-engine
 * @type          feature
 * @domain        economic-engine
 * @status        production
 * @owner         backend-core
 * @since         2025-09
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 * @registry      docs/doctrine/APP_FEATURE_REGISTRY.md
 */
'use strict';

module.exports = {

  // ── Identite ─────────────────────────────────────────────────────────────
  name:     'economic-engine',
  type:     'feature',   // feature | transversal
  domain:   'economic-engine',
  status:   'production',   // draft | staging | production | deprecated
  owner:    'backend-core',
  since:    '2025-09',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  classification: {
    "axis": "business",
    "kind": "business-feature",
    "decision": "feature-autonome",
    "signals": {
      "ownsTables": true,
      "ownsLifecycle": true,
      "activeService": true,
      "multiConsumer": true,
      "ownsMigrations": true,
      "externalSideEffect": "none",
      "surface": "api+service"
    },
    "rationale": [
      "possède pricing, composants de coût, stratégies versionnées et allocations ; ces décisions économiques ne sont pas des projections dashboard",
      "porte ses tables et migrations propriétaires consommées par catalog, orders et dashboard sans reprendre leurs cycles métier"
    ]
  },

  // ── Service rendu ────────────────────────────────────────────────────────
  service: 'Calculer le prix, le cout et la marge d\'un produit ou d\'une commande selon une strategie tarifaire versionnee.',

  // ── Perimetre ────────────────────────────────────────────────────────────
  perimeter: {
    in: [
      'moteur de pricing et application des regles',
      'audit des changements de prix produit dans price_history',
      'allocation de cout',
      'explicabilité canonique de chaque ligne de coût : source, hypothèse, mouvement, niveau de vérité et impact',
      'strategies tarifaires et matrices admin',
      'gestion des provisions pour risque (routes/admin-risk-provisions.js — retaggé @domain ' +
        'economic-engine au Lot O2, était @domain dashboard)',
    ],
    out: [
      'affichage produit cote catalogue (feature catalog, qui consomme economic-engine)',
      'facturation finale (feature orders)',
    ],
  },

  // ── Perimetre fichiers ───────────────────────────────────────────────────
  files: {
    utils: [
      'utils/eco-bridge.js',
      'utils/pricing-cache.js',
      'utils/relay-commission.js',
    ],
    middleware: [
      'middleware/require-pricing-global-authority.js',
    ],
    services: [
      'services/pricing-apply.js',
      'services/cost-component-admin-service.js',
      'services/cost-component-market-service.js',
      'services/pricing-cost-explainability.js',
      'services/pricing-workspace.js',
      'services/pricing-dashboard.js',
      'services/pricing-recommend.js',
      'services/dashboard-finance-metrics.js',
      'services/finance-metrics/annulations.js',
      'services/finance-metrics/finance-summary.js',
      'services/finance-metrics/index.js',
      'services/finance-metrics/payments.js',
      'services/finance-metrics/sales-analysis.js',
      'services/cost-allocation/_helpers.js',
      'services/cost-allocation/allocate.js',
      'services/cost-allocation/variance.js',
      'services/cost-allocation/index.js',
      'services/transport-cost-allocation.js',
      'services/transport-pricing.js',
      'services/pricing-guards.js',
      'services/pricing-rates.js',
      'services/pricing-output.js',
      'services/economic-engine-queries.js',
      'services/economic-config.js',
      'services/apply-pricing-updates.js',
      'services/economic-price-audit-service.js',
      'services/pricing-strategy-service.js',
      'services/pricing-engine.js',
      'services/pricing-cdr.js',
    
      'services/sourcing-analysis.js',
      'services/sourcing-mutations.js',],
    routes: [
      'routes/pricing-strategy.js',
      'routes/pricing.js',
      'routes/admin-pricing-workspace.js',
      'routes/admin-pricing-matrices.js',
      'routes/admin-cost-components.js',
      'routes/finance.js',
      'routes/dashboard-finance.js',
      'routes/admin-costing.js',
      'routes/economic.js',
      'routes/admin-finance-config.js',
      'routes/admin-pricing-components.js',
      'routes/admin-risk-provisions.js',
    
      'routes/sourcing.js',],
    migrations: [
      'migrations/019_finance_columns.sql',
      'migrations/033_parametres_extension.sql',
      'migrations/035c_fix_suppliers_stats_enum.sql',
      'migrations/036_finance_config_unification.sql',
      'migrations/037_pricing_components_risk_provisions.sql',
      'migrations/037b_pricing_components_risk_provisions_ascii.sql',
      'migrations/038_price_history.sql',
      'migrations/039_pricing_benchmarks.sql',
      'migrations/040_pricing_strategies.sql',
      // 041 et 076 (sourcing_candidates) : retirées d'ici (Lot O1.3, 2026-07-12).
      // Mal déclarées — elles créent sourcing_candidates/sourcing_candidate_events,
      // tables sans rapport avec le moteur margin/rail d'economic-engine. Déplacées
      // vers features/sourcing.feature.js. Voir docs/chantier/ pour le détail.
      'migrations/043_cost_components.sql',
      'migrations/045_allocation_averages.sql',
      'migrations/046_price_history_scenarios.sql',
      'migrations/047_calibrage_transitaire_charges.sql',
      'migrations/050_order_item_cost_imputations.sql',
      'migrations/051_order_item_real_cost_allocations.sql',
      'migrations/067_finance_config_provision_risque.sql',
      'migrations/090_cost_benchmarks.sql',
      'migrations/103_cost_benchmarks.sql',
      'migrations/119_economic_variables_to_finance_config.sql',
      'migrations/152_pricing_workspace_global_authority.sql',
      'migrations/159_cost_component_market_overrides.sql',
      'migrations/164_order_item_cost_imputations_split_n2_n3.sql',
    ],
      dash: [
      // dashboards/admin views — Lot 4
      'dashboards/admin/js/views/PricingView.js',
      'dashboards/admin/js/views/PricingStrategyView.js',
      'dashboards/admin/js/views/PricingWorkshopView.js',
      'dashboards/admin/js/views/CostingView.js',
      'dashboards/admin/js/views/EconomicView.js',
      'dashboards/admin/js/views/EconomicFlowView.js',
    ],
        tests: [
      'tests/unit/admin-cost-components.test.js',
      'tests/unit/cost-component-admin-service.test.js',
      'tests/unit/admin-costing.test.js',
      'tests/unit/admin-finance-config.test.js',
      'tests/unit/admin-pricing-components.test.js',
      'tests/unit/admin-pricing-matrices.test.js',
      'tests/unit/apply-pricing-updates.test.js',
      'tests/unit/economic-price-audit-service.test.js',
      'tests/unit/cost-allocation-variance.test.js',
      'tests/unit/order-cost-imputation-n2-n3-migration.test.js',
      'tests/unit/eco-bridge.test.js',
      'tests/unit/economic-route.test.js',
      'tests/unit/finance-annulations.test.js',
      'tests/unit/finance-route.test.js',
      'tests/unit/finance-sales-analysis.test.js',
      'tests/unit/finance-summary.test.js',
      'tests/unit/pricing-cache.test.js',
      'tests/unit/pricing-cdr.test.js',
      'tests/unit/pricing-engine.test.js',
      'tests/unit/pricing-output.test.js',
      'tests/unit/pricing-recommend.test.js',
      'tests/unit/pricing-route.test.js',
      'tests/unit/pricing-strategy-route.test.js',
      'tests/unit/sourcing-mutations.test.js',
      'tests/unit/sourcing-analysis.test.js',
      'tests/unit/finance-metrics-index.test.js',
      'tests/unit/dashboard-finance-metrics.test.js',
      'tests/unit/cost-allocation-index.test.js',
      'tests/unit/cost-allocation-helpers.test.js',
      'tests/unit/dashboard-finance-route.test.js',
      'tests/unit/pricing-strategy-service-full.test.js',
      'tests/unit/transport-pricing.test.js',
      'tests/unit/sourcing-route.test.js',
      'tests/unit/cost-allocation-allocate.test.js',
      'tests/unit/cost-allocation.test.js',
      'tests/unit/transport-cost-allocation.test.js',
      'tests/unit/economic-engine-queries.test.js',
      'tests/unit/economic-config.test.js',
      'tests/unit/economic-variables-preflight-1a4.test.js',
      'tests/unit/economic-variables-migration-119.test.js',
      'tests/unit/economic-variables-readonly-1a4.test.js',
      'tests/unit/pricing-apply.test.js',
      'tests/unit/admin-pricing-workspace-route.test.js',
      'tests/unit/admin-pricing-workspace-market-route.test.js',
      'tests/unit/cost-component-market-service.test.js',
      'tests/unit/pricing-cost-explainability.test.js',
      'tests/unit/pricing-workspace.test.js',
      'tests/unit/require-pricing-global-authority.test.js',
      'tests/unit/pricing-chain.test.js',
      'tests/unit/pricing-dashboard-truth.test.js',
      'tests/unit/pricing-flow-contract.test.js',
      'tests/unit/pricing-guards.test.js',
      'tests/unit/pricing-rates.test.js',
      'tests/unit/pricing-strategy-service.test.js',
      'tests/unit/pricing-surcharge-benchmarks.test.js',
      // Rapatrié depuis features/payment.feature.js (doublon supprimé, audit
      // 2026-07-06 §2c) : teste services/finance-metrics/payments.js
      // (déjà possédé par economic-engine ci-dessus), pas le domaine payment.
      'tests/unit/finance-payments.test.js',
      // Rapatriés depuis logistics.feature.js (Lot O1.3, 2026-07-12) : ces deux
      // fichiers testent routes/sourcing.js (moteur margin/rail admin), pas
      // routes/sourcing-scanner.js (feature sourcing) — mauvaise déclaration
      // pré-existante, corrigée par homonymie détectée pendant l'audit O1.3.
      'tests/integration/sourcing-engine-routes.test.js',
      'tests/integration/sourcing-flow-g5.test.js',
      'tests/unit/admin-risk-provisions.test.js',
    ],
  },

  // ── Contrat d'interface ──────────────────────────────────────────────────
  docs: [
    'docs/contract/PRICING_WORKSPACE_4F.md',
    'docs/adr/ADR-009-source-verite-unifiee.md',
    'docs/adr/ADR-010-pricing-reads-db.md',
    'docs/adr/ADR-011-pricing-extensible-3-niveaux.md',
    'docs/doctrine/DOCTRINE_ALLOCATION_COUTS.md',
    'docs/doctrine/DOCTRINE_DENSITE_VALEUR.md',
    'docs/doctrine/DOCTRINE_TRANSPORT_COST_ALLOCATION.md',
    'docs/doctrine/DOCTRINE_ECONOMIQUE_KOMERCE.md',
    'docs/doctrine/DOCTRINE_LEVIERS_MARGE.md',
    'docs/doctrine/DOCTRINE_MOTEUR_ECONOMIQUE_STRATEGIE.md',
    'docs/doctrine/MOTEUR_ECONOMIQUE_ALLOCATION.md',
    'docs/ops/NOTE_OPS_CALIBRATION_DENSITE_V5 (1).md',
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
      'charges: RW',
      'competitor_prices: RW',
      'cost_benchmarks: RW',
      'cost_component_events: RW',
      'cost_component_market_override_events: RW!',
      'cost_component_market_overrides: RW!',
      'cost_components: RW',
      'customs_categories: R',
      'customs_shipment_parcels: R',
      'customs_shipments: R',
      'economic_snapshots: RW!',  // OWNER (campagne WRITER-NOT-OWNER, 2026-08)
      'economic_variables: R',
      'exchange_rates: RW',
      'fabrics: R',
      'finance_config: RW',
      'garment_models: R',
      'order_item_cost_imputations: R',
      'order_item_real_cost_allocations: RW!',  // OWNER (campagne WRITER-NOT-OWNER, 2026-08) — seul écrivain réel (via services/cost-allocation/*.js)
      'order_items: R',
      'orders: R',
      'parcel_items: R',
      'parcels: R',
      'price_history: W!',  // OWNER (campagne WRITER-NOT-OWNER, 2026-08)
      'pricing_benchmarks: R',
      'pricing_category_dims: RW',
      'pricing_category_taxes: RW',
      'pricing_components: RW',
      'pricing_matrices_audit: W',
      'pricing_strategies: RW',
      'pricing_global_access_grants: R',
      'pricing_strategy_history: W',
      'product_variants: R',
      'products: R',
      'recipients: R',
      'refunds: R',
      'relais: R',
      'risk_provisions: RW',
      'store_credits: R',
      'users: R',
    ],
  },

  security: {
    status: 'CONFIRMED_MIXED',
    authedRoutesDetected: 82,
    totalRoutes: 84,
    note: "82/84 routes protégées (dont 11 routes Canonical Pricing 4F sous grant global explicite). 2 routes publiques par design : POST /api/pricing/calculate et /api/pricing/couture — configurateur de prix consommé par la boutique publique (aucun accès aux données client, calcul stateless). (+6 routes /api/admin/risk-provisions/* retaggées depuis dashboard, Lot O2)",
  },
  contract: {
    exposes: [
      'POST /api/pricing/recommend',
      'GET /api/admin/workspaces/pricing',
      'POST /api/admin/workspaces/pricing/simulate',
      'POST /api/admin/workspaces/pricing/flow',
      'POST /api/admin/workspaces/pricing/products/:productRef/apply-price',
      'GET /api/admin/workspaces/pricing/strategy',
      'POST /api/admin/workspaces/pricing/strategy/apply',
      'POST /api/admin/workspaces/pricing/competitors',
      'POST /api/admin/workspaces/pricing/competitors/:competitorRef/deactivate',
      'POST /api/admin/workspaces/pricing/cost-components',
      'POST /api/admin/workspaces/pricing/cost-components/:key/update',
      'POST /api/admin/workspaces/pricing/cost-components/:key/toggle',
      'GET /api/admin/workspaces/pricing/market/:marketCode',
      'POST /api/admin/workspaces/pricing/market/:marketCode/cost-components/:key/update',
      'POST /api/admin/workspaces/pricing/market/:marketCode/cost-components/:key/toggle',
      'POST /api/admin/workspaces/pricing/market/:marketCode/cost-components/:key/reset',
      // Rapatriées depuis le route-registry (audit 2026-07-06, lot interface-inverse)
      // — routes réelles câblées via bootstrap/api-routes.js, jamais déclarées jusqu'ici.
      'GET /api/admin/cost-components',
      'POST /api/admin/cost-components',
      'GET /api/admin/cost-components/_meta',
      'DELETE /api/admin/cost-components/:id',
      'GET /api/admin/cost-components/:id',
      'PUT /api/admin/cost-components/:id',
      'POST /api/admin/cost-components/:id/toggle',
      'GET /api/admin/economic/charges',
      'POST /api/admin/economic/charges',
      'DELETE /api/admin/economic/charges/:id',
      'PUT /api/admin/economic/charges/:id',
      'PUT /api/admin/economic/charges/:id/toggle',
      'GET /api/admin/economic/coherence',
      'GET /api/admin/economic/executive',
      'GET /api/admin/economic/history',
      'POST /api/admin/economic/redistribute',
      'GET /api/admin/economic/variables',
      'PUT /api/admin/economic/variables/:key',
      'GET /api/admin/finance-config',
      'PUT /api/admin/finance-config',
      'GET /api/admin/finance-config/schema',
      'GET /api/admin/finance/export',
      'GET /api/admin/finance/report',
      'GET /api/admin/finance/stripe-proofs',
      'GET /api/admin/finance/summary',
      'GET /api/admin/pricing-components',
      'POST /api/admin/pricing-components',
      'DELETE /api/admin/pricing-components/:id',
      'GET /api/admin/pricing-components/:id',
      'PUT /api/admin/pricing-components/:id',
      'PUT /api/admin/pricing-components/:id/toggle',
      'GET /api/admin/pricing-matrices/dims',
      'PUT /api/admin/pricing-matrices/dims/:category',
      'GET /api/admin/pricing-matrices/taxes',
      'PUT /api/admin/pricing-matrices/taxes/:category',
      'GET /api/admin/sourcing/analysis',
      'GET /api/admin/sourcing/analysis/:id',
      'POST /api/admin/sourcing/bulk-rail',
      'GET /api/admin/sourcing/config',
      'PUT /api/admin/sourcing/products/:id',
      'GET /api/admin/sourcing/products/:id/variants',
      'PUT /api/admin/sourcing/products/:id/variants',
      'GET /api/admin/sourcing/synthesis',
      // Retaggées depuis dashboard (Lot O2, 2026-07-12) — routes/admin-risk-provisions.js
      'GET /api/admin/risk-provisions',
      'POST /api/admin/risk-provisions',
      'DELETE /api/admin/risk-provisions/:id',
      'GET /api/admin/risk-provisions/:id',
      'PUT /api/admin/risk-provisions/:id',
      'PUT /api/admin/risk-provisions/:id/toggle',
      'GET /api/dashboard/annulations-parcels',
      'GET /api/dashboard/finance',
      'GET /api/dashboard/payments',
      'GET /api/dashboard/sales',
      'PUT /api/pricing/apply-all',
      'PUT /api/pricing/apply-price/:product_id',
      'GET /api/pricing/benchmarks',
      'PUT /api/pricing/benchmarks',
      'GET /api/pricing/benchmarks-gap',
      'DELETE /api/pricing/benchmarks/:category/:cost_family',
      'POST /api/pricing/calculate',
      'POST /api/pricing/couture',
      'GET /api/pricing/dashboard',
      'POST /api/pricing/flow',
      'GET /api/pricing/rates',
      'PUT /api/pricing/rates',
      'POST /api/pricing/recommend-batch',
      'GET /api/pricing/strategy',
      'POST /api/pricing/strategy/apply',
      'GET /api/pricing/strategy/competitors',
      'POST /api/pricing/strategy/competitors',
      'DELETE /api/pricing/strategy/competitors/:id',
      'GET /api/pricing/strategy/history',
    ],
    // O7.3 (provider economic-engine) : formalise les capacités cross-feature
    // explicites. Le moteur reste propriétaire de ses tables et les consumers
    // appellent ces APIs internes au lieu de porter leur SQL.
    internalApi: [
      { fn: 'recommend', file: 'services/pricing-engine.js' },
      { fn: 'recordProductPriceChange', file: 'services/economic-price-audit-service.js' },
    ],
    consumes: [
      'refunds (dépendance data cross-feature observée et gouvernée par O5)',
      'platform-ops (dépendance data cross-feature observée et gouvernée par O5)',
      'customs (dépendance data cross-feature observée et gouvernée par O5)',
      'business-rules (dépendance data cross-feature observée et gouvernée par O5)',
      'auth-identity (dépendance data cross-feature observée et gouvernée par O5)',
      'market (autorité serveur des modèles Pricing pays via markets et operator_market_scopes)',
      'infrastructure (dépendance technique transversale observée : DB, logger, helpers ou bootstrap possédés par infrastructure)',
      "logistics (FF-C1 2026-07-29 — lecture ou orchestration logistique ; preuve: services/transport-pricing.js -> services/transport-rails.js)",
'catalog (donnees produit source)',
      'auth',
      'dashboard',
      'orders',
      'loyalty (invalidation du cache de configuration finance apres modification admin — services/loyalty-service.js invalidateConfigCache, O7.3 provider loyalty)',
    ],
  },

  // ── Dette assumée / documentée ────────────────────────────────────────────
  // (audit 2026-07-06, §2a — reclassé après vérification empirique)
  debt: {
    knownGaps: [
      { gap: 'contrat historique "GET /api/pricing/:productId" : aucune route ne le sert. ' +
             'Le prix calculé n\'est pas lu à la demande par produit : il est stocké sur ' +
             'la ligne products/product_variants (price_kmf) au moment de pricing-apply.js, ' +
             'et lu directement par GET /api/products/:id (feature catalog). Aucun appelant ' +
             'connu ne fait de lookup pricing par productId séparé du catalogue.',
        risk: 'faible — probablement une intention jamais réalisée plutôt qu\'une régression. ' +
              'À confirmer par le propriétaire avant suppression définitive de la mention.',
      },
      { gap: 'RÉSOLU (2026-07-06) — routes/pricing.js déclarait GET /benchmarks à deux reprises ' +
             '(cost_benchmarks en L106, et pricing_benchmarks via pricingDashboard.listBenchmarks ' +
             'en L250, jamais atteint car Express retient la première déclaration). Le handler mort ' +
             'a été supprimé ; GET /api/pricing/benchmarks lit uniquement cost_benchmarks, comme le ' +
             'consomme réellement le front (getCostBenchmarks() dans api-client.js).',
        risk: 'faible — décision produit restante, hors gouvernance de routes : ' +
              'pricingDashboard.listBenchmarks() (table pricing_benchmarks) reste une fonction ' +
              'testée mais sans aucun point d\'entrée HTTP depuis la suppression. À exposer sous ' +
              'un nouveau chemin (ex. GET /pricing/benchmarks-catalog) ou à retirer explicitement ' +
              '— ne pas laisser en zone grise.',
      },
    ],
  },

  // ── Autorite ─────────────────────────────────────────────────────────────
  authority: 'backend-core — tout changement de formule de prix ou d audit price_history doit rester derrière les services propriétaires economic-engine',

  // ── Invariants propres ───────────────────────────────────────────────────
  invariants: [
    'une strategie tarifaire est versionnee, jamais modifiee retroactivement sur une commande deja figee',
    'aucun consommateur cross-feature ne modifie price_history directement ; l audit passe par economic-price-audit-service.js',
    'chaque ligne de coût exposée à la décision décrit sa provenance, son hypothèse, son niveau de vérité, ses moteurs de variation et son chemin d impact sans promouvoir une configuration en réel',
  ],

};