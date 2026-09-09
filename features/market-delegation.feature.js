/**
 * @feature       market-delegation
 * @type          feature
 * @domain        market-delegation
 * @status        staging
 * @owner         backend-core
 * @since         2026-09
 * @doctrine      docs/doctrine/DOCTRINE_AUTONOMIE_RESPONSABLE_PAYS.md
 * @registry      docs/doctrine/APP_FEATURE_REGISTRY.md
 */
'use strict';

module.exports = {
  name: 'market-delegation',
  nature: 'feature',
  type: 'feature',
  domain: 'market-delegation',
  status: 'staging',
  owner: 'backend-core',
  since: '2026-09',
  doctrine: 'docs/doctrine/DOCTRINE_AUTONOMIE_RESPONSABLE_PAYS.md',

  classification: {
    axis: 'business',
    kind: 'business-feature',
    decision: 'feature-autonome',
    signals: {
      ownsTables: true,
      ownsLifecycle: true,
      activeService: true,
      multiConsumer: true,
      ownsMigrations: true,
      externalSideEffect: 'none',
      surface: 'service+db',
    },
    rationale: [
      'Porte le mandat d’exploitation déléguée d’un Market ID, distinct du référentiel market lui-même.',
      'Un Market ID ne peut avoir qu’un seul Market Operating Assignment ACTIVE ; les acteurs locaux secondaires restent providers/relais.',
      'Les capacités MEMBER sont bornées par le ceiling de l’assignment ; les autorités GROUP/CENTRAL_ONLY sont structurellement hors délégation marché.',
    ],
  },

  service: 'Déléguer de façon explicite, auditable et révocable l’autorité d’exploitation d’un Market ID à un opérateur principal et à son équipe, tout en préservant les frontières GROUP de Komerce.',

  perimeter: {
    in: [
      'capability_registry : registre exécutable DELEGATION / EXECUTION / BOUNDARY',
      'Market Operating Assignment : mandat unique actif par Market ID',
      'ceiling template et plafond effectif concédé par le central',
      'memberships et capabilities membres, toujours sous le plafond',
      'règle de délégation grant(member) ⊆ grant(grantor) ⊆ ceiling(assignment)',
      'audit append-only des mutations de délégation',
      'projection déterministe vers operator_market_scopes pour préserver le middleware existant',
      'autonomy_rate calculé uniquement sur la classe DELEGATION',
    ],
    out: [
      'référentiel markets et Currency Boundary : feature market',
      'règles d’allocation GROUP et vérité économique consolidée : economic-engine',
      'fonctions Hub/transit mutualisées : hors Market Operating Assignment',
      'providers/relais comme principaux locaux secondaires : jamais des assignments concurrents',
      'settlement/payout/commission/revenue_share : chantier greenfield ultérieur',
      'contrat juridique partenaire complet : hors backend, seule sa projection exécutable pourra entrer plus tard',
    ],
  },

  files: {
    migrations: [
      'migrations/171_market_delegation_capability_registry.sql',
      'migrations/172_market_delegation_assignments.sql',
      'migrations/173_operator_market_scopes_projection_marker.sql',
    ],
    services: [
      'services/capability-registry.js',
      'services/market-delegation-service.js',
      'services/market-scope-projector.js',
    ],
    tests: [
      'tests/unit/market-delegation-p0.test.js',
    ],
  },

  db: {
    tables: [
      'capability_registry: RW!',
      'market_operating_assignments: RW!',
      'assignment_capability_ceiling: RW!',
      'assignment_memberships: RW!',
      'membership_capabilities: RW!',
      'ceiling_templates: RW!',
      'ceiling_template_capabilities: RW!',
      'market_delegation_audit: RW!',
      'markets: R',
      'users: R',
      'operator_market_scopes: W',
    ],
  },

  security: {
    status: 'CONFIRMED_PROTECTED',
    authedRoutesDetected: 0,
    totalRoutes: 0,
    note: 'P0 n’expose encore aucune route. Les futures mutations seront authentifiées, market-scopées et capability-aware. operator_market_scopes reste un read model ; require-market-scope.js ne change pas.',
  },

  contract: {
    exposes: [],
    internalApi: [
      { fn: 'createAssignment', file: 'services/market-delegation-service.js' },
      { fn: 'replaceCeiling', file: 'services/market-delegation-service.js' },
      { fn: 'addMembership', file: 'services/market-delegation-service.js' },
      { fn: 'grantMembershipCapabilities', file: 'services/market-delegation-service.js' },
      { fn: 'revokeMembership', file: 'services/market-delegation-service.js' },
      { fn: 'projectAssignment', file: 'services/market-scope-projector.js' },
      { fn: 'projectionDrift', file: 'services/market-scope-projector.js' },
    ],
    consumes: [
      'market',
      'infrastructure',
    ],
  },

  authority: 'backend-core — cette feature possède la délégation d’autorité marché ; elle ne possède ni le référentiel market, ni les règles GROUP, ni les fonctions terrain mutualisées.',

  invariants: [
    {
      statement: 'un Market ID possède au plus un Market Operating Assignment ACTIVE',
      test: 'tests/unit/market-delegation-p0.test.js',
    },
    {
      statement: 'aucune capability GROUP ou CENTRAL_ONLY ne peut entrer dans un ceiling marché',
      test: 'tests/unit/market-delegation-p0.test.js',
    },
    {
      statement: 'les capabilities d’un membre sont toujours un sous-ensemble du ceiling actif de son assignment',
      test: 'tests/unit/market-delegation-p0.test.js',
    },
    {
      statement: 'operator_market_scopes est une projection de compatibilité ; require-market-scope.js ne dépend jamais directement des tables de délégation',
      test: 'tests/unit/market-delegation-p0.test.js',
    },
    {
      statement: 'une membership granulaire ne projette jamais manager sur les routes legacy sauf si elle détient 100 % du ceiling actif ; compatibilité legacy fail-closed',
      test: 'tests/unit/market-delegation-p0.test.js',
    },
  ],
};