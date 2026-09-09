/**
 * @komerce-arch
 * @role          market-delegation-write-service
 * @domain        market-delegation
 * @layer         service
 * @criticality   high
 * @inputs        assignment, ceiling, memberships, member_capabilities, actor
 * @outputs       delegated_market_authority
 * @depends       services/capability-registry.js
 * @used-by       future market-delegation routes, market-scope-projector
 * @db-read       markets, capability_registry, ceiling_templates, ceiling_template_capabilities, market_operating_assignments, assignment_capability_ceiling, assignment_memberships, membership_capabilities
 * @db-write      market_operating_assignments, assignment_capability_ceiling, assignment_memberships, membership_capabilities, market_delegation_audit
 * @db-txn        caller-owned
 * @doctrine      one_active_assignment_per_market, delegated_rights_subset
 * @impact-areas  market, authorization, delegation
 * @version       2026-09
 */
'use strict';

const { validateCeilingCapabilities } = require('./capability-registry');

function requireExecutor(executor) {
  if (!executor || typeof executor.query !== 'function') throw new TypeError('market-delegation-service: executor.query requis');
  return executor;
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
  const requested = [...new Set((capabilities || []).map(String))];
  const validation = await validateCeilingCapabilities(db, requested);
  if (!validation.ok) {
    const error = new Error(`market_delegation_invalid_ceiling:${validation.invalid.join(',')}`);
    error.code = 'MARKET_DELEGATION_INVALID_CEILING';
    throw error;
  }
  const { rows: previous } = await db.query(`SELECT capability FROM assignment_capability_ceiling WHERE assignment_id=$1::uuid AND revoked_at IS NULL`, [assignmentId]);
  await db.query(`UPDATE assignment_capability_ceiling SET revoked_at=NOW(), revoked_by=$2::uuid WHERE assignment_id=$1::uuid AND revoked_at IS NULL AND NOT (capability = ANY($3::text[]))`, [assignmentId, actorUserId, requested]);
  for (const capability of requested) {
    await db.query(
      `INSERT INTO assignment_capability_ceiling (assignment_id, capability, granted_by)
       SELECT $1::uuid,$2,$3::uuid
       WHERE NOT EXISTS (SELECT 1 FROM assignment_capability_ceiling WHERE assignment_id=$1::uuid AND capability=$2 AND revoked_at IS NULL)`,
      [assignmentId, capability, actorUserId]
    );
  }
  await audit(db, { actorUserId, assignmentId, action: 'CEILING_REPLACED', before: previous.map(r => r.capability), after: requested, correlationId });
  return requested;
}

async function addMembership(executor, { assignmentId, userId, actorUserId = null, capabilities = [], actorIsCentral = false, correlationId = null }) {
  const db = requireExecutor(executor);
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

async function activeMembershipForUser(db, assignmentId, userId) {
  const { rows } = await db.query(`SELECT id FROM assignment_memberships WHERE assignment_id=$1::uuid AND user_id=$2::uuid AND status='ACTIVE' LIMIT 1`, [assignmentId, userId]);
  return rows[0] || null;
}

async function grantMembershipCapabilities(executor, { membershipId, capabilities, actorUserId = null, actorIsCentral = false, correlationId = null }) {
  const db = requireExecutor(executor);
  const requested = [...new Set((capabilities || []).map(String))];
  const { rows: targetRows } = await db.query(`SELECT id, assignment_id FROM assignment_memberships WHERE id=$1::uuid AND status='ACTIVE' LIMIT 1`, [membershipId]);
  const target = targetRows[0];
  if (!target) throw new Error('market_delegation_membership_not_active');
  const { rows: ceilingRows } = await db.query(`SELECT capability FROM assignment_capability_ceiling WHERE assignment_id=$1::uuid AND revoked_at IS NULL AND capability = ANY($2::text[])`, [target.assignment_id, requested]);
  const ceiling = new Set(ceilingRows.map(row => row.capability));
  const aboveCeiling = requested.filter(cap => !ceiling.has(cap));
  if (aboveCeiling.length) throw new Error(`market_delegation_capability_above_ceiling:${aboveCeiling.join(',')}`);

  if (!actorIsCentral && requested.length) {
    const grantorMembership = await activeMembershipForUser(db, target.assignment_id, actorUserId);
    if (!grantorMembership) throw new Error('market_delegation_grantor_membership_required');
    const { rows: grantorRows } = await db.query(`SELECT capability FROM membership_capabilities WHERE membership_id=$1::uuid AND revoked_at IS NULL AND capability = ANY($2::text[])`, [grantorMembership.id, requested]);
    const grantorCaps = new Set(grantorRows.map(row => row.capability));
    const forbidden = requested.filter(cap => !grantorCaps.has(cap));
    if (forbidden.length) throw new Error(`market_delegation_grant_exceeds_grantor:${forbidden.join(',')}`);
  }

  for (const capability of requested) {
    await db.query(
      `INSERT INTO membership_capabilities (membership_id, capability, granted_by)
       SELECT $1::uuid,$2,$3::uuid
       WHERE NOT EXISTS (SELECT 1 FROM membership_capabilities WHERE membership_id=$1::uuid AND capability=$2 AND revoked_at IS NULL)`,
      [membershipId, capability, actorUserId]
    );
    await audit(db, { actorUserId, assignmentId: target.assignment_id, membershipId, capability, action: 'CAPABILITY_GRANTED', correlationId });
  }
  return requested;
}

async function revokeMembership(executor, { membershipId, actorUserId = null, correlationId = null }) {
  const db = requireExecutor(executor);
  const { rows } = await db.query(
    `UPDATE assignment_memberships SET status='REVOKED', revoked_at=NOW(), revoked_by=$2::uuid
      WHERE id=$1::uuid AND status='ACTIVE' RETURNING *`, [membershipId, actorUserId]
  );
  if (!rows[0]) return null;
  await db.query(`UPDATE membership_capabilities SET revoked_at=NOW(), revoked_by=$2::uuid WHERE membership_id=$1::uuid AND revoked_at IS NULL`, [membershipId, actorUserId]);
  await audit(db, { actorUserId, assignmentId: rows[0].assignment_id, membershipId, action: 'MEMBERSHIP_REVOKED', correlationId });
  return rows[0];
}

module.exports = {
  createAssignment,
  setAssignmentStatus,
  replaceCeiling,
  addMembership,
  grantMembershipCapabilities,
  revokeMembership,
};
