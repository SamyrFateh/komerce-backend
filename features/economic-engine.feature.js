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

  // ── Service rendu ────────────────────────────────────────────────────────
  service: 'Calculer le prix, le cout et la marge d\'un produit ou d\'une commande selon une strategie tarifaire versionnee.',

  // ── Perimetre ────────────────────────────────────────────────────────────
  perimeter: {
    in: [
      'moteur de pricing et application des regles',
      'allocation de cout',
      'strategies tarifaires et matrices admin',
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
    
      'utils/pricing-cache.js',],
    services: [
      'services/pricing-apply.js',
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
      'services/pricing-guards.js',
      'services/pricing-rates.js',
      'services/pricing-output.js',
      'services/economic-engine-queries.js',
      'services/apply-pricing-updates.js',
      'services/pricing-strategy-service.js',
      'services/pricing-engine.js',
      'services/pricing-cdr.js',
    
      'services/sourcing-analysis.js',
      'services/sourcing-mutations.js',],
    routes: [
      'routes/pricing-strategy.js',
      'routes/pricing.js',
      'routes/admin-pricing-matrices.js',
      'routes/admin-cost-components.js',
      'routes/finance.js',
      'routes/dashboard-finance.js',
      'routes/admin-costing.js',
      'routes/economic.js',
      'routes/admin-finance-config.js',
      'routes/admin-pricing-components.js',
    
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
      'migrations/041_sourcing_candidates.sql',
      'migrations/043_cost_components.sql',
      'migrations/045_allocation_averages.sql',
      'migrations/046_price_history_scenarios.sql',
      'migrations/047_calibrage_transitaire_charges.sql',
      'migrations/050_order_item_cost_imputations.sql',
      'migrations/051_order_item_real_cost_allocations.sql',
      'migrations/067_finance_config_provision_risque.sql',
      'migrations/076_sourcing_candidates_unique.sql',
      'migrations/090_cost_benchmarks.sql',
      'migrations/2026_cost_benchmarks.sql',
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
      'tests/unit/admin-costing.test.js',
      'tests/unit/admin-finance-config.test.js',
      'tests/unit/admin-pricing-components.test.js',
      'tests/unit/admin-pricing-matrices.test.js',
      'tests/unit/apply-pricing-updates.test.js',
      'tests/unit/cost-allocation-variance.test.js',
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
      'tests/unit/pricing-strategy-service-full.test.js',
      'tests/unit/sourcing-route.test.js',
      'tests/unit/cost-allocation-allocate.test.js',
      'tests/unit/cost-allocation.test.js',
      'tests/unit/economic-engine-queries.test.js',
      'tests/unit/pricing-apply.test.js',
      'tests/unit/pricing-chain.test.js',
      'tests/unit/pricing-dashboard-truth.test.js',
      'tests/unit/pricing-flow-contract.test.js',
      'tests/unit/pricing-guards.test.js',
      'tests/unit/pricing-rates.test.js',
      'tests/unit/pricing-strategy-service.test.js',
      'tests/unit/pricing-surcharge-benchmarks.test.js',
    ],
  },

  // ── Contrat d'interface ──────────────────────────────────────────────────
  docs: [
    'docs/adr/ADR-009-source-verite-unifiee.md',
    'docs/adr/ADR-010-pricing-reads-db.md',
    'docs/adr/ADR-011-pricing-extensible-3-niveaux.md',
    'docs/doctrine/DOCTRINE_ALLOCATION_COUTS.md',
    'docs/doctrine/DOCTRINE_DENSITE_VALEUR.md',
    'docs/doctrine/DOCTRINE_ECONOMIQUE_KOMERCE.md',
    'docs/doctrine/DOCTRINE_LEVIERS_MARGE.md',
    'docs/doctrine/DOCTRINE_MOTEUR_ECONOMIQUE_STRATEGIE.md',
    'docs/doctrine/MOTEUR_ECONOMIQUE_ALLOCATION.md',
    'docs/ops/NOTE_OPS_CALIBRATION_DENSITE_V5 (1).md',
  ],

  contract: {
    exposes: [
      'GET /api/pricing/:productId',
      'POST /api/pricing/recommend',
    ],
    consumes: ['catalog (donnees produit source)',
      'auth',
      'dashboard',
      'orders',
      'wallet',
    ],
  },

  // ── Autorite ─────────────────────────────────────────────────────────────
  authority: 'backend-core — tout changement de formule de prix doit etre valide par le proprietaire de pricing-engine.js',

  // ── Invariants propres ───────────────────────────────────────────────────
  invariants: [
    'une strategie tarifaire est versionnee, jamais modifiee retroactivement sur une commande deja figee',
  ],

};
