/**
 * @komerce-arch
 * @role          market-operator-provisioning
 * @domain        market-delegation
 * @layer         service
 * @criticality   high
 * @inputs        caller_owned_executor, user_id, market_code, scope_role (viewer|manager), actor_id
 * @outputs       delegation membership aligned on the requested scope, projected operator_market_scopes row
 * @depends       services/market-delegation-service.js, services/market-scope-projector.js, services/market-scope-admin-service.js
 * @used-by       routes/admin/users.js, scripts/provision-market-operator.js
 * @db-read       markets, market_operating_assignments, assignment_memberships, assignment_capability_ceiling, capability_registry
 * @db-write      none
 * @db-write-via:market-delegation-service market_operating_assignments, assignment_memberships, membership_capabilities, market_delegation_audit
 * @db-write-via:market-scope-projector operator_market_scopes
 * @db-txn        caller-owned
 * @doctrine      operator_market_scopes_is_market_owned_projection, delegation_membership_is_the_only_authority
 * @impact-areas  market-delegation, market, authorization, admin-dashboard
 * @version       2026-10-v1
 */
'use strict';

/**
 * Une seule façon d'attribuer un scope marché à un opérateur : par une membership de
 * délégation (assignment / membership / capabilities), jamais par une écriture directe
 * dans operator_market_scopes. Cette table reste la projection reconstruite par
 * projectAssignment(). Le script CLI et la route admin utilisent la même logique.
 */

const delegation = require('./market-delegation-service');
const {
  projectAssignment,
  desiredScopesForAssignment,
  LEGACY_VIEWER_CAPABILITIES,
} = require('./market-scope-projector');
const { listActiveScopesForUsers } = require('./market-scope-admin-service');

const VALID_SCOPES = ['viewer', 'manager'];

const MANAGER_CEILING_QUERY = `
  SELECT acc.capability
    FROM assignment_capability_ceiling acc
    JOIN capability_registry registry ON registry.capability = acc.capability
   WHERE acc.assignment_id = $1
     AND acc.revoked_at IS NULL
     AND registry.class = 'DELEGATION'
     AND registry.authority_scope = 'MARKET'
     AND registry.delegation_mode = 'DELEGABLE'
     AND registry.status = 'LIVE'
`;

function provisioningError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

// Un manager reçoit tout le ceiling LIVE de l'assignment. Un viewer reçoit le baseline de
// lecture canonique du projecteur (une seule source de vérité : market-scope-projector).
async function targetCapabilitiesForScope(executor, { assignmentId, scope }) {
  if (scope === 'manager') {
    const { rows } = await executor.query(MANAGER_CEILING_QUERY, [assignmentId]);
    return rows.map(row => row.capability);
  }
  return LEGACY_VIEWER_CAPABILITIES.slice();
}

// Rôle viewer/manager d'un utilisateur dérivé EXACTEMENT comme le fait projectAssignment().
// null = membership aux capabilities personnalisées : on échoue fermé plutôt que de deviner.
async function derivedRoleForUser(executor, { assignmentId, userId }) {
  const desired = await desiredScopesForAssignment(executor, assignmentId);
  const row = desired.find(r => String(r.user_id) === String(userId));
  return row ? row.scope_role : null;
}

async function resolveOrCreateAssignment(client, { marketId, marketCode }) {
  const assignment = await delegation.resolveActiveAssignmentByMarketCode(client, marketCode).catch(err => {
    if (err && err.code === 'MARKET_ASSIGNMENT_NOT_ACTIVE') return null;
    if (err && err.code === 'MARKET_NOT_FOUND') {
      throw new Error(`Marché ${marketCode} inactif ou introuvable — impossible de résoudre/créer le Market Operating Assignment. Réactivez le marché avant de provisionner un opérateur.`);
    }
    throw err;
  });
  if (assignment) return { assignmentId: assignment.assignment_id, created: false };

  const created = await delegation.createAssignment(client, { marketId, status: 'ACTIVE' });
  return { assignmentId: created.id, created: true };
}

function scopeMismatchError({ scope, derivedRole, marketCode, membershipId }) {
  const observed = derivedRole || 'personnalisé (capabilities hors baseline viewer/manager)';
  const error = new Error(
    `Rôle demandé "${scope}" ≠ rôle dérivé des capabilities actuelles ("${observed}") pour cet utilisateur sur ${marketCode}. ` +
    `Aucune écriture effectuée. Changez les capabilities via la route d'administration d'équipe ` +
    `(PUT /markets/${marketCode}/team/${membershipId}/capabilities), puis relancez ce script pour vérifier.`
  );
  error.code = 'MARKET_DELEGATION_SCOPE_MISMATCH';
  return error;
}

/**
 * Aligne la délégation de `userId` sur `scope` pour le marché, dans la transaction de l'appelant.
 *   - pas de membership                         → la crée (capabilities du scope), projette  : 'created'
 *   - membership, rôle dérivé == scope          → ne mute rien, répare la projection         : 'unchanged'
 *   - membership, rôle dérivé != scope
 *       allowRoleChange (acteur central)        → remplace les capabilities, projette        : 'replaced'
 *       sinon                                   → échoue fermé (MARKET_DELEGATION_SCOPE_MISMATCH)
 */
async function ensureOperatorMembership(client, {
  userId, marketId, marketCode, scope, actorUserId = null, allowRoleChange = false,
}) {
  if (!VALID_SCOPES.includes(scope)) throw provisioningError('INVALID_SCOPE_ROLE', 'Le niveau de scope doit valoir viewer ou manager.');

  const { assignmentId } = await resolveOrCreateAssignment(client, { marketId, marketCode });
  const existing = await delegation.activeMembershipForUser(client, assignmentId, userId);

  if (existing) {
    const derivedRole = await derivedRoleForUser(client, { assignmentId, userId });
    if (derivedRole === scope) {
      await projectAssignment(client, assignmentId);
      return { status: 'unchanged', assignmentId, membershipId: existing.id };
    }
    if (!allowRoleChange) {
      throw scopeMismatchError({ scope, derivedRole, marketCode, membershipId: existing.id });
    }
    const capabilities = await targetCapabilitiesForScope(client, { assignmentId, scope });
    await delegation.replaceMembershipCapabilities(client, {
      membershipId: existing.id, capabilities, actorUserId, actorIsCentral: true,
    });
    await projectAssignment(client, assignmentId);
    return { status: 'replaced', assignmentId, membershipId: existing.id };
  }

  const capabilities = await targetCapabilitiesForScope(client, { assignmentId, scope });
  const membership = await delegation.addMembership(client, {
    assignmentId, userId, capabilities, actorUserId, actorIsCentral: true,
  });
  await projectAssignment(client, assignmentId);
  return { status: 'created', assignmentId, membershipId: membership && membership.id };
}

const STATUS_BY_OUTCOME = Object.freeze({ created: 'granted', replaced: 'replaced', unchanged: 'unchanged' });

/**
 * Contrat historique de la route admin (statuts granted | replaced | unchanged |
 * market_not_found | invalid_scope_role) servi par la délégation : le scope renvoyé est la
 * ligne PROJETÉE, jamais une écriture directe.
 */
async function grantOperatorScope(client, { userId, marketCode, scopeRole, grantedBy = null }) {
  const code = String(marketCode || '').trim().toUpperCase();
  const scope = String(scopeRole || '').trim().toLowerCase();
  if (!VALID_SCOPES.includes(scope)) return { status: 'invalid_scope_role', scope: null };

  const { rows: [market] } = await client.query(
    'SELECT id, code FROM markets WHERE code = $1 AND is_active = true LIMIT 1', [code]
  );
  if (!market) return { status: 'market_not_found', scope: null };

  const outcome = await ensureOperatorMembership(client, {
    userId, marketId: market.id, marketCode: market.code, scope, actorUserId: grantedBy, allowRoleChange: true,
  });
  const scopes = await listActiveScopesForUsers(client, [userId]);
  const projected = scopes.find(row => row.market_code === market.code) || null;
  return { status: STATUS_BY_OUTCOME[outcome.status], scope: projected };
}

async function revokeOperatorScope(client, { userId, marketCode, revokedBy = null }) {
  const code = String(marketCode || '').trim().toUpperCase();
  const { rows: [market] } = await client.query(
    'SELECT id, code FROM markets WHERE code = $1 AND is_active = true LIMIT 1', [code]
  );
  if (!market) return { status: 'market_not_found', revoked: null };

  const assignment = await delegation.resolveActiveAssignmentByMarketCode(client, code).catch(err => {
    if (err && err.code === 'MARKET_ASSIGNMENT_NOT_ACTIVE') return null;
    throw err;
  });
  if (!assignment) return { status: 'not_active', revoked: null };

  const membership = await delegation.activeMembershipForUser(client, assignment.assignment_id, userId);
  if (!membership) return { status: 'not_active', revoked: null };

  const scopes = await listActiveScopesForUsers(client, [userId]);
  const projected = scopes.find(row => row.market_code === market.code) || null;
  const revokedMembership = await delegation.revokeMembership(client, {
    membershipId: membership.id,
    actorUserId: revokedBy,
    allowLastGrantor: true,
  });
  await projectAssignment(client, assignment.assignment_id);

  return {
    status: 'revoked',
    revoked: projected ? {
      ...projected,
      revoked_at: revokedMembership.revoked_at,
      revoked_by: revokedBy,
    } : {
      membership_id: membership.id,
      market_id: market.id,
      market_code: market.code,
      revoked_at: revokedMembership.revoked_at,
      revoked_by: revokedBy,
    },
  };
}

async function revokeAllOperatorScopes(client, { userId, revokedBy = null }) {
  const { rows: memberships } = await client.query(
    `SELECT am.id AS membership_id, am.assignment_id
       FROM assignment_memberships am
       JOIN market_operating_assignments a ON a.id = am.assignment_id
      WHERE am.user_id = $1::uuid
        AND am.status = 'ACTIVE'
      ORDER BY am.id
      FOR UPDATE OF am`,
    [userId]
  );

  const revoked = [];
  for (const membership of memberships) {
    const row = await delegation.revokeMembership(client, {
      membershipId: membership.membership_id,
      actorUserId: revokedBy,
      allowLastGrantor: true,
    });
    await projectAssignment(client, membership.assignment_id);
    revoked.push(row);
  }
  return revoked;
}

module.exports = {
  VALID_SCOPES,
  derivedRoleForUser,
  ensureOperatorMembership,
  grantOperatorScope,
  revokeOperatorScope,
  revokeAllOperatorScopes,
  resolveOrCreateAssignment,
  targetCapabilitiesForScope,
};
