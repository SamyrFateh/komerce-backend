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
      surface: 'service+db+api',
    },
    rationale: [
      'Porte le mandat d’exploitation déléguée d’un Market ID, distinct du référentiel market lui-même.',
      'Un Market ID ne peut avoir qu’un seul Market Operating Assignment ACTIVE ; les acteurs locaux secondaires restent providers/relais.',
      'Les capacités MEMBER sont bornées par le ceiling de l’assignment ; les autorités GROUP/CENTRAL_ONLY sont structurellement hors délégation marché.',
      'LOT 1A rend l’équipe autonome par capabilities sans transformer le rôle global user en autorité métier.',
      'Migration 197 adopte les scopes legacy actifs sans élargir les memberships déjà existantes ni pré-accorder de capabilities futures.',
      'La politique de contrôle cash appartient au partenaire pays ; le central conserve seulement un plancher d’intégrité non désactivable.',
      'Le bridge runtime permet à une membership projetée d’emprunter les surfaces qui admettent déjà market_operator sans jamais écrire users.role.',
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
      'calcul déterministe de la projection vers operator_market_scopes, persistée exclusivement par la boundary de la feature market',
      'autonomy_rate calculé uniquement sur la classe DELEGATION',
      'LOT 1A : lecture équipe, invitation, acceptation, modification capabilities et révocation par capabilities team.*',
      'invitation persistée 72 h par défaut, token brut jamais stocké et capabilities revalidées à l’acceptation',
      'anti-lockout : la dernière membership possédant team.grant ne peut pas être retirée silencieusement',
      'adoption legacy : scopes actifs convertis en assignments/memberships, manager vers DELEGATION LIVE et viewer vers whitelist read-only',
      'bridge runtime request-local : une membership active déjà projetée peut satisfaire market_operator uniquement sur les routes qui admettent explicitement ce rôle',
      'reprojection transactionnelle après création, acceptation, modification de capabilities ou révocation de membership',
      'politique cash partenaire par assignment : activation/désactivation et SINGLE ou DUAL_ALWAYS',
      'LOT 2B : providers locaux — création, modification de coordonnées, suspension et réactivation par capability provider.manage, jamais de hard-delete',
      'un provider reste rattaché à son marché d’origine ; toute tentative de lecture/écriture cross-market échoue en 404, sans confirmer l’existence de la ressource sur un autre marché',
    ],
    out: [
      'référentiel markets, Currency Boundary et persistance operator_market_scopes : feature market',
      'rôle global users.role et user.role.set : frontière auth-identity/GROUP, jamais déléguée au partenaire',
      'règles d’allocation GROUP et vérité économique consolidée : economic-engine',
      'fonctions Hub/transit mutualisées : hors Market Operating Assignment',
      'providers et relais restent des principaux locaux secondaires : jamais des assignments concurrents, même quand leurs mutations sont déléguées par capability',
      'identité provider (pas de users / user_role), profil public riche et exposition de contact privé : feature providers-services, propriétaire de la table providers',
      'settlement/payout/commission/revenue_share d’un provider : chantier greenfield ultérieur',
      'vérité d’encaissement et état de double confirmation : feature payments',
      'contrat juridique partenaire complet : hors backend, seule sa projection exécutable pourra entrer plus tard',
    ],
  },

  files: {
    migrations: [
      'migrations/193_market_delegation_capability_registry.sql',
      'migrations/194_market_delegation_assignments.sql',
      'migrations/195_operator_market_scopes_projection_marker.sql',
      'migrations/196_market_delegation_team.sql',
      'migrations/197_market_delegation_legacy_scope_backfill.sql',
      'migrations/198_market_cash_control_policy.sql',
      'migrations/200_market_delegation_provider_manage_live.sql',
    ],
    middleware: [
      'middleware/require-market-delegated-role.js',
    ],
    services: [
      'services/capability-registry.js',
      'services/market-delegation-service.js',
      'services/market-scope-projector.js',
      'services/market-delegation-team-service.js',
      'services/market-cash-control-policy-service.js',
      'services/market-delegation-provider-service.js',
    ],
    routes: [
      'routes/market-delegation-team.js',
      'routes/market-delegation-cash-control.js',
      'routes/market-delegation-provider.js',
    ],
    tests: [
      'tests/unit/market-delegation-p0.test.js',
      'tests/unit/market-delegation-team-service.test.js',
      'tests/unit/market-delegation-team-routes.test.js',
      'tests/unit/market-delegation-legacy-backfill.test.js',
      'tests/unit/market-delegation-runtime-bridge.test.js',
      'tests/unit/market-cash-control-policy-service.test.js',
      'tests/unit/market-delegation-cash-control-routes.test.js',
      'tests/unit/market-delegation-provider-service.test.js',
      'tests/unit/market-delegation-provider-routes.test.js',
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
      'market_team_invitations: RW!',
      'market_cash_control_policies: RW!',
      'providers: R',  // mutations via providers-services/providers-service (executor injecté)
      'operator_market_scopes: R',
      'markets: R',
      'users: R',
    ],
  },

  security: {
    status: 'CONFIRMED_PROTECTED',
    authedRoutesDetected: 13,
    totalRoutes: 13,
    note: 'Toutes les routes LOT 1A + LOT 2B (cash-control) + LOT 2B (provider) exigent authenticate. Les actions sur un marché exigent ensuite team.*/cash_control.*/provider.manage résolus depuis assignment_memberships + membership_capabilities ; l’acceptation d’une invitation est authentifiée et vérifie l’email. Le bridge runtime n’accorde market_operator qu’à partir d’une projection attribuée à une membership et seulement sur une route qui admet déjà market_operator. Aucun market_id client ne sert de preuve d’autorité, sur team comme sur cash-control comme sur provider.',
  },

  contract: {
    exposes: [
      'GET /api/market-delegation/markets/:marketCode/team — team.read',
      'POST /api/market-delegation/markets/:marketCode/team/invitations — team.invite',
      'POST /api/market-delegation/team/invitations/:token/accept — utilisateur authentifié correspondant à l’email invité',
      'PUT /api/market-delegation/markets/:marketCode/team/:membershipId/capabilities — team.grant + team.revoke',
      'DELETE /api/market-delegation/markets/:marketCode/team/:membershipId — team.revoke',
      'DELETE /api/market-delegation/markets/:marketCode/team/invitations/:invitationId — team.revoke',
      'GET /api/market-delegation/markets/:marketCode/cash-control-policy — finance.read',
      'PUT /api/market-delegation/markets/:marketCode/cash-control-policy — cash_control.policy.manage',
      'GET /api/market-delegation/markets/:marketCode/network/providers — provider.manage',
      'POST /api/market-delegation/markets/:marketCode/network/providers — provider.manage',
      'PUT /api/market-delegation/markets/:marketCode/network/providers/:providerId — provider.manage',
      'POST /api/market-delegation/markets/:marketCode/network/providers/:providerId/suspend — provider.manage',
      'POST /api/market-delegation/markets/:marketCode/network/providers/:providerId/activate — provider.manage',
    ],
    internalApi: [
      { fn: 'createAssignment', file: 'services/market-delegation-service.js' },
      { fn: 'replaceCeiling', file: 'services/market-delegation-service.js' },
      { fn: 'addMembership', file: 'services/market-delegation-service.js' },
      { fn: 'grantMembershipCapabilities', file: 'services/market-delegation-service.js' },
      { fn: 'replaceMembershipCapabilities', file: 'services/market-delegation-service.js' },
      { fn: 'revokeMembership', file: 'services/market-delegation-service.js' },
      { fn: 'projectAssignment', file: 'services/market-scope-projector.js' },
      { fn: 'projectionDrift', file: 'services/market-scope-projector.js' },
      { fn: 'attachMarketDelegatedRoleFor', file: 'middleware/require-market-delegated-role.js' },
      { fn: 'resolveAuthorization', file: 'services/market-delegation-team-service.js' },
      { fn: 'inviteTeamMember', file: 'services/market-delegation-team-service.js' },
      { fn: 'acceptInvitation', file: 'services/market-delegation-team-service.js' },
      { fn: 'readMarketCashPolicy', file: 'services/market-cash-control-policy-service.js' },
      { fn: 'updateMarketCashPolicy', file: 'services/market-cash-control-policy-service.js' },
      { fn: 'createProvider', file: 'services/market-delegation-provider-service.js' },
      { fn: 'updateProvider', file: 'services/market-delegation-provider-service.js' },
      { fn: 'setProviderStatus', file: 'services/market-delegation-provider-service.js' },
    ],
    consumes: ['market', 'auth', 'auth-identity', 'infrastructure', 'providers-services'],
  },

  authority: 'backend-core — cette feature possède la délégation d’autorité marché et son équipe ; elle ne possède ni le référentiel market, ni operator_market_scopes, ni users.role, ni les règles GROUP, ni les fonctions terrain mutualisées.',

  invariants: [
    { statement: 'un Market ID possède au plus un Market Operating Assignment ACTIVE', test: 'tests/unit/market-delegation-p0.test.js' },
    { statement: 'aucune capability GROUP ou CENTRAL_ONLY ne peut entrer dans un ceiling marché', test: 'tests/unit/market-delegation-p0.test.js' },
    { statement: 'les capabilities d’un membre sont toujours un sous-ensemble du ceiling actif de son assignment', test: 'tests/unit/market-delegation-p0.test.js' },
    { statement: 'operator_market_scopes reste une projection de compatibilité persistée par sa lifecycle owner market ; require-market-scope.js ne dépend jamais directement des tables de délégation', test: 'tests/unit/market-delegation-p0.test.js' },
    { statement: 'une membership ne reçoit aucun scope legacy si elle ne détient pas le socle viewer complet ; manager exige toutes les capabilities DELEGATION actuellement LIVE du ceiling mais jamais les futures MISSING', test: 'tests/unit/market-delegation-runtime-bridge.test.js' },
    { statement: 'les mutations de membership reprojettent operator_market_scopes dans la même transaction afin que révocation et changement de niveau prennent effet atomiquement', test: 'tests/unit/market-delegation-runtime-bridge.test.js' },
    { statement: 'le rôle market_operator dérivé est request-local, prouvé par une projection de membership active et ne modifie jamais users.role', test: 'tests/unit/market-delegation-runtime-bridge.test.js' },
    { statement: 'un token d’invitation brut n’est jamais persisté ; seul son SHA-256 est stocké', test: 'tests/unit/market-delegation-team-service.test.js' },
    { statement: 'les capabilities d’une invitation sont revalidées contre le grantor courant et le ceiling au moment de l’acceptation', test: 'tests/unit/market-delegation-team-service.test.js' },
    { statement: 'retirer la dernière membership possédant team.grant échoue fort afin d’éviter un lockout local', test: 'tests/unit/market-delegation-team-service.test.js' },
    { statement: 'les routes équipe refusent market_id/marketId venant du client comme preuve d’autorité', test: 'tests/unit/market-delegation-team-routes.test.js' },
    { statement: 'le backfill legacy ne pré-accorde jamais une capability future/MISSING et ne développe pas une membership déjà adoptée', test: 'tests/unit/market-delegation-legacy-backfill.test.js' },
    { statement: 'le partenaire peut durcir sa politique cash sans fournir de market_id client et toute mutation est auditée', test: 'tests/unit/market-cash-control-policy-service.test.js' },
    { statement: 'un provider ne peut jamais être lu ou modifié par une membership d’un autre marché ; la réponse est 404, jamais 403, pour ne pas confirmer l’existence de la ressource', test: 'tests/unit/market-delegation-provider-service.test.js' },
    { statement: 'suspendre un provider ne le supprime jamais (status=suspended, jamais un DELETE) ; réactivable par status=active', test: 'tests/unit/market-delegation-provider-service.test.js' },
    { statement: 'updateProvider ne réassigne jamais le marché d’un provider, même si le patch en contenait un', test: 'tests/unit/providers-service.test.js' },
    { statement: 'les routes provider refusent market_id/marketId venant du client comme preuve d’autorité, comme les routes équipe et cash-control', test: 'tests/unit/market-delegation-provider-routes.test.js' },
  ],
};
