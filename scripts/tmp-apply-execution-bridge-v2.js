'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

function file(p) { return path.join(ROOT, p); }
function read(p) { return fs.readFileSync(file(p), 'utf8'); }
function write(p, value) { fs.mkdirSync(path.dirname(file(p)), { recursive: true }); fs.writeFileSync(file(p), value, 'utf8'); }
function replaceOnce(source, from, to, label) {
  if (!source.includes(from)) throw new Error(`patch anchor missing: ${label}`);
  return source.replace(from, to);
}
function replaceBetween(source, start, end, replacement, label) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw new Error(`patch range missing: ${label}`);
  return source.slice(0, a) + replacement + source.slice(b);
}

const EXEC = [
  'execution.order.mark_ordered',
  'execution.distribution.run',
  'execution.parcel.ship',
  'execution.inventory.assign',
  'execution.parcel.receive',
  'execution.parcel.collect',
  'execution.cash.confirm',
];

write('migrations/212_market_delegation_execution_ceiling.sql', `-- @migration 212_market_delegation_execution_ceiling.sql
-- @domain    market-delegation
-- @purpose   Rendre les capabilities EXECUTION réellement délégables aux
--            membres terrain sans les auto-accorder au manager pays.
--
-- Doctrine :
--   - EXECUTION est dans le ceiling du mandat marché, jamais implicite sur une
--     membership ;
--   - team.grant peut déléguer une capability EXECUTION LIVE du ceiling sans
--     que le manager doive l'exécuter lui-même ;
--   - aucune écriture users.role ; aucun fait métier terrain créé ici ;
--   - l'ouverture automatique du ceiling est auditée avec actor_user_id NULL.

WITH current_templates AS (
  SELECT id FROM ceiling_templates WHERE is_current = TRUE
)
INSERT INTO ceiling_template_capabilities (template_id, capability)
SELECT template.id, registry.capability
  FROM current_templates template
  JOIN capability_registry registry
    ON registry.class = 'EXECUTION'
   AND registry.authority_scope = 'MARKET'
   AND registry.delegation_mode = 'DELEGABLE'
   AND registry.status = 'LIVE'
ON CONFLICT DO NOTHING;

WITH inserted AS (
  INSERT INTO assignment_capability_ceiling (assignment_id, capability, granted_by)
  SELECT assignment.id, registry.capability, assignment.granted_by
    FROM market_operating_assignments assignment
   CROSS JOIN capability_registry registry
   WHERE assignment.status = 'ACTIVE'
     AND registry.class = 'EXECUTION'
     AND registry.authority_scope = 'MARKET'
     AND registry.delegation_mode = 'DELEGABLE'
     AND registry.status = 'LIVE'
     AND NOT EXISTS (
       SELECT 1
         FROM assignment_capability_ceiling existing
        WHERE existing.assignment_id = assignment.id
          AND existing.capability = registry.capability
          AND existing.revoked_at IS NULL
     )
  RETURNING assignment_id, capability
)
INSERT INTO market_delegation_audit (
  actor_user_id, assignment_id, membership_id, capability, action,
  payload_before, payload_after, occurred_at, correlation_id
)
SELECT NULL,
       inserted.assignment_id,
       NULL,
       inserted.capability,
       'EXECUTION_CEILING_OPENED_BY_MIGRATION',
       NULL,
       jsonb_build_object('source', 'migration-212', 'capability', inserted.capability),
       NOW(),
       'migration-212'
  FROM inserted;

-- Invariant volontaire : aucune membership n'est élargie automatiquement.
-- Les droits terrain sont accordés explicitement ensuite via team.grant.
`);

write('middleware/require-market-execution-capability.js', `/**
 * @komerce-arch
 * @role          market-execution-capability-bridge
 * @domain        market-delegation
 * @layer         middleware
 * @criticality   high
 * @inputs        authenticated user, canonical marketCode, exact execution capability
 * @outputs       request-local compatibility role after exact capability proof
 * @depends       db.js, services/market-delegation-service.js
 * @used-by       routes/admin-operations-workspace.js
 * @db-read       markets, market_operating_assignments, assignment_memberships, membership_capabilities, assignment_capability_ceiling
 * @db-write      market_delegation_audit
 * @db-txn        none
 * @doctrine      execution_is_explicit_capability, audit_before_domain_mutation, users_role_never_mutated
 * @impact-areas  market-delegation, dashboard, operations, authorization
 * @version       2026-09
 */
'use strict';

const db = require('../db');
const { resolveAuthorization, audit } = require('../services/market-delegation-service');

function sendDelegationError(res, error) {
  if (!error || !error.code || !error.status) return false;
  res.status(error.status).json({ error: error.message, code: error.code });
  return true;
}

function correlationId(req) {
  const raw = req.headers && req.headers['x-correlation-id'];
  return raw ? String(raw).slice(0, 200) : null;
}

function safeResourceParams(params = {}) {
  return Object.fromEntries(Object.entries(params)
    .filter(([key]) => key !== 'marketCode')
    .map(([key, value]) => [key, value == null ? null : String(value).slice(0, 200)]));
}

function attachMarketExecutionRoleFor({ capability, compatibilityRole, nativeRoles = [] }) {
  if (!String(capability || '').startsWith('execution.')) {
    throw new TypeError('execution capability requise');
  }
  if (!compatibilityRole) throw new TypeError('compatibilityRole requis');
  const native = new Set(nativeRoles);

  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentification requise.', code: 'AUTH_REQUIRED' });
    if (native.has(req.user.role)) return next();

    try {
      const authz = await resolveAuthorization(db, {
        userId: req.user.id,
        marketCode: req.params.marketCode,
        requiredCapability: capability,
      });
      if (req.workspaceMarket && String(authz.market_id) !== String(req.workspaceMarket.id)) {
        return res.status(403).json({ error: 'Marché hors périmètre.', code: 'MARKET_SCOPE_DENIED' });
      }

      await audit(db, {
        actorUserId: req.user.id,
        assignmentId: authz.assignment_id,
        membershipId: authz.membership_id,
        capability,
        action: 'EXECUTION_AUTHORIZED',
        after: {
          source: 'canonical_operations_workspace',
          market_code: authz.market_code,
          method: req.method,
          resource: safeResourceParams(req.params),
        },
        correlationId: correlationId(req),
      });

      const persistedRole = req.user.role;
      req.user = {
        ...req.user,
        persisted_role: persistedRole,
        role: compatibilityRole,
        role_source: 'market_execution_capability',
        execution_capability: capability,
      };
      req.marketExecution = {
        capability,
        assignment_id: authz.assignment_id,
        membership_id: authz.membership_id,
        market_id: authz.market_id,
        market_code: authz.market_code,
        persisted_role: persistedRole,
        compatibility_role: compatibilityRole,
      };
      return next();
    } catch (error) {
      if (sendDelegationError(res, error)) return undefined;
      return next(error);
    }
  };
}

module.exports = { attachMarketExecutionRoleFor, safeResourceParams, correlationId };
`);

// market-delegation-service: allow team.grant to delegate LIVE EXECUTION in ceiling.
{
  const p = 'services/market-delegation-service.js';
  let s = read(p);
  const marker = '// Porte d\'entrée générique de toute route market-delegation';
  const helper = `async function grantableCapabilitiesForActor(executor, { assignmentId, actorUserId = null, actorIsCentral = false }) {
  const db = requireExecutor(executor);
  const { rows: ceilingRows } = await db.query(
    \`SELECT acc.capability, registry.class, registry.status
       FROM assignment_capability_ceiling acc
       JOIN capability_registry registry ON registry.capability = acc.capability
      WHERE acc.assignment_id=$1::uuid
        AND acc.revoked_at IS NULL
      ORDER BY acc.capability\`,
    [assignmentId]
  );
  if (actorIsCentral) {
    return ceilingRows.filter(row => row.status === 'LIVE').map(row => row.capability);
  }
  const membership = await activeMembershipForUser(db, assignmentId, actorUserId);
  if (!membership) {
    const error = new Error('market_delegation_grantor_membership_required');
    error.code = 'MARKET_DELEGATION_GRANTOR_MEMBERSHIP_REQUIRED';
    throw error;
  }
  const actorCaps = new Set(await activeMembershipCapabilities(db, membership.id));
  const canDelegateExecution = actorCaps.has('team.grant');
  return ceilingRows
    .filter(row => actorCaps.has(row.capability) || (
      canDelegateExecution && row.class === 'EXECUTION' && row.status === 'LIVE'
    ))
    .map(row => row.capability);
}

`;
  if (!s.includes('async function grantableCapabilitiesForActor')) {
    s = replaceOnce(s, marker, helper + marker, 'grantable helper');
  }
  const start = 'async function assertGrantAllowed(db, { assignmentId, capabilities, actorUserId = null, actorIsCentral = false }) {';
  const end = 'async function addMembership(executor, { assignmentId, userId, actorUserId = null, capabilities = [], actorIsCentral = false, correlationId = null }) {';
  const replacement = `async function assertGrantAllowed(db, { assignmentId, capabilities, actorUserId = null, actorIsCentral = false }) {
  const requested = normalizeCapabilities(capabilities);
  if (!requested.length) return { requested, grantorMembership: null };

  const { rows: ceilingRows } = await db.query(
    \`SELECT acc.capability, registry.class, registry.status
       FROM assignment_capability_ceiling acc
       JOIN capability_registry registry ON registry.capability = acc.capability
      WHERE acc.assignment_id=$1::uuid
        AND acc.revoked_at IS NULL
        AND acc.capability = ANY($2::text[])\`,
    [assignmentId, requested]
  );
  const ceiling = new Map(ceilingRows.map(row => [row.capability, row]));
  const aboveCeiling = requested.filter(capability => !ceiling.has(capability));
  if (aboveCeiling.length) {
    const error = new Error(\`market_delegation_capability_above_ceiling:\${aboveCeiling.join(',')}\`);
    error.code = 'MARKET_DELEGATION_CAPABILITY_ABOVE_CEILING';
    throw error;
  }

  if (actorIsCentral) return { requested, grantorMembership: null };

  const grantorMembership = await activeMembershipForUser(db, assignmentId, actorUserId);
  if (!grantorMembership) {
    const error = new Error('market_delegation_grantor_membership_required');
    error.code = 'MARKET_DELEGATION_GRANTOR_MEMBERSHIP_REQUIRED';
    throw error;
  }
  const grantorCaps = new Set(await activeMembershipCapabilities(db, grantorMembership.id));
  const canDelegateExecution = grantorCaps.has('team.grant');
  const forbidden = requested.filter(capability => {
    if (grantorCaps.has(capability)) return false;
    const meta = ceiling.get(capability);
    return !(canDelegateExecution && meta && meta.class === 'EXECUTION' && meta.status === 'LIVE');
  });
  if (forbidden.length) {
    const error = new Error(\`market_delegation_grant_exceeds_grantor:\${forbidden.join(',')}\`);
    error.code = 'MARKET_DELEGATION_GRANT_EXCEEDS_GRANTOR';
    throw error;
  }
  return { requested, grantorMembership };
}

`;
  s = replaceBetween(s, start, end, replacement, 'assertGrantAllowed');
  s = replaceOnce(s, '  activeMembershipCapabilities,\n  assertGrantAllowed,', '  activeMembershipCapabilities,\n  grantableCapabilitiesForActor,\n  assertGrantAllowed,', 'service export');
  write(p, s);
}

// team service re-export helper.
{
  const p = 'services/market-delegation-team-service.js';
  let s = read(p);
  s = replaceOnce(s, '  activeMembershipCapabilities,\n  assertGrantAllowed,', '  activeMembershipCapabilities,\n  grantableCapabilitiesForActor,\n  assertGrantAllowed,', 'team import');
  s = replaceOnce(s, '  listTeam,\n  inviteTeamMember,', '  listTeam,\n  grantableCapabilitiesForActor,\n  inviteTeamMember,', 'team export');
  write(p, s);
}

// Team API surfaces grantable capabilities separately from owned capabilities.
{
  const p = 'routes/market-delegation-team.js';
  let s = read(p);
  s = replaceOnce(s, '  listTeam,\n  inviteTeamMember,', '  listTeam,\n  grantableCapabilitiesForActor,\n  inviteTeamMember,', 'route import');
  s = replaceOnce(s,
`      const team = await listTeam(client, { assignmentId: authz.assignment_id });
      return { authz, team };`,
`      const team = await listTeam(client, { assignmentId: authz.assignment_id });
      const grantable = await grantableCapabilitiesForActor(client, {
        assignmentId: authz.assignment_id,
        actorUserId: req.user.id,
        actorIsCentral: false,
      });
      return { authz, team, grantable };`, 'team GET grantable');
  s = replaceOnce(s, '      actor_capabilities: result.authz.capabilities,\n      ...result.team,', '      actor_capabilities: result.authz.capabilities,\n      actor_grantable_capabilities: result.grantable,\n      ...result.team,', 'team response grantable');
  write(p, s);
}

// Canonical team UI: explicit terrain preset, never implicit in read/same-as-me.
{
  const p = 'public/dashboards/canonical/js/market-team.js';
  let s = read(p);
  s = replaceOnce(s,
"    'cash_control.policy.manage': 'Gérer le contrôle des encaissements',\n  });",
"    'cash_control.policy.manage': 'Gérer le contrôle des encaissements',\n    'execution.order.mark_ordered': 'Envoyer une commande au sourcing',\n    'execution.distribution.run': 'Lancer la répartition',\n    'execution.parcel.ship': 'Expédier un colis',\n    'execution.inventory.assign': 'Affecter l’inventaire à un colis',\n    'execution.parcel.receive': 'Réceptionner un colis au relais',\n    'execution.parcel.collect': 'Remettre un colis au client',\n    'execution.cash.confirm': 'Confirmer un encaissement terrain',\n  });", 'execution labels');
  s = replaceOnce(s,
"  const READ_PRESET = Object.freeze([\n    'pricing.read',\n    'pricing.simulate',\n    'dashboard.market.read',\n    'operations.read',\n    'client.read',\n    'network.read',\n    'market_config.read',\n    'finance.read',\n  ]);",
"  const READ_PRESET = Object.freeze([\n    'pricing.read',\n    'pricing.simulate',\n    'dashboard.market.read',\n    'operations.read',\n    'client.read',\n    'network.read',\n    'market_config.read',\n    'finance.read',\n  ]);\n\n  const TERRAIN_PRESET = Object.freeze([\n    'operations.read',\n    'execution.order.mark_ordered',\n    'execution.distribution.run',\n    'execution.parcel.ship',\n    'execution.inventory.assign',\n    'execution.parcel.receive',\n    'execution.parcel.collect',\n    'execution.cash.confirm',\n  ]);", 'terrain preset');
  s = replaceOnce(s,
`  function presetControls(checklist, available) {
    const wrap = el('div', 'kmc-team-presets');
    const read = el('button', 'kmc-workspace-action is-secondary', 'Preset lecture');
    read.type = 'button';
    read.addEventListener('click', () => setChecked(checklist, READ_PRESET.filter(cap => available.includes(cap))));
    const same = el('button', 'kmc-workspace-action is-secondary', 'Même périmètre que moi');
    same.type = 'button';
    same.addEventListener('click', () => setChecked(checklist, available));
    const none = el('button', 'kmc-workspace-action is-secondary', 'Tout décocher');
    none.type = 'button';
    none.addEventListener('click', () => setChecked(checklist, []));
    wrap.append(read, same, none);
    return wrap;
  }`,
`  function presetControls(checklist, available, actorCapabilities = []) {
    const wrap = el('div', 'kmc-team-presets');
    const read = el('button', 'kmc-workspace-action is-secondary', 'Preset lecture');
    read.type = 'button';
    read.addEventListener('click', () => setChecked(checklist, READ_PRESET.filter(cap => available.includes(cap))));
    const terrain = el('button', 'kmc-workspace-action is-secondary', 'Preset terrain');
    terrain.type = 'button';
    terrain.addEventListener('click', () => setChecked(checklist, TERRAIN_PRESET.filter(cap => available.includes(cap))));
    const same = el('button', 'kmc-workspace-action is-secondary', 'Même périmètre que moi');
    same.type = 'button';
    same.addEventListener('click', () => setChecked(checklist, actorCapabilities.filter(cap => available.includes(cap))));
    const none = el('button', 'kmc-workspace-action is-secondary', 'Tout décocher');
    none.type = 'button';
    none.addEventListener('click', () => setChecked(checklist, []));
    wrap.append(read, terrain, same, none);
    return wrap;
  }`, 'preset controls');
  s = s.replace("card.appendChild(el('p', 'kmc-team-help', 'Choisissez uniquement les droits nécessaires. Le serveur refuse tout droit que vous ne possédez pas vous-même.'));", "card.appendChild(el('p', 'kmc-team-help', 'Choisissez uniquement les droits nécessaires. Les actions terrain sont délégables explicitement par team.grant et ne deviennent jamais vos propres droits d’exécution.'));" );
  s = s.replaceAll("const available = [...team.actor_capabilities].sort();", "const available = [...(team.actor_grantable_capabilities || team.actor_capabilities)].sort();");
  s = s.replaceAll('presetControls(checklist, available)', 'presetControls(checklist, available, team.actor_capabilities)');
  write(p, s);
}

// Dashboard route: read path keeps legacy projection; actions consume exact EXECUTION capability or native role.
{
  const p = 'routes/admin-operations-workspace.js';
  let s = read(p);
  s = replaceOnce(s,
"const { attachMarketDelegatedRoleFor } = require('../middleware/require-market-delegated-role');",
"const { attachMarketDelegatedRoleFor } = require('../middleware/require-market-delegated-role');\nconst { attachMarketExecutionRoleFor } = require('../middleware/require-market-execution-capability');", 'execution middleware require');
  s = replaceOnce(s,
`// market_operator ajouté en lecture — les mutations restent exclusivement
// agent_hub (requireHubWorkspaceAction) et agent_relais (requireRelayWorkspaceAction).
const attachWorkspaceReadDelegation = attachMarketDelegatedRoleFor(['admin', 'agent_hub', 'agent_relais', 'market_operator']);
const requireWorkspaceReadRole = requireRole(['admin', 'agent_hub', 'agent_relais', 'market_operator']);
const requireHubWorkspaceAction = requireRole(['admin', 'agent_hub']);
const requireRelayWorkspaceAction = requireRole(['admin', 'agent_relais']);`,
`// La lecture garde la projection market_operator legacy. Les mutations terrain
// restent compatibles avec les rôles natifs, mais une membership peut aussi
// consommer UNE capability execution.* exacte sans mutation de users.role.
const attachWorkspaceReadDelegation = attachMarketDelegatedRoleFor(['admin', 'agent_hub', 'agent_relais', 'market_operator']);
const requireWorkspaceReadRole = requireRole(['admin', 'agent_hub', 'agent_relais', 'market_operator']);
const requireHubWorkspaceAction = requireRole(['admin', 'agent_hub']);
const requireRelayWorkspaceAction = requireRole(['admin', 'agent_relais']);

const readWorkspaceGuards = [
  attachWorkspaceReadDelegation,
  requireWorkspaceReadRole,
  attachAuthorizedMarkets,
  requireWorkspaceMarketAccess,
];

function hubExecutionGuards(capability) {
  return [
    attachMarketExecutionRoleFor({ capability, compatibilityRole: 'agent_hub', nativeRoles: ['admin', 'agent_hub'] }),
    requireHubWorkspaceAction,
    attachAuthorizedMarkets,
    requireWorkspaceMarketAccess,
  ];
}

function relayExecutionGuards(capability) {
  return [
    attachMarketExecutionRoleFor({ capability, compatibilityRole: 'agent_relais', nativeRoles: ['admin', 'agent_relais'] }),
    requireRelayWorkspaceAction,
    attachAuthorizedMarkets,
    requireWorkspaceMarketAccess,
  ];
}`, 'guard declarations');
  s = replaceOnce(s,
`function requireWorkspaceMarketAccess(req, res, next) {
  const targetMarketId = req.workspaceMarket && req.workspaceMarket.id;
  const marketGuard = requireMarketScope(() => targetMarketId);

  if (req.authorizedMarkets && req.authorizedMarkets.has(targetMarketId)) {`,
`function requireWorkspaceMarketAccess(req, res, next) {
  const targetMarketId = req.workspaceMarket && req.workspaceMarket.id;
  const marketGuard = requireMarketScope(() => targetMarketId);

  // Une action EXECUTION a déjà prouvé assignment + membership + capability
  // sur le marketCode serveur ; elle n'a pas besoin d'un scope legacy projeté.
  if (req.marketExecution && String(req.marketExecution.market_id) === String(targetMarketId)) {
    return next();
  }

  if (req.authorizedMarkets && req.authorizedMarkets.has(targetMarketId)) {`, 'market execution scope');
  s = replaceOnce(s,
`router.use(
  '/market/:marketCode',
  authenticate,
  attachWorkspaceReadDelegation,
  requireWorkspaceReadRole,
  rejectClientMarketAuthority,
  resolveRequestedMarket,
  attachAuthorizedMarkets,
  requireWorkspaceMarketAccess
);

router.get('/market/:marketCode', async (req, res, next) => {`,
`router.use(
  '/market/:marketCode',
  authenticate,
  rejectClientMarketAuthority,
  resolveRequestedMarket
);

router.get('/market/:marketCode', ...readWorkspaceGuards, async (req, res, next) => {`, 'router common guards');
  const mappings = [
    ["router.post('/market/:marketCode/orders/:reference/mark-ordered', requireHubWorkspaceAction,", "router.post('/market/:marketCode/orders/:reference/mark-ordered', ...hubExecutionGuards('execution.order.mark_ordered'),"],
    ["router.post('/market/:marketCode/distribution/run', requireHubWorkspaceAction,", "router.post('/market/:marketCode/distribution/run', ...hubExecutionGuards('execution.distribution.run'),"],
    ["router.post('/market/:marketCode/parcels/:reference/ship', requireHubWorkspaceAction,", "router.post('/market/:marketCode/parcels/:reference/ship', ...hubExecutionGuards('execution.parcel.ship'),"],
    ["router.post('/market/:marketCode/orders/:reference/confirm-cash', requireRelayWorkspaceAction,", "router.post('/market/:marketCode/orders/:reference/confirm-cash', ...relayExecutionGuards('execution.cash.confirm'),"],
    ["router.post('/market/:marketCode/parcels/:reference/receive', requireRelayWorkspaceAction,", "router.post('/market/:marketCode/parcels/:reference/receive', ...relayExecutionGuards('execution.parcel.receive'),"],
    ["router.post('/market/:marketCode/parcels/:reference/collect', requireRelayWorkspaceAction,", "router.post('/market/:marketCode/parcels/:reference/collect', ...relayExecutionGuards('execution.parcel.collect'),"],
    ["router.post('/market/:marketCode/inventory/items/:itemId/assign', requireHubWorkspaceAction,", "router.post('/market/:marketCode/inventory/items/:itemId/assign', ...hubExecutionGuards('execution.inventory.assign'),"],
  ];
  for (const [from, to] of mappings) s = replaceOnce(s, from, to, `route ${from}`);
  write(p, s);
}

// Feature ownership metadata.
{
  const p = 'features/market-delegation.feature.js';
  let s = read(p);
  s = replaceOnce(s,
"      'règle de délégation grant(member) ⊆ grant(grantor) ⊆ ceiling(assignment)',",
"      'règle de délégation : DELEGATION reste grant(member) ⊆ grant(grantor) ⊆ ceiling ; EXECUTION LIVE peut être accordé par team.grant sous ceiling sans devenir un droit du grantor',", 'doctrine grant rule');
  s = replaceOnce(s,
"      'migration 209 : finance.act + settlement.receive deviennent LIVE et sont backfillées dans les ceilings actifs ; auto-grant seulement aux managers déjà dotés de team.grant + team.revoke + finance.read',",
"      'migration 209 : finance.act + settlement.receive deviennent LIVE et sont backfillées dans les ceilings actifs ; auto-grant seulement aux managers déjà dotés de team.grant + team.revoke + finance.read',\n      'LOT 8 (execution bridge) : les 7 capabilities execution.* LIVE entrent dans le ceiling/template sans auto-grant manager ; team.grant peut les déléguer explicitement à un membre terrain et chaque consommation est auditée avant la mutation métier',", 'execution perimeter');
  s = replaceOnce(s,
"      'migrations/210_market_delegation_structure_event_record_live.sql',",
"      'migrations/210_market_delegation_structure_event_record_live.sql',\n      'migrations/212_market_delegation_execution_ceiling.sql',", 'migration feature');
  s = replaceOnce(s,
"      'middleware/require-market-delegated-role.js',",
"      'middleware/require-market-delegated-role.js',\n      'middleware/require-market-execution-capability.js',", 'middleware feature');
  s = replaceOnce(s,
"      'tests/unit/market-delegation-performance-routes.test.js',",
"      'tests/unit/market-delegation-performance-routes.test.js',\n      'tests/unit/market-delegation-execution-capability.test.js',\n      'tests/e2e-api/market-delegation.execution-bridge.e2e.test.js',", 'tests feature');
  write(p, s);
}
{
  const p = 'features/dashboard.feature.js';
  let s = read(p);
  s = replaceOnce(s,
"      'Portail interne unique /admin — même shell Canonical pour administration centrale, opérateurs pays et rôles terrain autorisés',",
"      'Portail interne unique /admin — même shell Canonical pour administration centrale, opérateurs pays et rôles terrain autorisés',\n      'Operations Workspace : les rôles terrain natifs restent compatibles ; une membership pays peut exécuter une mutation seulement avec la capability execution.* exacte, résolue et auditée par market-delegation',", 'dashboard perimeter');
  s = replaceOnce(s,
"      'market-delegation (bridge request-local des memberships projetées vers les surfaces dashboard qui admettent déjà market_operator)',",
"      'market-delegation (bridge request-local pour les lectures market_operator + consommation exacte et auditée des capabilities execution.* sur les mutations Operations Workspace)',", 'dashboard consumes');
  write(p, s);
}

write('tests/unit/market-delegation-execution-capability.test.js', `'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const fs = require('fs');
const path = require('path');
const delegation = require('../../services/market-delegation-service');
const ROOT = path.join(__dirname, '..', '..');

function executor(sequence) {
  return { query: jest.fn(async () => sequence.shift() || { rows: [] }) };
}

describe('market execution capability delegation', () => {
  test('team.grant peut déléguer EXECUTION LIVE du ceiling sans que le manager le possède', async () => {
    const db = executor([
      { rows: [{ capability: 'execution.parcel.ship', class: 'EXECUTION', status: 'LIVE' }] },
      { rows: [{ id: 'm1', assignment_id: 'a1', user_id: 'u1', status: 'ACTIVE' }] },
      { rows: [{ capability: 'team.grant' }] },
    ]);
    await expect(delegation.assertGrantAllowed(db, {
      assignmentId: 'a1', actorUserId: 'u1', capabilities: ['execution.parcel.ship'],
    })).resolves.toMatchObject({ requested: ['execution.parcel.ship'] });
  });

  test('team.grant ne permet pas de déléguer une capability DELEGATION non possédée', async () => {
    const db = executor([
      { rows: [{ capability: 'pricing.activate', class: 'DELEGATION', status: 'LIVE' }] },
      { rows: [{ id: 'm1', assignment_id: 'a1', user_id: 'u1', status: 'ACTIVE' }] },
      { rows: [{ capability: 'team.grant' }] },
    ]);
    await expect(delegation.assertGrantAllowed(db, {
      assignmentId: 'a1', actorUserId: 'u1', capabilities: ['pricing.activate'],
    })).rejects.toMatchObject({ code: 'MARKET_DELEGATION_GRANT_EXCEEDS_GRANTOR' });
  });

  test('migration 212 ouvre les 7 ceilings sans auto-grant membership ni users.role', () => {
    const sql = fs.readFileSync(path.join(ROOT, 'migrations', '212_market_delegation_execution_ceiling.sql'), 'utf8');
    expect(sql).toContain("registry.class = 'EXECUTION'");
    expect(sql).toContain("registry.status = 'LIVE'");
    expect(sql).toContain('EXECUTION_CEILING_OPENED_BY_MIGRATION');
    expect(sql).not.toMatch(/INSERT INTO membership_capabilities/i);
    expect(sql).not.toMatch(/UPDATE users/i);
  });

  test('Workspace mappe chacune des 7 mutations à sa capability exacte', () => {
    const route = fs.readFileSync(path.join(ROOT, 'routes', 'admin-operations-workspace.js'), 'utf8');
    for (const cap of ${JSON.stringify(EXEC)}) expect(route).toContain(cap);
    expect(route).toContain('attachMarketExecutionRoleFor');
  });
});
`);

write('tests/e2e-api/market-delegation.execution-bridge.e2e.test.js', `'use strict';
/** @test-kind e2e @test-runner jest @test-requires postgres */
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { describeE2E } = require('../helpers/e2eDbKit');
const { createMarketDelegationFixture, makeApp } = require('../helpers/marketDelegationE2EKit');

jest.setTimeout(60000);
const ROOT = path.join(__dirname, '..', '..');
const EXEC = ${JSON.stringify(EXEC)};

describeE2E('E2E-MA-EXEC — délégation terrain explicite', ({ db }) => {
  let fx;
  let app;
  let terrainMembershipId;

  beforeAll(async () => {
    fx = await createMarketDelegationFixture(db);
    app = makeApp([
      { mount: '/api/market-delegation', modulePath: '../../routes/market-delegation-team' },
      { mount: '/api/admin/workspaces/operations', modulePath: '../../routes/admin-operations-workspace' },
    ]);
  });

  afterAll(async () => {
    if (fx) {
      await db.query("DELETE FROM market_delegation_audit WHERE assignment_id IN ($1,$2)", [fx.assignmentA.id, fx.assignmentB.id]);
      await fx.cleanup.run();
    }
  });

  test('1 — migration 212 ouvre EXECUTION dans le ceiling sans auto-grant manager/viewer et reste idempotente', async () => {
    const sql = fs.readFileSync(path.join(ROOT, 'migrations', '212_market_delegation_execution_ceiling.sql'), 'utf8');
    await db.query(sql);
    const ceiling = await db.query(
      "SELECT capability FROM assignment_capability_ceiling WHERE assignment_id=$1 AND revoked_at IS NULL AND capability = ANY($2::text[]) ORDER BY capability",
      [fx.assignmentA.id, EXEC]
    );
    expect(ceiling.rows.map(row => row.capability)).toEqual([...EXEC].sort());
    for (const membershipId of [fx.managerAMembership.id, fx.viewerAMembership.id]) {
      const grants = await db.query(
        "SELECT capability FROM membership_capabilities WHERE membership_id=$1 AND revoked_at IS NULL AND capability = ANY($2::text[])",
        [membershipId, EXEC]
      );
      expect(grants.rows).toHaveLength(0);
    }
    const auditBefore = await db.query(
      "SELECT COUNT(*)::int AS n FROM market_delegation_audit WHERE assignment_id=$1 AND action='EXECUTION_CEILING_OPENED_BY_MIGRATION'",
      [fx.assignmentA.id]
    );
    expect(auditBefore.rows[0].n).toBe(EXEC.length);
    await db.query(sql);
    const auditAfter = await db.query(
      "SELECT COUNT(*)::int AS n FROM market_delegation_audit WHERE assignment_id=$1 AND action='EXECUTION_CEILING_OPENED_BY_MIGRATION'",
      [fx.assignmentA.id]
    );
    expect(auditAfter.rows[0].n).toBe(auditBefore.rows[0].n);
  });

  test('2 — le manager délègue execution.distribution.run à un membre terrain sans se l’auto-accorder', async () => {
    const res = await request(app)
      .post(`/api/market-delegation/markets/${fx.marketA.code}/team/invitations`)
      .set('Authorization', fx.managerA.token)
      .send({ email: fx.outsider.email, capabilities: ['execution.distribution.run'] });
    expect(res.status).toBe(201);
    expect(res.body.kind).toBe('membership');
    expect(res.body.capabilities).toContain('execution.distribution.run');
    terrainMembershipId = res.body.membership.id;

    const managerGrant = await db.query(
      "SELECT 1 FROM membership_capabilities WHERE membership_id=$1 AND capability='execution.distribution.run' AND revoked_at IS NULL",
      [fx.managerAMembership.id]
    );
    expect(managerGrant.rows).toHaveLength(0);
  });

  test('3 — le membre terrain exécute son action sur A sans scope legacy et l’autorisation est auditée', async () => {
    const projected = await db.query(
      'SELECT 1 FROM operator_market_scopes WHERE projected_from_membership_id=$1 AND revoked_at IS NULL',
      [terrainMembershipId]
    );
    expect(projected.rows).toHaveLength(0);

    const res = await request(app)
      .post(`/api/admin/workspaces/operations/market/${fx.marketA.code}/distribution/run`)
      .set('Authorization', fx.outsider.token)
      .set('x-correlation-id', 'e2e-exec-distribution')
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.action).toBe('run_distribution');

    const audit = await db.query(
      `SELECT actor_user_id, membership_id, capability, action, correlation_id
         FROM market_delegation_audit
        WHERE assignment_id=$1 AND actor_user_id=$2 AND capability='execution.distribution.run'
          AND action='EXECUTION_AUTHORIZED' AND correlation_id='e2e-exec-distribution'`,
      [fx.assignmentA.id, fx.outsider.id]
    );
    expect(audit.rows).toHaveLength(1);
    expect(String(audit.rows[0].membership_id)).toBe(String(terrainMembershipId));
  });

  test('4 — le même membre est refusé sur B et le manager reste sans autorité terrain implicite', async () => {
    const cross = await request(app)
      .post(`/api/admin/workspaces/operations/market/${fx.marketB.code}/distribution/run`)
      .set('Authorization', fx.outsider.token)
      .send({});
    expect(cross.status).toBe(403);

    const manager = await request(app)
      .post(`/api/admin/workspaces/operations/market/${fx.marketA.code}/distribution/run`)
      .set('Authorization', fx.managerA.token)
      .send({});
    expect(manager.status).toBe(403);
  });

  test('5 — market_id navigateur reste refusé avant toute action terrain', async () => {
    const res = await request(app)
      .post(`/api/admin/workspaces/operations/market/${fx.marketA.code}/distribution/run`)
      .set('Authorization', fx.outsider.token)
      .send({ market_id: fx.marketB.id });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('client_market_id_forbidden');
  });
});
`);

// UI tests: grantable list + explicit terrain preset, never read preset.
{
  const p = 'tests/unit/market-delegation-team-ui.test.js';
  let s = read(p);
  s = s.replace("expect(js).toContain('const available = [...team.actor_capabilities].sort()');", "expect(js).toContain('team.actor_grantable_capabilities || team.actor_capabilities');");
  s = replaceOnce(s,
"    expect(js).toContain(\"'settlement.receive': 'Confirmer la réception d’un règlement'\");",
"    expect(js).toContain(\"'settlement.receive': 'Confirmer la réception d’un règlement'\");\n    expect(js).toContain(\"'execution.parcel.ship': 'Expédier un colis'\");\n    expect(js).toContain(\"'execution.cash.confirm': 'Confirmer un encaissement terrain'\");\n    expect(js).toContain('Preset terrain');", 'UI assertions');
  s = replaceOnce(s,
"    expect(preset[1]).not.toContain(\"'settlement.receive'\");\n  });",
"    expect(preset[1]).not.toContain(\"'settlement.receive'\");\n    expect(preset[1]).not.toContain('execution.');\n  });\n\n  test('le preset terrain est explicite et Même périmètre que moi reste borné aux droits réellement possédés', () => {\n    const js = read('public/dashboards/canonical/js/market-team.js');\n    expect(js).toContain('const TERRAIN_PRESET = Object.freeze');\n    expect(js).toContain(\"'execution.distribution.run'\");\n    expect(js).toContain('actorCapabilities.filter(cap => available.includes(cap))');\n  });", 'UI preset safety');
  write(p, s);
}

// Canonical boundary now expects exact execution capability bridge while keeping native guards.
{
  const p = 'tests/unit/canonical-operations-workspace-boundary.test.js';
  let s = read(p);
  s = replaceOnce(s,
"  expect(workspaceRoute).toContain(\"requireRelayWorkspaceAction = requireRole(['admin', 'agent_relais'])\");",
"  expect(workspaceRoute).toContain(\"requireRelayWorkspaceAction = requireRole(['admin', 'agent_relais'])\");\n  expect(workspaceRoute).toContain('attachMarketExecutionRoleFor');\n  expect(workspaceRoute).toContain('execution.order.mark_ordered');\n  expect(workspaceRoute).toContain('execution.cash.confirm');", 'boundary bridge expectations');
  write(p, s);
}

console.log('execution capability bridge v2 applied');
