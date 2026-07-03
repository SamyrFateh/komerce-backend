/**
 * @feature       admin-dashboard
 * @type          feature
 * @domain        admin-dashboard
 * @status        production
 * @owner         dashboards
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 * @registry      scripts/feature-registry-check.js
 */
'use strict';

module.exports = {

  name:     'admin-dashboard',
  type:     'feature',
  domain:   'admin-dashboard',
  status:   'production',
  owner:    'dashboards',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  service: "Tableau de bord admin (SPA multi-vues) — pilotage, finance, sourcing, customs, pricing, inventory, et toutes les vues metier du back-office.",

  perimeter: {
    in:  ['dashboards/admin/** — SPA admin multi-vues'],
    out: ['API backend /api/dashboard/* (repo komerce-backend)'],
  },

  files: {
    js: [
      '../dashboards/admin/js/ClientsView.js',
      '../dashboards/admin/js/api-client-unsold.js',
      '../dashboards/admin/js/api-client.js',
      '../dashboards/admin/js/app.js',
      '../dashboards/admin/js/components/Charts.js',
      '../dashboards/admin/js/components/KpiCard.js',
      '../dashboards/admin/js/components/UI.js',
      '../dashboards/admin/js/filters-store.js',
      '../dashboards/admin/js/product-card-model.admin.js',
      '../dashboards/admin/js/utils.js',
      '../dashboards/admin/js/views/AccountingView.js',
      '../dashboards/admin/js/views/ActionCenterView.js',
      '../dashboards/admin/js/views/CategoriesView.js',
      '../dashboards/admin/js/views/CatalogApprovalView.js',
      '../dashboards/admin/js/views/ClientsView.js',
      '../dashboards/admin/js/views/ControlTowerView.js',
      '../dashboards/admin/js/views/CostingView.js',
      '../dashboards/admin/js/views/CustomsView.js',
      '../dashboards/admin/js/views/EconomicFlowView.js',
      '../dashboards/admin/js/views/EconomicView.js',
      '../dashboards/admin/js/views/EventWorkspacesView.js',
      '../dashboards/admin/js/views/HubRelaisView.js',
      '../dashboards/admin/js/views/InventoryView.js',
      '../dashboards/admin/js/views/InvoicesView.js',
      '../dashboards/admin/js/views/OrdersLogisticsView.js',
      '../dashboards/admin/js/views/PilotageFinView.js',
      '../dashboards/admin/js/views/PilotageView.js',
      '../dashboards/admin/js/views/PricingStrategyView.js',
      '../dashboards/admin/js/views/PricingView.js',
      '../dashboards/admin/js/views/PricingWorkshopView.js',
      '../dashboards/admin/js/views/ProblemsView.js',
      '../dashboards/admin/js/views/ProductsView.js',
      '../dashboards/admin/js/views/SalesView.js',
      '../dashboards/admin/js/views/SanteView.js',
      '../dashboards/admin/js/views/SettingsView.js',
      '../dashboards/admin/js/views/SharedCartsView.js',
      '../dashboards/admin/js/views/SimulatorView.js',
      '../dashboards/admin/js/views/SourcingScannerView.js',
      '../dashboards/admin/js/views/SourcingView.js',
      '../dashboards/admin/js/views/SuppliersView.js',
      '../dashboards/admin/js/views/TransitaireView.js',
      '../dashboards/admin/portal-pilotage.js',
    ],
  },

  contract: {
    exposes:  [],
    consumes: [],
  },

  authority: 'dashboards — tout changement de perimetre de ce domaine doit etre reflete ici.',

  invariants: [
    'tout fichier dashboards/admin/**/*.js portant @domain admin-dashboard doit etre liste ici',
  ],

};
