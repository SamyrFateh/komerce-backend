/**
 * @komerce-arch
 * @role          market-delegation-team-service
 * @domain        market-delegation
 * @layer         service
 * @criticality   high
 * @inputs        authenticated user, market code, email, membership, capabilities, invitation token
 * @outputs       team read model, central market team matrix, invitations, membership mutations
 * @depends       services/market-delegation-service.js, crypto
 * @used-by       routes/market-delegation-team.js
 * @db-read       markets, market_operating_assignments, assignment_memberships, membership_capabilities, assignment_capability_ceiling, users, market_team_invitations, market_delegation_audit
 * @db-write      market_team_invitations
 * @db-write-via:market-delegation-service assignment_memberships, membership_capabilities, market_delegation_audit
 * @db-txn        caller-owned
 * @doctrine      team_authority_is_capability_based, invitation_revalidated_on_acceptance
 * @impact-areas  market, delegation, team, authorization
 * @version       2026-10
 */
'use strict';

const crypto = require('crypto');
const { normalizePhone } = require('../utils/phone');
const {
  normalizeCapabilities,
  delegationError,
  normalizeMarketCode,
  resolveActiveAssignmentByMarketCode,
  resolveAuthorization,
  audit,
  activeMembershipForUser,
  activeMembershipCapabilities,
  grantableCapabilitiesForActor,
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

function normalizeInvitationChannel(value) {
  const channel = String(value || 'EMAIL').trim().toUpperCase();
  return channel === 'EMAIL' || channel === 'WHATSAPP' ? channel : null;
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
            phone_e164,
            channel,
            requested_capabilities,
            invited_by_membership_id,
            invited_by_user_id,
            grants_operating_lead,
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

async function listCentralTeamMatrix(executor) {
  const db = requireExecutor(executor);
  const { rows } = await db.query(
    `SELECT m.id AS market_id,
            m.code AS market_code,
            m.name AS market_name,
            m.currency,
            m.lifecycle_status,
            a.id AS assignment_id,
            a.status AS assignment_status,
            a.central_referent_user_id,
            COALESCE(team.members, '[]'::jsonb) AS members,
            last_audit.action AS last_audit_action,
            last_audit.actor_user_id AS last_audit_actor_user_id,
            last_audit.created_at AS last_audit_at,
            last_audit.correlation_id AS last_audit_correlation_id
       FROM markets m
       JOIN market_operating_assignments a
         ON a.market_id = m.id
        AND a.status = 'ACTIVE'
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(
                  jsonb_build_object(
                    'membership_id', am.id,
                    'user_id', am.user_id,
                    'status', am.status,
                    'is_operating_lead', am.is_operating_lead,
                    'full_name', u.full_name,
                    'email', u.email,
                    'phone', u.phone,
                    'user_role', u.role,
                    'capabilities', COALESCE(caps.capabilities, '[]'::jsonb)
                  )
                  ORDER BY am.is_operating_lead DESC, am.granted_at ASC, am.id
                ) AS members
           FROM assignment_memberships am
           JOIN users u ON u.id = am.user_id
           LEFT JOIN LATERAL (
             SELECT jsonb_agg(mc.capability ORDER BY mc.capability) AS capabilities
               FROM membership_capabilities mc
              WHERE mc.membership_id = am.id
                AND mc.revoked_at IS NULL
           ) caps ON TRUE
          WHERE am.assignment_id = a.id
            AND am.status = 'ACTIVE'
       ) team ON TRUE
       LEFT JOIN LATERAL (
         SELECT mda.action,
                mda.actor_user_id,
                mda.created_at,
                mda.correlation_id
           FROM market_delegation_audit mda
          WHERE mda.assignment_id = a.id
          ORDER BY mda.created_at DESC, mda.id DESC
          LIMIT 1
       ) last_audit ON TRUE
      WHERE m.lifecycle_status IN ('ACTIVE','SUSPENDED')
      ORDER BY m.code`
  );

  return {
    authority: 'dashboard_global_access_grants',
    mode: 'read_only',
    markets: rows.map(row => ({
      market: {
        id: row.market_id,
        code: row.market_code,
        name: row.market_name,
        currency: row.currency,
        lifecycle_status: row.lifecycle_status,
      },
      assignment: {
        id: row.assignment_id,
        status: row.assignment_status,
        central_referent_user_id: row.central_referent_user_id,
      },
      members: Array.isArray(row.members) ? row.members : [],
      last_mutation: row.last_audit_action ? {
        action: row.last_audit_action,
        actor_user_id: row.last_audit_actor_user_id,
        at: row.last_audit_at,
        correlation_id: row.last_audit_correlation_id,
      } : null,
    })),
  };
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
  actorMembershipId = null,
  email = null,
  phone = null,
  channel = 'EMAIL',
  grantsOperatingLead = false,
  actorIsCentral = false,
  capabilities,
  capabilityLimits = {},
  correlationId = null,
  ttlHours = INVITATION_TTL_HOURS,
}) {
  const db = requireExecutor(executor);
  const normalizedChannel = normalizeInvitationChannel(channel);
  if (!normalizedChannel) throw delegationError('TEAM_INVITE_CHANNEL_INVALID', 'Canal d’invitation invalide.', 400);
  const emailNormalized = email == null ? null : normalizeEmail(email);
  const phoneE164 = phone == null ? null : normalizePhone(phone);
  if (normalizedChannel === 'EMAIL' && !emailNormalized) {
    throw delegationError('TEAM_INVITE_EMAIL_INVALID', 'Email d’invitation invalide.', 400);
  }
  if (normalizedChannel === 'WHATSAPP' && !phoneE164) {
    throw delegationError('TEAM_INVITE_PHONE_INVALID', 'Téléphone WhatsApp invalide ; E.164 requis.', 400);
  }
  if (grantsOperatingLead && !actorIsCentral) {
    throw delegationError('TEAM_INVITE_LEAD_CENTRAL_ONLY', 'Seul le central peut désigner le responsable opérationnel.', 403);
  }
  if (!actorIsCentral && !actorMembershipId) {
    throw delegationError('TEAM_INVITER_MEMBERSHIP_REQUIRED', 'Membership invitante requise.', 403);
  }
  const requested = normalizeCapabilities(capabilities);

  await assertGrantAllowed(db, {
    assignmentId,
    capabilities: requested,
    actorUserId,
    actorIsCentral,
  });

  const { rows: users } = await db.query(
    normalizedChannel === 'EMAIL'
      ? `SELECT id, full_name, email, phone, role FROM users WHERE lower(email)= $1 LIMIT 1`
      : `SELECT id, full_name, email, phone, role FROM users WHERE phone = $1 LIMIT 1`,
    [normalizedChannel === 'EMAIL' ? emailNormalized : phoneE164]
  );
  if (users[0]) {
    const membership = await addMembership(db, {
      assignmentId,
      userId: users[0].id,
      actorUserId,
      capabilities: requested,
      capabilityLimits,
      actorIsCentral,
      correlationId,
    });
    if (grantsOperatingLead) {
      await db.query(
        `UPDATE assignment_memberships
            SET is_operating_lead=TRUE
          WHERE id=$1::uuid AND assignment_id=$2::uuid AND status='ACTIVE'`,
        [membership.id, assignmentId]
      );
      await audit(db, {
        actorUserId,
        assignmentId,
        membershipId: membership.id,
        action: 'OPERATING_LEAD_ASSIGNED',
        after: { source: 'DIRECT_EXISTING_USER_INVITATION' },
        correlationId,
      });
    }
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
            revoked_by_membership_id=$4::uuid,
            updated_at=NOW()
      WHERE assignment_id=$1::uuid
        AND status='PENDING'
        AND channel=$2
        AND (
          ($2='EMAIL' AND email_normalized=$3)
          OR ($2='WHATSAPP' AND phone_e164=$3)
        )`,
    [assignmentId, normalizedChannel, normalizedChannel === 'EMAIL' ? emailNormalized : phoneE164, actorMembershipId]
  );

  const rawToken = crypto.randomBytes(32).toString('base64url');
  const tokenHash = invitationTokenHash(rawToken);
  const { rows } = await db.query(
    `INSERT INTO market_team_invitations
      (assignment_id, email_normalized, phone_e164, channel, token_hash, requested_capabilities,
       invited_by_membership_id, invited_by_user_id, grants_operating_lead, expires_at)
     VALUES ($1::uuid,$2,$3,$4,$5,$6::jsonb,$7::uuid,$8::uuid,$9,
             NOW() + ($10::text || ' hours')::interval)
     RETURNING id, assignment_id, email_normalized AS email, phone_e164, channel,
               requested_capabilities, invited_by_membership_id, invited_by_user_id,
               grants_operating_lead, status, expires_at, created_at`,
    [assignmentId, emailNormalized, phoneE164, normalizedChannel, tokenHash,
      JSON.stringify(requested), actorMembershipId, actorUserId, grantsOperatingLead, String(Number(ttlHours))]
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
      phone_e164: phoneE164,
      channel: normalizedChannel,
      requested_capabilities: requested,
      grants_operating_lead: grantsOperatingLead,
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
            inviter.status AS inviter_membership_status
       FROM market_team_invitations i
       JOIN market_operating_assignments a ON a.id = i.assignment_id
       LEFT JOIN assignment_memberships inviter ON inviter.id = i.invited_by_membership_id
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
  if (invitation.invited_by_membership_id && invitation.inviter_membership_status !== 'ACTIVE') {
    throw delegationError('TEAM_INVITER_NOT_ACTIVE', 'Le membre invitant n’est plus actif.', 409);
  }

  const { rows: users } = await db.query(
    `SELECT id, full_name, email, phone, role
       FROM users
      WHERE id=$1::uuid
      LIMIT 1`,
    [userId]
  );
  const user = users[0];
  if (!user) throw delegationError('USER_NOT_FOUND', 'Utilisateur introuvable.', 404);
  if (invitation.channel === 'EMAIL' && normalizeEmail(user.email) !== invitation.email_normalized) {
    throw delegationError('TEAM_INVITATION_EMAIL_MISMATCH', 'Cette invitation appartient à un autre email.', 403);
  }
  if (invitation.channel === 'WHATSAPP' && normalizePhone(user.phone) !== invitation.phone_e164) {
    throw delegationError('TEAM_INVITATION_PHONE_MISMATCH', 'Cette invitation appartient à un autre téléphone.', 403);
  }

  const requested = normalizeCapabilities(invitation.requested_capabilities);
  const membership = await addMembership(db, {
    assignmentId: invitation.assignment_id,
    userId: user.id,
    actorUserId: invitation.invited_by_user_id,
    capabilities: requested,
    actorIsCentral: !invitation.invited_by_membership_id,
    correlationId,
  });

  if (invitation.grants_operating_lead) {
    await db.query(
      `UPDATE assignment_memberships
          SET is_operating_lead=TRUE
        WHERE id=$1::uuid AND assignment_id=$2::uuid AND status='ACTIVE'`,
      [membership.id, invitation.assignment_id]
    );
    await audit(db, {
      actorUserId: invitation.invited_by_user_id,
      assignmentId: invitation.assignment_id,
      membershipId: membership.id,
      action: 'OPERATING_LEAD_ASSIGNED',
      after: { source: 'INVITATION_ACCEPTED' },
      correlationId,
    });
  }

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
  normalizeInvitationChannel,
  normalizePhone,
  invitationTokenHash,
  resolveActiveAssignmentByMarketCode,
  resolveAuthorization,
  listTeam,
  listCentralTeamMatrix,
  grantableCapabilitiesForActor,
  inviteTeamMember,
  acceptInvitation,
  replaceTeamMemberCapabilities,
  revokeTeamMember,
  revokeInvitation,
};
