/**
 * @komerce-arch
 * @role          market-delegation-write-service
 * @domain        market-delegation
 * @layer         service
 * @criticality   high
 * @inputs        assignment, ceiling, memberships, member_capabilities, actor
 * @outputs       delegated_market_authority
 * @depends       services/capability-registry.js
 * @used-by       market-delegation routes, market-scope-projector, team service
 * @db-read       markets, capability_registry, ceiling_templates, ceiling_template_capabilities, market_operating_assignments, assignment_capability_ceiling, assignment_memberships, membership_capabilities
 * @db-write      market_operating_assignments, assignment_capability_ceiling, assignment_memberships, membership_capabilities, market_delegation_audit
 * @db-txn        caller-owned
 * @doctrine      one_active_assignment_per_market, delegated_rights_subset, keep_one_team_grantor
 * @impact-areas  market, authorization, delegation
 * @version       2026-09
 */
'use strict';

const { validateCeilingCapabilities } = require('./capability-registry');

function requireExecutor(executor) {
  if (!executor || typeof executor.query !== 'function') throw new TypeError('market-delegation-service: executor.query requis');
  return executor;
}

function normalizeCapabilities(capabilities) {
  return [...new Set((capabilities || []).filter(Boolean).map(String))].sort();
}

function delegationError(code, message, status = 403) {
  const error = new Error(message || code);
  error.code = code;
  error.status = status;
  return error;
}

function normalizeMarketCode(value) {
  const code = String(value || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

async function resolveActiveAssignmentByMarketCode(executor, marketCode) {
  const db = requireExecutor(executor);
  const code = normalizeMarketCode(marketCode);
  if (!code) throw delegationError('MARKET_CODE_INVALID', 'Code marché invalide.', 400);

  const { rows } = await db.query(
    `SELECT m.id AS market_id,
            m.code AS market_code,
            m.name AS market_name,
            m.currency,
            a.id AS assignment_id,
            a.status AS assignment_status
       FROM markets m
       LEFT JOIN market_operating_assignments a
         ON a.market_id = m.id AND a.status = 'ACTIVE'
      WHERE m.code = $1
        AND m.is_active = TRUE
      LIMIT 1`,
    [code]
  );
  const row = rows[0];
  if (!row) throw delegationError('MARKET_NOT_FOUND', `Marché ${code} introuvable ou inactif.`, 404);
  if (!row.assignment_id) {
    throw delegationError('MARKET_ASSIGNMENT_NOT_ACTIVE', `Aucun Market Operating Assignment actif pour ${code}.`, 409);
  }
  return row;
}

async function audit(db, { actorUserId = null, assignmentId = null, membershipId = null, capability = null, action, before = null, after = null, correlationId = null }) {
  await db.query(
    `INSERT INTO market_delegation_audit
      (actor_user_id, assignment_id, membership_id, capability, action, payload_before, payload_after, correlation_id)
     VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6::jsonb,$7::jsonb,$8)`,
    [actorUserId, assignmentId, membershipId, capability, action,
      before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after), correlationId]
  );
}

async function currentTemplate(db) {
  const { rows } = await db.query(`SELECT id, name, version FROM ceiling_templates WHERE is_current = TRUE LIMIT 1`);
  if (!rows[0]) throw new Error('market_delegation_current_ceiling_template_missing');
  return rows[0];
}

async function createAssignment(executor, { marketId, actorUserId = null, effectiveFrom = null, effectiveUntil = null, status = 'DRAFT', templateId = null, correlationId = null }) {
  const db = requireExecutor(executor);
  const template = templateId ? { id: templateId } : await currentTemplate(db);
  const { rows } = await db.query(
    `INSERT INTO market_operating_assignments (market_id,status,effective_from,effective_until,granted_by)
     VALUES ($1::uuid,$2,COALESCE($3::timestamptz,NOW()),$4::timestamptz,$5::uuid)
     RETURNING *`, [marketId, status, effectiveFrom, effectiveUntil, actorUserId]
  );
  const assignment = rows[0];
  await db.query(
    `INSERT INTO assignment_capability_ceiling (assignment_id, capability, granted_by)
     SELECT $1::uuid, ctc.capability, $2::uuid
       FROM ceiling_template_capabilities ctc
      WHERE ctc.template_id = $3::uuid
     ON CONFLICT DO NOTHING`, [assignment.id, actorUserId, template.id]
  );
  await audit(db, { actorUserId, assignmentId: assignment.id, action: 'ASSIGNMENT_CREATED', after: { market_id: marketId, status, template_id: template.id }, correlationId });
  return assignment;
}

async function setAssignmentStatus(executor, { assignmentId, status, actorUserId = null, correlationId = null }) {
  const db = requireExecutor(executor);
  const { rows: beforeRows } = await db.query(`SELECT id, market_id, status FROM market_operating_assignments WHERE id=$1::uuid FOR UPDATE`, [assignmentId]);
  if (!beforeRows[0]) return null;
  const { rows } = await db.query(
    `UPDATE market_operating_assignments SET status=$2, updated_at=NOW() WHERE id=$1::uuid RETURNING *`,
    [assignmentId, status]
  );
  await audit(db, { actorUserId, assignmentId, action: 'ASSIGNMENT_STATUS_CHANGED', before: beforeRows[0], after: { status }, correlationId });
  return rows[0];
}

async function replaceCeiling(executor, { assignmentId, capabilities, actorUserId = null, correlationId = null }) {
  const db = requireExecutor(executor);
  const requested = normalizeCapabilities(capabilities);
  const validation = await validateCeilingCapabilities(db, requested);
  if (!validation.ok) {
    const error = new Error(`market_delegation_invalid_ceiling:${validation.invalid.join(',')}`);
    error.code = 'MARKET_DELEGATION_INVALID_CEILING';
    throw error;
  }

  const { rows: previousRows } = await db.query(
    `SELECT capability FROM assignment_capability_ceiling
      WHERE assignment_id=$1::uuid AND revoked_at IS NULL
      FOR UPDATE`, [assignmentId]
  );
  const previous = previousRows.map(row => row.capability);
  const requestedSet = new Set(requested);
  const removed = previous.filter(capability => !requestedSet.has(capability));

  if (removed.length) {
    const { rows: revokedGrants } = await db.query(
      `UPDATE membership_capabilities mc
          SET revoked_at=NOW(), revoked_by=$2::uuid
         FROM assignment_memberships am
        WHERE mc.membership_id=am.id
          AND am.assignment_id=$1::uuid
          AND am.status='ACTIVE'
          AND mc.revoked_at IS NULL
          AND mc.capability = ANY($3::text[])
      RETURNING mc.membership_id, mc.capability`,
      [assignmentId, actorUserId, removed]
    );
    for (const grant of revokedGrants) {
      await audit(db, {
        actorUserId,
        assignmentId,
        membershipId: grant.membership_id,
        capability: grant.capability,
        action: 'CAPABILITY_REVOKED_BY_CEILING',
        correlationId,
      });
    }
  }

  await db.query(
    `UPDATE assignment_capability_ceiling
        SET revoked_at=NOW(), revoked_by=$2::uuid
      WHERE assignment_id=$1::uuid
        AND revoked_at IS NULL
        AND NOT (capability = ANY($3::text[]))`,
    [assignmentId, actorUserId, requested]
  );

  for (const capability of requested) {
    await db.query(
      `INSERT INTO assignment_capability_ceiling (assignment_id, capability, granted_by)
       SELECT $1::uuid,$2,$3::uuid
       WHERE NOT EXISTS (
         SELECT 1 FROM assignment_capability_ceiling
          WHERE assignment_id=$1::uuid AND capability=$2 AND revoked_at IS NULL
       )`,
      [assignmentId, capability, actorUserId]
    );
  }

  await audit(db, { actorUserId, assignmentId, action: 'CEILING_REPLACED', before: previous, after: requested, correlationId });
  return requested;
}

async function activeMembershipForUser(executor, assignmentId, userId) {
  const db = requireExecutor(executor);
  const { rows } = await db.query(
    `SELECT id, assignment_id, user_id, status
       FROM assignment_memberships
      WHERE assignment_id=$1::uuid AND user_id=$2::uuid AND status='ACTIVE'
      LIMIT 1`, [assignmentId, userId]
  );
  return rows[0] || null;
}

async function activeMembershipCapabilities(executor, membershipId) {
  const db = requireExecutor(executor);
  const { rows } = await db.query(
    `SELECT capability
       FROM membership_capabilities
      WHERE membership_id=$1::uuid AND revoked_at IS NULL
      ORDER BY capability`, [membershipId]
  );
  return rows.map(row => row.capability);
}

// Porte d'entrée générique de toute route market-delegation : résout le
// marché → l'assignment ACTIVE → la membership de l'appelant → vérifie que la
// capability requise est à la fois détenue par le membre et toujours dans le
// ceiling actif de l'assignment. Utilisée par team/network/provider — un seul
// point de vérité pour "qui peut faire quoi sur quel marché".
async function resolveAuthorization(executor, { userId, marketCode, requiredCapability }) {
  const db = requireExecutor(executor);
  if (!userId) throw delegationError('AUTH_REQUIRED', 'Authentification requise.', 401);
  const assignment = await resolveActiveAssignmentByMarketCode(db, marketCode);
  const membership = await activeMembershipForUser(db, assignment.assignment_id, userId);
  if (!membership) {
    throw delegationError('MARKET_MEMBERSHIP_REQUIRED', 'Aucune membership active sur ce Market ID.', 403);
  }

  const capabilities = await activeMembershipCapabilities(db, membership.id);
  if (requiredCapability && !capabilities.includes(requiredCapability)) {
    throw delegationError(
      'MARKET_CAPABILITY_REQUIRED',
      `Capability ${requiredCapability} requise.`,
      403
    );
  }

  if (requiredCapability) {
    const { rows } = await db.query(
      `SELECT 1
         FROM assignment_capability_ceiling
        WHERE assignment_id=$1::uuid
          AND capability=$2
          AND revoked_at IS NULL
        LIMIT 1`,
      [assignment.assignment_id, requiredCapability]
    );
    if (!rows[0]) {
      throw delegationError('MARKET_CAPABILITY_OUTSIDE_CEILING', 'Capability absente du ceiling actif.', 403);
    }
  }

  return {
    ...assignment,
    membership_id: membership.id,
    membership_user_id: membership.user_id,
    capabilities,
  };
}

async function assertGrantAllowed(db, { assignmentId, capabilities, actorUserId = null, actorIsCentral = false }) {
  const requested = normalizeCapabilities(capabilities);
  if (!requested.length) return { requested, grantorMembership: null };

  const { rows: ceilingRows } = await db.query(
    `SELECT capability FROM assignment_capability_ceiling
      WHERE assignment_id=$1::uuid AND revoked_at IS NULL AND capability = ANY($2::text[])`,
    [assignmentId, requested]
  );
  const ceiling = new Set(ceilingRows.map(row => row.capability));
  const aboveCeiling = requested.filter(capability => !ceiling.has(capability));
  if (aboveCeiling.length) {
    const error = new Error(`market_delegation_capability_above_ceiling:${aboveCeiling.join(',')}`);
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
  const forbidden = requested.filter(capability => !grantorCaps.has(capability));
  if (forbidden.length) {
    const error = new Error(`market_delegation_grant_exceeds_grantor:${forbidden.join(',')}`);
    error.code = 'MARKET_DELEGATION_GRANT_EXCEEDS_GRANTOR';
    throw error;
  }
  return { requested, grantorMembership };
}

async function addMembership(executor, { assignmentId, userId, actorUserId = null, capabilities = [], actorIsCentral = false, correlationId = null }) {
  const db = requireExecutor(executor);
  const existing = await activeMembershipForUser(db, assignmentId, userId);
  if (existing) {
    await grantMembershipCapabilities(db, { membershipId: existing.id, capabilities, actorUserId, actorIsCentral, correlationId });
    return existing;
  }

  await assertGrantAllowed(db, { assignmentId, capabilities, actorUserId, actorIsCentral });
  const { rows } = await db.query(
    `INSERT INTO assignment_memberships (assignment_id,user_id,status,granted_by)
     VALUES ($1::uuid,$2::uuid,'ACTIVE',$3::uuid)
     RETURNING *`, [assignmentId, userId, actorUserId]
  );
  const membership = rows[0];
  await grantMembershipCapabilities(db, { membershipId: membership.id, capabilities, actorUserId, actorIsCentral, correlationId });
  await audit(db, { actorUserId, assignmentId, membershipId: membership.id, action: 'MEMBERSHIP_CREATED', after: { user_id: userId }, correlationId });
  return membership;
}

async function grantMembershipCapabilities(executor, { membershipId, capabilities, actorUserId = null, actorIsCentral = false, correlationId = null }) {
  const db = requireExecutor(executor);
  const { rows: targetRows } = await db.query(
    `SELECT id, assignment_id FROM assignment_memberships
      WHERE id=$1::uuid AND status='ACTIVE' LIMIT 1`, [membershipId]
  );
  const target = targetRows[0];
  if (!target) {
    const error = new Error('market_delegation_membership_not_active');
    error.code = 'MARKET_DELEGATION_MEMBERSHIP_NOT_ACTIVE';
    throw error;
  }
  const { requested } = await assertGrantAllowed(db, {
    assignmentId: target.assignment_id,
    capabilities,
    actorUserId,
    actorIsCentral,
  });

  for (const capability of requested) {
    const { rowCount } = await db.query(
      `INSERT INTO membership_capabilities (membership_id, capability, granted_by)
       SELECT $1::uuid,$2,$3::uuid
       WHERE NOT EXISTS (
         SELECT 1 FROM membership_capabilities
          WHERE membership_id=$1::uuid AND capability=$2 AND revoked_at IS NULL
       )`,
      [membershipId, capability, actorUserId]
    );
    if (rowCount) {
      await audit(db, { actorUserId, assignmentId: target.assignment_id, membershipId, capability, action: 'CAPABILITY_GRANTED', correlationId });
    }
  }
  return requested;
}

async function assertTeamGrantContinuity(db, { assignmentId, targetMembershipId, removingCapabilities }) {
  if (!removingCapabilities.includes('team.grant')) return;
  const { rows } = await db.query(
    `SELECT EXISTS (
       SELECT 1
         FROM assignment_memberships am
         JOIN membership_capabilities mc ON mc.membership_id = am.id
        WHERE am.assignment_id=$1::uuid
          AND am.status='ACTIVE'
          AND am.id <> $2::uuid
          AND mc.capability='team.grant'
          AND mc.revoked_at IS NULL
     ) AS has_other_grantor`,
    [assignmentId, targetMembershipId]
  );
  if (!rows[0]?.has_other_grantor) {
    const error = new Error('market_delegation_last_team_grantor');
    error.code = 'MARKET_DELEGATION_LAST_TEAM_GRANTOR';
    throw error;
  }
}

async function replaceMembershipCapabilities(executor, { membershipId, capabilities, actorUserId = null, actorIsCentral = false, correlationId = null }) {
  const db = requireExecutor(executor);
  const { rows: targetRows } = await db.query(
    `SELECT id, assignment_id, user_id
       FROM assignment_memberships
      WHERE id=$1::uuid AND status='ACTIVE'
      LIMIT 1 FOR UPDATE`, [membershipId]
  );
  const target = targetRows[0];
  if (!target) {
    const error = new Error('market_delegation_membership_not_active');
    error.code = 'MARKET_DELEGATION_MEMBERSHIP_NOT_ACTIVE';
    throw error;
  }

  const { requested } = await assertGrantAllowed(db, {
    assignmentId: target.assignment_id,
    capabilities,
    actorUserId,
    actorIsCentral,
  });
  const previous = await activeMembershipCapabilities(db, membershipId);
  const requestedSet = new Set(requested);
  const previousSet = new Set(previous);
  const removed = previous.filter(capability => !requestedSet.has(capability));
  const added = requested.filter(capability => !previousSet.has(capability));

  await assertTeamGrantContinuity(db, {
    assignmentId: target.assignment_id,
    targetMembershipId: membershipId,
    removingCapabilities: removed,
  });

  if (removed.length) {
    const { rows: revoked } = await db.query(
      `UPDATE membership_capabilities
          SET revoked_at=NOW(), revoked_by=$2::uuid
        WHERE membership_id=$1::uuid
          AND revoked_at IS NULL
          AND capability = ANY($3::text[])
      RETURNING capability`,
      [membershipId, actorUserId, removed]
    );
    for (const row of revoked) {
      await audit(db, {
        actorUserId,
        assignmentId: target.assignment_id,
        membershipId,
        capability: row.capability,
        action: 'CAPABILITY_REVOKED',
        correlationId,
      });
    }
  }

  if (added.length) {
    await grantMembershipCapabilities(db, {
      membershipId,
      capabilities: added,
      actorUserId,
      actorIsCentral,
      correlationId,
    });
  }

  await audit(db, {
    actorUserId,
    assignmentId: target.assignment_id,
    membershipId,
    action: 'MEMBERSHIP_CAPABILITIES_REPLACED',
    before: previous,
    after: requested,
    correlationId,
  });
  return requested;
}

async function revokeMembership(executor, { membershipId, actorUserId = null, correlationId = null, allowLastGrantor = false }) {
  const db = requireExecutor(executor);
  const { rows: targetRows } = await db.query(
    `SELECT id, assignment_id, user_id
       FROM assignment_memberships
      WHERE id=$1::uuid AND status='ACTIVE'
      LIMIT 1 FOR UPDATE`, [membershipId]
  );
  const target = targetRows[0];
  if (!target) return null;

  if (!allowLastGrantor) {
    const previous = await activeMembershipCapabilities(db, membershipId);
    await assertTeamGrantContinuity(db, {
      assignmentId: target.assignment_id,
      targetMembershipId: membershipId,
      removingCapabilities: previous,
    });
  }

  const { rows } = await db.query(
    `UPDATE assignment_memberships SET status='REVOKED', revoked_at=NOW(), revoked_by=$2::uuid
      WHERE id=$1::uuid AND status='ACTIVE' RETURNING *`, [membershipId, actorUserId]
  );
  if (!rows[0]) return null;
  await db.query(
    `UPDATE membership_capabilities SET revoked_at=NOW(), revoked_by=$2::uuid
      WHERE membership_id=$1::uuid AND revoked_at IS NULL`,
    [membershipId, actorUserId]
  );
  await audit(db, { actorUserId, assignmentId: rows[0].assignment_id, membershipId, action: 'MEMBERSHIP_REVOKED', correlationId });
  return rows[0];
}

module.exports = {
  normalizeCapabilities,
  delegationError,
  normalizeMarketCode,
  resolveActiveAssignmentByMarketCode,
  resolveAuthorization,
  audit,
  createAssignment,
  setAssignmentStatus,
  replaceCeiling,
  activeMembershipForUser,
  activeMembershipCapabilities,
  assertGrantAllowed,
  addMembership,
  grantMembershipCapabilities,
  replaceMembershipCapabilities,
  revokeMembership,
};
