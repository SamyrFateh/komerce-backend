/**
 * @komerce-arch
 * @role          market-delegation-team-service
 * @domain        market-delegation
 * @layer         service
 * @criticality   high
 * @inputs        authenticated user, market code, email, membership, capabilities, invitation token
 * @outputs       team read model, invitations, membership mutations
 * @depends       services/market-delegation-service.js, crypto
 * @used-by       routes/market-delegation-team.js
 * @db-read       markets, market_operating_assignments, assignment_memberships, membership_capabilities, assignment_capability_ceiling, users, market_team_invitations
 * @db-write      market_team_invitations
 * @db-write-via:market-delegation-service assignment_memberships, membership_capabilities, market_delegation_audit
 * @db-txn        caller-owned
 * @doctrine      team_authority_is_capability_based, invitation_revalidated_on_acceptance
 * @impact-areas  market, delegation, team, authorization
 * @version       2026-09
 */
'use strict';

const crypto = require('crypto');
const {
  normalizeCapabilities,
  delegationError,
  normalizeMarketCode,
  resolveActiveAssignmentByMarketCode,
  resolveAuthorization,
  audit,
  activeMembershipForUser,
  activeMembershipCapabilities,
  assertGrantAllowed,
  addMembership,
  replaceMembershipCapabilities,
  revokeMembership,
} = require('./market-delegation-service');

const INVITATION_TTL_HOURS = 72;

function requireExecutor(executor) {
  if (!executor || typeof executor.query !== 'function') {
    throw new TypeError('market-delegation-team-service: executor.query requis');
  }
  return executor;
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function invitationTokenHash(token) {
  return crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
}

async function listTeam(executor, { assignmentId }) {
  const db = requireExecutor(executor);
  const { rows: members } = await db.query(
    `SELECT am.id AS membership_id,
            am.user_id,
            am.status,
            am.granted_at,
            am.granted_by,
            u.full_name,
            u.email,
            u.phone,
            u.role AS user_role,
            COALESCE(
              jsonb_agg(mc.capability ORDER BY mc.capability)
                FILTER (WHERE mc.capability IS NOT NULL AND mc.revoked_at IS NULL),
              '[]'::jsonb
            ) AS capabilities
       FROM assignment_memberships am
       JOIN users u ON u.id = am.user_id
       LEFT JOIN membership_capabilities mc ON mc.membership_id = am.id
      WHERE am.assignment_id=$1::uuid
      GROUP BY am.id, u.id
      ORDER BY (am.status='ACTIVE') DESC, am.granted_at ASC`,
    [assignmentId]
  );

  const { rows: invitations } = await db.query(
    `SELECT id,
            email_normalized AS email,
            requested_capabilities,
            invited_by_membership_id,
            status,
            expires_at,
            accepted_at,
            accepted_by_user_id,
            revoked_at,
            created_at
       FROM market_team_invitations
      WHERE assignment_id=$1::uuid
      ORDER BY created_at DESC`,
    [assignmentId]
  );

  return { members, invitations };
}

async function memberInAssignment(executor, { assignmentId, membershipId, forUpdate = false }) {
  const db = requireExecutor(executor);
  const { rows } = await db.query(
    `SELECT id, assignment_id, user_id, status
       FROM assignment_memberships
      WHERE id=$1::uuid AND assignment_id=$2::uuid
      LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
    [membershipId, assignmentId]
  );
  return rows[0] || null;
}

async function inviteTeamMember(executor, {
  assignmentId,
  actorUserId,
  actorMembershipId,
  email,
  capabilities,
  correlationId = null,
  ttlHours = INVITATION_TTL_HOURS,
}) {
  const db = requireExecutor(executor);
  const emailNormalized = normalizeEmail(email);
  if (!emailNormalized) throw delegationError('TEAM_INVITE_EMAIL_INVALID', 'Email d’invitation invalide.', 400);
  const requested = normalizeCapabilities(capabilities);

  await assertGrantAllowed(db, {
    assignmentId,
    capabilities: requested,
    actorUserId,
    actorIsCentral: false,
  });

  const { rows: users } = await db.query(
    `SELECT id, full_name, email, role
       FROM users
      WHERE lower(email)= $1
      LIMIT 1`,
    [emailNormalized]
  );
  if (users[0]) {
    const membership = await addMembership(db, {
      assignmentId,
      userId: users[0].id,
      actorUserId,
      capabilities: requested,
      actorIsCentral: false,
      correlationId,
    });
    return {
      kind: 'membership',
      membership,
      user: users[0],
      capabilities: await activeMembershipCapabilities(db, membership.id),
    };
  }

  if (!Number.isFinite(Number(ttlHours)) || Number(ttlHours) <= 0 || Number(ttlHours) > 168) {
    throw delegationError('TEAM_INVITE_TTL_INVALID', 'Durée d’invitation invalide.', 400);
  }

  await db.query(
    `UPDATE market_team_invitations
        SET status='REVOKED',
            revoked_at=NOW(),
            revoked_by_membership_id=$3::uuid,
            updated_at=NOW()
      WHERE assignment_id=$1::uuid
        AND email_normalized=$2
        AND status='PENDING'`,
    [assignmentId, emailNormalized, actorMembershipId]
  );

  const rawToken = crypto.randomBytes(32).toString('base64url');
  const tokenHash = invitationTokenHash(rawToken);
  const { rows } = await db.query(
    `INSERT INTO market_team_invitations
      (assignment_id, email_normalized, token_hash, requested_capabilities,
       invited_by_membership_id, expires_at)
     VALUES ($1::uuid,$2,$3,$4::jsonb,$5::uuid,NOW() + ($6::text || ' hours')::interval)
     RETURNING id, assignment_id, email_normalized AS email,
               requested_capabilities, invited_by_membership_id,
               status, expires_at, created_at`,
    [assignmentId, emailNormalized, tokenHash, JSON.stringify(requested), actorMembershipId, String(Number(ttlHours))]
  );
  const invitation = rows[0];
  await audit(db, {
    actorUserId,
    assignmentId,
    membershipId: actorMembershipId,
    action: 'TEAM_INVITATION_CREATED',
    after: {
      invitation_id: invitation.id,
      email: emailNormalized,
      requested_capabilities: requested,
      expires_at: invitation.expires_at,
    },
    correlationId,
  });

  return {
    kind: 'invitation',
    invitation,
    token: rawToken,
  };
}

async function acceptInvitation(executor, { token, userId, correlationId = null }) {
  const db = requireExecutor(executor);
  if (!token || String(token).length < 20) {
    throw delegationError('TEAM_INVITATION_INVALID', 'Invitation invalide.', 400);
  }
  const tokenHash = invitationTokenHash(token);
  const { rows } = await db.query(
    `SELECT i.*,
            a.status AS assignment_status,
            inviter.user_id AS inviter_user_id,
            inviter.status AS inviter_membership_status
       FROM market_team_invitations i
       JOIN market_operating_assignments a ON a.id = i.assignment_id
       JOIN assignment_memberships inviter ON inviter.id = i.invited_by_membership_id
      WHERE i.token_hash=$1
      LIMIT 1
      FOR UPDATE OF i`,
    [tokenHash]
  );
  const invitation = rows[0];
  if (!invitation) throw delegationError('TEAM_INVITATION_INVALID', 'Invitation invalide.', 404);
  if (invitation.status !== 'PENDING') {
    throw delegationError('TEAM_INVITATION_NOT_PENDING', 'Cette invitation n’est plus active.', 409);
  }
  if (new Date(invitation.expires_at).getTime() <= Date.now()) {
    await db.query(
      `UPDATE market_team_invitations
          SET status='EXPIRED', updated_at=NOW()
        WHERE id=$1::uuid AND status='PENDING'`,
      [invitation.id]
    );
    throw delegationError('TEAM_INVITATION_EXPIRED', 'Cette invitation a expiré.', 410);
  }
  if (invitation.assignment_status !== 'ACTIVE') {
    throw delegationError('MARKET_ASSIGNMENT_NOT_ACTIVE', 'Le mandat marché n’est plus actif.', 409);
  }
  if (invitation.inviter_membership_status !== 'ACTIVE') {
    throw delegationError('TEAM_INVITER_NOT_ACTIVE', 'Le membre invitant n’est plus actif.', 409);
  }

  const { rows: users } = await db.query(
    `SELECT id, full_name, email, role
       FROM users
      WHERE id=$1::uuid
      LIMIT 1`,
    [userId]
  );
  const user = users[0];
  if (!user) throw delegationError('USER_NOT_FOUND', 'Utilisateur introuvable.', 404);
  if (normalizeEmail(user.email) !== invitation.email_normalized) {
    throw delegationError('TEAM_INVITATION_EMAIL_MISMATCH', 'Cette invitation appartient à un autre email.', 403);
  }

  const requested = normalizeCapabilities(invitation.requested_capabilities);
  const membership = await addMembership(db, {
    assignmentId: invitation.assignment_id,
    userId: user.id,
    actorUserId: invitation.inviter_user_id,
    capabilities: requested,
    actorIsCentral: false,
    correlationId,
  });

  await db.query(
    `UPDATE market_team_invitations
        SET status='ACCEPTED',
            accepted_at=NOW(),
            accepted_by_user_id=$2::uuid,
            updated_at=NOW()
      WHERE id=$1::uuid AND status='PENDING'`,
    [invitation.id, user.id]
  );
  await audit(db, {
    actorUserId: user.id,
    assignmentId: invitation.assignment_id,
    membershipId: membership.id,
    action: 'TEAM_INVITATION_ACCEPTED',
    after: { invitation_id: invitation.id, requested_capabilities: requested },
    correlationId,
  });

  return {
    invitation_id: invitation.id,
    membership,
    capabilities: await activeMembershipCapabilities(db, membership.id),
  };
}

async function replaceTeamMemberCapabilities(executor, {
  assignmentId,
  membershipId,
  actorUserId,
  capabilities,
  correlationId = null,
}) {
  const db = requireExecutor(executor);
  const target = await memberInAssignment(db, { assignmentId, membershipId, forUpdate: true });
  if (!target || target.status !== 'ACTIVE') {
    throw delegationError('TEAM_MEMBER_NOT_ACTIVE', 'Membership cible absente ou inactive.', 404);
  }
  const nextCapabilities = await replaceMembershipCapabilities(db, {
    membershipId,
    capabilities,
    actorUserId,
    actorIsCentral: false,
    correlationId,
  });
  return { membership: target, capabilities: nextCapabilities };
}

async function revokeTeamMember(executor, {
  assignmentId,
  membershipId,
  actorUserId,
  correlationId = null,
}) {
  const db = requireExecutor(executor);
  const target = await memberInAssignment(db, { assignmentId, membershipId, forUpdate: true });
  if (!target || target.status !== 'ACTIVE') {
    throw delegationError('TEAM_MEMBER_NOT_ACTIVE', 'Membership cible absente ou inactive.', 404);
  }
  const revoked = await revokeMembership(db, {
    membershipId,
    actorUserId,
    correlationId,
  });
  return revoked;
}

async function revokeInvitation(executor, {
  assignmentId,
  invitationId,
  actorUserId,
  actorMembershipId,
  correlationId = null,
}) {
  const db = requireExecutor(executor);
  const { rows } = await db.query(
    `UPDATE market_team_invitations
        SET status='REVOKED',
            revoked_at=NOW(),
            revoked_by_membership_id=$3::uuid,
            updated_at=NOW()
      WHERE id=$1::uuid
        AND assignment_id=$2::uuid
        AND status='PENDING'
      RETURNING id, email_normalized AS email, status, revoked_at`,
    [invitationId, assignmentId, actorMembershipId]
  );
  if (!rows[0]) throw delegationError('TEAM_INVITATION_NOT_PENDING', 'Invitation absente ou inactive.', 404);
  await audit(db, {
    actorUserId,
    assignmentId,
    membershipId: actorMembershipId,
    action: 'TEAM_INVITATION_REVOKED',
    after: { invitation_id: invitationId },
    correlationId,
  });
  return rows[0];
}

module.exports = {
  INVITATION_TTL_HOURS,
  normalizeMarketCode,
  normalizeEmail,
  invitationTokenHash,
  resolveActiveAssignmentByMarketCode,
  resolveAuthorization,
  listTeam,
  inviteTeamMember,
  acceptInvitation,
  replaceTeamMemberCapabilities,
  revokeTeamMember,
  revokeInvitation,
};
