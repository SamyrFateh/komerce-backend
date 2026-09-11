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
    'dashboard Canonical, de décider et exploiter son marché : KPIs, commandes, ' +
    'catalogue pays, pricing local, réseau Hub/Relais, douane, expéditions et ' +
    'Finance pays — sans jamais voir les données d\'un autre marché ni recevoir ' +
    'automatiquement les gestes physiques ou autorités globales des rôles spécialisés.',

  // ── Perimetre ────────────────────────────────────────────────────────────
  perimeter: {
    in: [
      'Operations Workspace (routes/admin-operations-workspace.js, possédé par `dashboard`) : pilotage Hub/Relais market-scoped ; mutations terrain restent agent_hub/agent_relais selon capability',
      'Catalogue pays : exposition/configuration produit × marché via les primitives market-scoped ; aucune mutation de la vérité catalogue globale',
      'Expéditions & Douane : visibilité, supervision et configuration du marché ; gestes physiques/transit spécialisés restent soumis aux capabilities dédiées',
      'Finance pays : recettes, coûts, marges, rapprochements, justificatifs et configuration locale livrée ; actes comptables sensibles restent explicitement délégués',
      'Navigation Canonical : domaines visibles selon responsibilities/capabilities effectives, jamais selon une simple promesse UI',
      'Remontage navigation après résolution async de la session pour appliquer le filtrage rôle/capability',
      'Script CLI provision-market-operator.js : création utilisateur + scope atomique, idempotent',
      'Script CLI seed-market-test-data.js : banc staging strictement Market ID pour catalogue, pricing et commandes de recette pays',
      'Parcours complet cible : login → context → dashboards scopés → Catalogue pays → Atelier → Commandes → Opérations/Douane/Expéditions → Finance pays → équipe/partners',
    ],
    out: [
      'Dashboard Legacy (admin/) — gelé, market_operator volontairement exclu de ROLE_SHELLS',
      'Catalogue GLOBAL / vérité produit globale / requireCatalogGlobalAuthority — reste une autorité centrale ; ne pas confondre avec Catalogue pays',
      'Mutations Hub physiques (scan, pack, seal, ship) — capacités spécialisées agent_hub/admin sauf délégation future explicite',
      'Mutations terrain relais (réception, remise, cash) — capacités spécialisées agent_relais/admin sauf délégation future explicite',
      'Actes comptables globaux, consolidation cross-market et autorités financières centrales — hors délégation pays',
      'Sourcing global — reste séparé tant que sa délégation pays n\'est pas explicitement décidée',
      'Pricing mutations globales (apply strategy, update competitor global) — réservées aux autorités correspondantes ; la décision locale reste au pays',
      'Refacturation multi-marché (Railway, Hub fixe) — chantier séparé, dépend du ratio de couverture',
      'Ratio de couverture par marché — chantier pricing Phase 3d, pas ce lot',
    ],
  },

  // ── Primitives utilisées (déjà en place, ne pas recréer) ─────────────────
  primitives_consumed: [
    'middleware/require-market-scope.js — requireMarketScopeRole, attachAuthorizedMarketsForOperator',
    'services/dashboard-admin-context.js — resolveDashboardAdminContext (mode market/global)',
    'routes/admin-dashboard-market.js — endpoints /market/:marketCode scopés',
    'routes/hub-dashboard.js — hubRead/hubSupervise avec filtre market_id dans service',
    'routes/relay-dashboard.js — 3 cas (admin/agent_relais/market_operator)',
    'routes/admin/partners.js — CRUD scopé country_code, manager requis pour mutations',
    'routes/admin-pricing-workspace.js — lecture/décision locale scopée pour market_operator selon capabilities',
    'services/catalog-market-exposure-service.js — exposition produit x marché fail-closed',
    'services/market-commercial-price-service.js — décision locale DRAFT_PENDING_GATE sans activation forcée',
    'utils/currency.js — projection via Currency Boundary vers la devise canonique du marché',
    'public/dashboards/canonical/js/admin-context.js — projection UI d\'autorité serveur',
    'public/js/login.js — ALLOWED_DASHBOARD_ROLES inclut market_operator',
  ],

  // ── Fichiers de ce lot ───────────────────────────────────────────────────
  // routes/admin-operations-workspace.js, public/dashboards/canonical/js/navigation.js
  // et public/dashboards/canonical/js/app.js ne sont PAS listés ici : ce sont
  // des fichiers possédés par la feature `dashboard` (canonical/** + workspace
  // routes, cf. APP_FEATURE_REGISTRY.md). Ce lot ne fait que des rattachements
  // ciblés dans ces fichiers sans transférer la propriété.
  files: {
    scripts: [
      'scripts/provision-market-operator.js',
      'scripts/seed-market-test-data.js',
    ],
    tests: [
      'tests/unit/canonical-operations-workspace-boundary.test.js',
      'tests/unit/canonical-navigation.test.js',
      'tests/unit/seed-market-test-data.test.js',
    ],
  },

  // ── Invariants ───────────────────────────────────────────────────────────
  invariants: [
    'Le scope serveur est l\'autorité — le navigateur ne choisit jamais son marché',
    'Un market_operator sans scope actif dans operator_market_scopes n\'accède à rien',
    'Le Responsable pays doit disposer des outils correspondant à sa responsabilité : Catalogue pays, Atelier, Commandes, Opérations, Douane, Expéditions et Finance pays',
    'Un guard actuellement trop restrictif sur une responsabilité cible est un gap d\'implémentation à fermer, pas une justification pour retirer cette responsabilité de la doctrine',
    'Catalogue pays ne peut jamais modifier silencieusement la vérité catalogue globale',
    'Les mutations physiques Hub (scan/pack/seal/ship) restent exclusivement derrière des capabilities terrain explicites',
    'Les mutations terrain relais (réception/remise/cash) restent exclusivement derrière des capabilities terrain explicites',
    'Finance pays ne donne jamais implicitement une autorité comptable globale ou cross-market',
    'Les utility links d\'autorité globale sont masqués pour les profils non autorisés',
    'agent_hub garde les droits Hub correspondant à son périmètre opérationnel',
    'agent_relais reste limité à son relais_id physique pour ses gestes terrain',
    'Le dashboard Legacy (admin/) ne reçoit jamais market_operator dans ROLE_SHELLS — il est gelé',
    'Le provisioning est idempotent — ne recrée ni user ni scope existant',
    'Le seed staging ne crée, n\'expose ni ne nettoie jamais une donnée d\'un autre Market ID',
    'Le seed staging ne fabrique jamais un prix LOCAL_ACTIVE sans passage par le gate économique canonique',
  ],

  // ── Contrat ──────────────────────────────────────────────────────────────
  contract: {
    exposes: [],
    consumes: [
      'market (operator_market_scopes, markets, Currency Boundary)',
      'auth (authenticate, requireRole + capabilities market-scoped)',
      'dashboard (admin-dashboard-market routes, admin-context, canonical navigation/app.js, operations workspace)',
      'catalog (vérité globale en lecture si nécessaire + projection/configuration product_market_exposure via son service owner)',
      'market-autonomy (décision locale DRAFT_PENDING_GATE via market-commercial-price-service ; aucun LOCAL_ACTIVE forcé)',
      'orders (commandes et order_items market-scoped)',
      'logistics (Hub/Relais, expéditions, douane et primitives de suivi market-scoped)',
      'finance (projection Finance pays et actions explicitement déléguées, jamais autorité globale implicite)',
      'infrastructure (db.js — pool utilisé par les scripts de provisioning et de seed staging)',
    ],
  },

  // ── Ce qui reste à faire après / autour de ce lot ────────────────────────
  next: [
    'Livrer la surface Catalogue pays market-scoped à partir de catalog-market-exposure-service.js',
    'Séparer dans shipping-customs les droits lecture/configuration pays des gestes spécialisés et ouvrir les premiers au market_operator',
    'Livrer Finance pays market-scoped au market_operator sans élargir les autorités comptables globales',
    'Ajouter les E2E staging market_operator sur Catalogue pays + Douane + Expéditions + Finance pays avec preuve d\'isolation inter-marchés',
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
