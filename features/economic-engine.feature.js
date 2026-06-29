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
  contract: {
    exposes: [
      'GET /api/pricing/:productId',
      'POST /api/pricing/recommend',
    ],
    consumes: [
      'catalog (donnees produit source)',
    ],
  },

  // ── Autorite ─────────────────────────────────────────────────────────────
  authority: 'backend-core — tout changement de formule de prix doit etre valide par le proprietaire de pricing-engine.js',

  // ── Invariants propres ───────────────────────────────────────────────────
  invariants: [
    'une strategie tarifaire est versionnee, jamais modifiee retroactivement sur une commande deja figee',
  ],

};
