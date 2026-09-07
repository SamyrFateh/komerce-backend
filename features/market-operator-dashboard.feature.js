/**
 * @feature       market-operator-dashboard
 * @type          feature
 * @domain        admin-dashboard
 * @status        staging
 * @owner         backend-core
 * @since         2026-09
 * @doctrine      docs/contract/DASHBOARD_MARKET_SCOPE_2C.md
 * @registry      docs/doctrine/APP_FEATURE_REGISTRY.md
 */
'use strict';

module.exports = {

  // ── Identite ─────────────────────────────────────────────────────────────
  name:     'market-operator-dashboard',
  type:     'feature',
  domain:   'admin-dashboard',
  status:   'staging',
  owner:    'backend-core',
  since:    '2026-09',
  doctrine: 'docs/contract/DASHBOARD_MARKET_SCOPE_2C.md',

  // ── Autorite ─────────────────────────────────────────────────────────────
  authority: 'backend-core — tout changement de rôle ou de scope marché sur ' +
    'cette surface doit être validé par le propriétaire de middleware/require-market-scope.js.',

  // ── Service rendu ────────────────────────────────────────────────────────
  service: 'Permettre à un opérateur pays (market_operator) de se connecter au ' +
    'dashboard Canonical, de piloter son marché (KPIs, commandes, clients, ' +
    'ventes, relais, Hub, pricing en lecture), de gérer ses relais partenaires, ' +
    'et de superviser les opérations Hub de son marché — sans jamais voir les ' +
    'données d\'un autre marché ni effectuer d\'opérations physiques Hub.',

  // ── Perimetre ────────────────────────────────────────────────────────────
  perimeter: {
    in: [
      'Operations Workspace (routes/admin-operations-workspace.js, possédé par `dashboard`) : rattachement d\'une ligne de rôle, lecture ouverte au market_operator (mutations restent agent_hub/agent_relais)',
      'Navigation Canonical : filtrage des utility links par rôle (Accès pays et Démo = admin only)',
      'Remontage navigation après résolution async de la session pour appliquer le filtrage rôle',
      'Script CLI provision-market-operator.js : création utilisateur + scope atomique, idempotent',
      'Parcours complet : login → context → 4 dashboards scopés → workspaces scopés → partners CRUD',
    ],
    out: [
      'Dashboard Legacy (admin/) — gelé, market_operator volontairement exclu de ROLE_SHELLS',
      'Mutations Hub physiques (scan, pack, seal, ship) — réservées agent_hub',
      'Catalogue global, sourcing, douane, comptabilité — réservés admin/finance/sourcing',
      'Pricing mutations globales (apply strategy, update competitor) — réservées admin/sourcing',
      'Refacturation multi-marché (Railway, Hub fixe) — chantier séparé, dépend du ratio de couverture',
      'Ratio de couverture par marché — chantier pricing Phase 3d, pas ce lot',
    ],
  },

  // ── Primitives utilisées (déjà en place, ne pas recréer) ─────────────────
  primitives_consumed: [
    'middleware/require-market-scope.js — requireMarketScopeRole, attachAuthorizedMarketsForOperator',
    'services/dashboard-admin-context.js — resolveDashboardAdminContext (mode market/global)',
    'routes/admin-dashboard-market.js — 4 endpoints /market/:marketCode scopés',
    'routes/hub-dashboard.js — hubRead/hubSupervise avec filtre market_id dans service',
    'routes/relay-dashboard.js — 3 cas (admin/agent_relais/market_operator)',
    'routes/admin/partners.js — CRUD scopé country_code, manager requis pour mutations',
    'routes/admin-pricing-workspace.js — lecture scopée pour market_operator',
    'public/dashboards/canonical/js/admin-context.js — projection UI d\'autorité serveur',
    'public/js/login.js — ALLOWED_DASHBOARD_ROLES inclut market_operator',
  ],

  // ── Fichiers de ce lot ───────────────────────────────────────────────────
  // routes/admin-operations-workspace.js, public/dashboards/canonical/js/navigation.js
  // et public/dashboards/canonical/js/app.js ne sont PAS listés ici : ce sont
  // des fichiers possédés par la feature `dashboard` (canonical/** + workspace
  // routes, cf. APP_FEATURE_REGISTRY.md). Ce lot ne fait que des rattachements
  // ciblés dans ces fichiers (rôle ajouté, filtrage par rôle, remount post-
  // session) sans transférer la propriété.
  files: {
    scripts: [
      'scripts/provision-market-operator.js',
    ],
    tests: [
      'tests/unit/canonical-operations-workspace-boundary.test.js',
      'tests/unit/canonical-navigation.test.js',
    ],
  },

  // ── Invariants ───────────────────────────────────────────────────────────
  invariants: [
    'Le scope serveur est l\'autorité — le navigateur ne choisit jamais son marché',
    'Un market_operator sans scope actif dans operator_market_scopes n\'accède à rien',
    'Les mutations physiques Hub (scan/pack/seal/ship) restent exclusivement agent_hub + admin',
    'Les mutations terrain relais (réception/remise/cash) restent exclusivement agent_relais + admin',
    'Les 4 dashboards primaires restent visibles pour tous les rôles autorisés — le scope des données est serveur',
    'Les utility links admin (Accès pays, Démo) sont masqués pour les non-admin',
    'agent_hub garde la vue Hub globale (tous les marchés, Hub unique)',
    'agent_relais reste limité à son relais_id physique',
    'Le dashboard Legacy (admin/) ne reçoit jamais market_operator dans ROLE_SHELLS — il est gelé',
    'Le provisioning est idempotent — ne recrée ni user ni scope existants',
  ],

  // ── Contrat ──────────────────────────────────────────────────────────────
  contract: {
    exposes: [],
    consumes: [
      'market (operator_market_scopes, markets)',
      'auth (authenticate, requireRole)',
      'dashboard (admin-dashboard-market routes, admin-context, canonical navigation/app.js, operations workspace)',
      'infrastructure (db.js — pool utilisé par scripts/provision-market-operator.js)',
    ],
  },

  // ── Ce qui reste à faire après ce lot ────────────────────────────────────
  next: [
    'Requête panier moyen réel + distribution mono-article',
    'Réconciliation d\'un shipment pilote sur données réelles',
    'Saisie d\'une charge économique réelle dans economic_structure_cost_events',
    'Disposition gouvernée des commandes irréconciliables',
    'Ratio de couverture par marché (COVERED / UNCOVERED / NOT_DECISIONAL)',
    'Budget de conquête explicite pour marchés en ouverture',
    'Ancrage prix sur marché réel (remplacer CDR/(1−marge) dans computePrices)',
    'Refacturation Railway + Hub aux marchés',
  ],
};
