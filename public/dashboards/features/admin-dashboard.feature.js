'use strict';
module.exports = {
  name: 'admin-dashboard', type: 'projection', domain: 'admin-dashboard',
  status: 'production', owner: 'dashboards', doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',
  service: "Tableau de bord admin SPA multi-vues.",
  perimeter: { in: ['admin/**'], out: ['API backend'] },
  // ── Classification (Lot O1.5, 2026-07-12 — delta gouvernance, aucun code déplacé) ──
  // Revalidé maintenant que le dépôt `dash` est disponible pour cette session (il ne
  // l'était pas lors du premier passage O1.5). Vérifié empiriquement sur dashboards/admin/js/** :
  // 0 accès DB direct (aucun .query/SQL — grep vide), 0 header @komerce-arch (fichiers
  // frontend, hors du schéma @db-write backend). Les seules mutations observées sont des
  // appels HTTP POST/PUT/DELETE (CategoriesView.js, ProductsView.js, CatalogApprovalView.js,
  // CustomsView.js) vers des routes API possédées par catalog/customs/orders — la mutation
  // elle-même (le INSERT/UPDATE réel) est exécutée et possédée côté backend par ces
  // features, pas ici. Verdict : projection/ui-shell au sens de FEATURE_DOCTRINE.md
  // §Schéma de classification (0 table propre, 0 cycle de vie propre, 0 service actif
  // indépendant des features qu'il affiche) — mais PAS un "rattachement" au sens strict
  // de la doctrine, faute d'un fichier backend unique où le rattacher : c'est un shell SPA
  // entier vivant dans un dépôt séparé (`dash`).
  // ONTOLOGY_GAP : `classification.kind` (ALLOWED_KINDS de feature-classification-check.js)
  // ne couvre que des manifests backend/features/ — ce script ne scanne pas public/**, et
  // son enum n'a pas de valeur pour "projection cross-repo avec manifest propre" (seul
  // "aggregation-readonly" s'en approcherait, mais sa définition doctrine — "surface
  // admin/pilotage" — vise le backend, pas un shell frontend pur). Le champ `verdict`
  // ci-dessous documente ce classement sans forcer une valeur `kind` non prévue par le
  // schéma. Non résolu ici : formaliser un schéma de classification propre au dépôt `dash`
  // est hors périmètre O1 (ontology refactor du backend), à trancher en O2 si une doctrine
  // dash-repo est créée.
  classification: {
    verdict: 'projection/ui-shell',
    rationale: [
      '0 accès DB direct dans dashboards/admin/js/** (grep .query/SQL/INSERT/UPDATE/DELETE : aucun résultat)',
      'les mutations HTTP observées (POST/PUT/DELETE dans CategoriesView.js, ProductsView.js, CatalogApprovalView.js, CustomsView.js) ciblent des routes API possédées par catalog/customs/orders — la mutation réelle est backend, pas ici',
      'aucune table propriétaire, aucune migration, aucun cycle de vie propre — ne remplit aucun des 5 signaux de FEATURE_DOCTRINE.md §Les cinq signaux pour un business-feature',
      'conserve un manifest propre (pas un rattachement classique) car shell SPA entier dans un dépôt séparé (`dash`), sans fichier backend unique où l\'attacher',
    ],
  },
  files: { js: [
    '../admin/js/api-client-unsold.js',
    '../admin/js/api-client.js',
    '../admin/js/app.js',
    '../admin/js/ClientsView.js',
    '../admin/js/components/Charts.js',
    '../admin/js/components/KpiCard.js',
    '../admin/js/components/UI.js',
    '../admin/js/filters-store.js',
    '../admin/js/product-card-model.admin.js',
    '../admin/js/utils.js',
    '../admin/js/views/AccountingView.js',
    '../admin/js/views/ActionCenterView.js',
    '../admin/js/views/CategoriesView.js',
    '../admin/js/views/CatalogApprovalView.js',
    '../admin/js/views/ClientsView.js',
    '../admin/js/views/ControlTowerView.js',
    '../admin/js/views/CostingView.js',
    '../admin/js/views/CustomsView.js',
    '../admin/js/views/EconomicFlowView.js',
    '../admin/js/views/EconomicView.js',
    '../admin/js/views/EventWorkspacesView.js',
    '../admin/js/views/HubRelaisView.js',
    '../admin/js/views/InventoryView.js',
    '../admin/js/views/InvoicesView.js',
    '../admin/js/views/OrdersLogisticsView.js',
    '../admin/js/views/PilotageFinView.js',
    '../admin/js/views/PilotageView.js',
    '../admin/js/views/PricingStrategyView.js',
    '../admin/js/views/PricingView.js',
    '../admin/js/views/PricingWorkshopView.js',
    '../admin/js/views/ProblemsView.js',
    '../admin/js/views/ProductsView.js',
    '../admin/js/views/SalesView.js',
    '../admin/js/views/SanteView.js',
    '../admin/js/views/SettingsView.js',
    '../admin/js/views/SharedCartsView.js',
    '../admin/js/views/SimulatorView.js',
    '../admin/js/views/SourcingScannerView.js',
    '../admin/js/views/SourcingView.js',
    '../admin/js/views/SuppliersView.js',
    '../admin/js/views/TransitaireView.js',
    '../admin/portal-pilotage.js',
  ]},
  contract: { exposes: [], consumes: ['sourcing'] },
  authority: 'dashboards',
  invariants: ['tout fichier admin/**/*.js doit etre declare ici'],
};
