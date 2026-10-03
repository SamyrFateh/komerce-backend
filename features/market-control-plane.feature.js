/**
 * @feature       market-control-plane
 * @type          feature
 * @domain        market-control-plane
 * @status        staging
 * @owner         backend-core
 * @since         2026-10
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 * @registry      docs/doctrine/APP_FEATURE_REGISTRY.md
 */
'use strict';

module.exports = {
  name: 'market-control-plane',
  type: 'feature',
  domain: 'market-control-plane',
  status: 'staging',
  owner: 'backend-core',
  since: '2026-10',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  classification: {
    axis: 'business',
    kind: 'business-feature',
    decision: 'feature-autonome',
    signals: {
      ownsTables: false,
      ownsLifecycle: false,
      activeService: true,
      multiConsumer: false,
      ownsMigrations: false,
      externalSideEffect: 'none',
      surface: 'service+api',
    },
    rationale: [
      'Vue centrale unique de ce qui existe et de ce qui manque pour un marché : affectation, équipe, plafond, paiement, caisse, relais.',
      'Lecture seule : la carte market reste un référentiel pur et market-delegation reste le seul moteur d’autorisation.',
      'Point d’entrée du chantier Market Control Plane (rapport d’écarts de référence pour les PR suivantes, jusqu’à « Créer un nouveau marché »).',
    ],
  },

  service: 'Montrer à l’administration centrale, pour chaque marché, l’état réel de sa mise en exploitation et la liste explicite des écarts, sans rien écrire ni décider d’autorisation.',

  perimeter: {
    in: [
      'GET /api/admin/markets : liste des marchés avec statut d’affectation et nombre de personnes actives',
      'GET /api/admin/markets/central-authority : titulaires actifs des cinq autorisations centrales explicites (dashboard, catalog, decision_signal, pricing, sourcing) et autorité déclarée de chaque capability de groupe',
      'GET /api/admin/markets/:marketCode/control-plane : affectation, équipe et capacités, plafond, fournisseurs de paiement, politique de caisse, relais actifs, écarts',
      'rapport d’écarts calculé (computeGaps) : MARKET_INACTIVE, NO_ASSIGNMENT, ASSIGNMENT_NOT_ACTIVE, EMPTY_CEILING, NO_ACTIVE_MEMBERSHIP, NO_TEAM_GRANT_HOLDER, NO_PAYMENT_PROVIDER, NO_CASH_POLICY, NO_RELAIS',
    ],
    out: [
      'toute écriture (création, suspension, délégation, correction d’un écart) : PR suivantes du chantier, services propriétaires',
      'décision d’autorisation : market-delegation reste le seul moteur ; cette vue n’autorise rien',
      'référentiel markets et devise : feature market (référentiel pur)',
      'accès d’un opérateur pays à sa propre vue : hors lot, la vue est centrale',
      'cycle de vie PROVISIONING/ACTIVE/SUSPENDED/CLOSED et responsable opérationnel : lots E et F du chantier (migrations)',
    ],
  },

  files: {
    services: [
      'services/market-control-plane.js',
      'services/central-authority.js',
    ],
    routes: [
      'routes/admin-market-control-plane.js',
    ],
    tests: [
      'tests/unit/market-control-plane-service.test.js',
      'tests/unit/admin-market-control-plane-routes.test.js',
      'tests/unit/central-authority.test.js',
    ],
  },

  db: {
    tables: [
      'markets: R',
      'market_operating_assignments: R',
      'assignment_memberships: R',
      'membership_capabilities: R',
      'assignment_capability_ceiling: R',
      'market_payment_providers: R',
      'market_cash_control_policies: R',
      'relais: R',
      'dashboard_global_access_grants: R',
      'catalog_global_access_grants: R',
      'decision_signal_global_access_grants: R',
      'pricing_global_access_grants: R',
      'sourcing_global_access_grants: R',
    ],
  },

  security: {
    status: 'CONFIRMED_PROTECTED',
    authedRoutesDetected: 3,
    totalRoutes: 3,
    note: 'Les 3 routes exigent authenticate + rôle admin, déclaré « central par rôle » (décision Q4 du chantier). Aucune écriture.',
  },

  contract: {
    exposes: [
      'GET /api/admin/markets', // admin central
      'GET /api/admin/markets/central-authority', // admin central
      'GET /api/admin/markets/:marketCode/control-plane', // admin central
    ],
    internalApi: [
      'listMarkets()',
      'getControlPlane()',
      'computeGaps()',
      'central()',
      'overview()',
    ],
    consumes: [
      'market (markets comme référentiel lu)',
      'market-delegation (affectation, équipe, plafond, politique de caisse lus ; normalizeMarketCode)',
      'providers-services (fournisseurs de paiement du marché lus)',
      'logistics (relais lus)',
      'dashboard (dashboard_global_access_grants et require-dashboard-global-authority : autorisation centrale explicite lue)',
      'catalog (catalog_global_access_grants et require-catalog-global-authority : autorisation centrale explicite lue)',
      'decision-signals (decision_signal_global_access_grants et son middleware : autorisation centrale explicite lue)',
      'economic-engine (pricing_global_access_grants et require-pricing-global-authority : autorisation centrale explicite lue)',
      'sourcing (sourcing_global_access_grants et require-sourcing-global-authority : autorisation centrale explicite lue)',
      'auth (garde des routes centrales)',
      'infrastructure (DB et bootstrap)',
    ],
  },

  authority: 'backend-core — cette feature ne décide ni n’écrit rien : toute évolution vers une écriture ou une autorisation passe par market-delegation ou par le service propriétaire de la table concernée.',

  invariants: [
    'la vue est strictement en lecture seule : aucun INSERT, UPDATE ou DELETE, aucun appel de service d’écriture',
    'la vue n’accorde aucun droit : l’accès central est le rôle admin déclaré, jamais déduit d’un scope ou d’un rôle d’opérateur',
    'un écart est signalé, jamais réparé ni masqué',
    'central(X, domaine) est l’unique porte vers les cinq autorisations centrales explicites : elle délègue aux fonctions existantes des middlewares, sans SQL d’autorisation dupliqué, et le rôle admin n’en implique aucune',
    'chaque capability de groupe ou CENTRAL_ONLY déclare dans le registre son domaine d’autorité centrale ou null ; null est un constat (aucune table ne l’applique aujourd’hui), jamais une autorisation',
    'le code marché est validé côté serveur (deux lettres) ; un code invalide est un 400 et un code inconnu un 404',
  ],
};
