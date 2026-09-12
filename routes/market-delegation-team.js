/**
 * @komerce-arch
 * @role          market-delegation-team-api
 * @domain        market-delegation
 * @layer         route
 * @criticality   high
 * @inputs        authenticated user, canonical market code, team payloads
 * @outputs       team read model and auditable team mutations
 * @depends       middleware/auth.js, services/market-delegation-team-service.js, services/market-scope-projector.js
 * @used-by       bootstrap/api-routes.js, market operator dashboard
 * @db-read       none
 * @db-write      none
 * @db-write-via:market-delegation-team-service market_team_invitations, assignment_memberships, membership_capabilities, market_delegation_audit
 * @db-write-via:market-scope-projector operator_market_scopes
 * @db-txn        explicit
 * @doctrine      capabilities_authorize_team_actions, client_market_id_never_authority, legacy_scope_is_projection
 * @impact-areas  market, delegation, team, dashboard
 * @version       2026-09
 */
'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { projectAssignment } = require('../services/market-scope-projector');
const {
  resolveAuthorization,
  listTeam,
  grantableCapabilitiesForActor,
  inviteTeamMember,
  acceptInvitation,
  replaceTeamMemberCapabilities,
  revokeTeamMember,
  revokeInvitation,
} = require('../services/market-delegation-team-service');

function correlationId(req) {
  const raw = req.headers['x-correlation-id'];
  return raw ? String(raw).slice(0, 200) : null;
}

async function withTransaction(work) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) { /* preserve original */ }
    throw error;
  } finally {
    if (client && typeof client.release === 'function') client.release();
  }
}

function sendDelegationError(res, error) {
  if (!error || !error.code || !error.status) return false;
  res.status(error.status).json({ error: error.message, code: error.code });
  return true;
}

function rejectMarketId(body) {
  if (body && (body.market_id != null || body.marketId != null)) {
    const error = new Error('market_id client interdit ; utilisez le code marché de la route.');
    error.code = 'MARKET_ID_FORBIDDEN';
    error.status = 400;
    throw error;
  }
}

async function authorization(client, req, capability) {
  return resolveAuthorization(client, {
    userId: req.user.id,
    marketCode: req.params.marketCode,
    requiredCapability: capability,
  });
}

router.get('/markets/:marketCode/team', authenticate, async (req, res, next) => {
  try {
    const result = await withTransaction(async (client) => {
      const authz = await authorization(client, req, 'team.read');
      const team = await listTeam(client, { assignmentId: authz.assignment_id });
      const grantable = await grantableCapabilitiesForActor(client, {
        assignmentId: authz.assignment_id,
        actorUserId: req.user.id,
        actorIsCentral: false,
      });
      return { authz, team, grantable };
    });
    res.json({
      market: {
        code: result.authz.market_code,
        name: result.authz.market_name,
        currency: result.authz.currency,
      },
      assignment_id: result.authz.assignment_id,
      actor_membership_id: result.authz.membership_id,
      actor_capabilities: result.authz.capabilities,
      actor_grantable_capabilities: result.grantable,
      ...result.team,
    });
  } catch (error) {
    if (sendDelegationError(res, error)) return;
    next(error);
  }
});

router.post('/markets/:marketCode/team/invitations', authenticate, async (req, res, next) => {
  try {
    rejectMarketId(req.body);
    const { email, capabilities = [] } = req.body || {};
    const result = await withTransaction(async (client) => {
      const authz = await authorization(client, req, 'team.invite');
      const invited = await inviteTeamMember(client, {
        assignmentId: authz.assignment_id,
        actorUserId: req.user.id,
        actorMembershipId: authz.membership_id,
        email,
        capabilities,
        correlationId: correlationId(req),
      });
      if (invited.kind === 'membership') {
        await projectAssignment(client, authz.assignment_id);
      }
      return invited;
    });

    if (result.kind === 'membership') {
      return res.status(201).json({
        success: true,
        kind: 'membership',
        membership: result.membership,
        user: result.user,
        capabilities: result.capabilities,
      });
    }

    return res.status(201).json({
      success: true,
      kind: 'invitation',
      invitation: result.invitation,
      invitation_token: result.token,
      acceptance_path: `/api/market-delegation/team/invitations/${encodeURIComponent(result.token)}/accept`,
    });
  } catch (error) {
    if (sendDelegationError(res, error)) return;
    next(error);
  }
});

router.post('/team/invitations/:token/accept', authenticate, async (req, res, next) => {
  try {
    rejectMarketId(req.body);
    const result = await withTransaction(async (client) => {
      const accepted = await acceptInvitation(client, {
        token: req.params.token,
        userId: req.user.id,
        correlationId: correlationId(req),
      });
      await projectAssignment(client, accepted.membership.assignment_id);
      return accepted;
    });
    res.json({ success: true, ...result });
  } catch (error) {
    if (sendDelegationError(res, error)) return;
    next(error);
  }
});

router.put('/markets/:marketCode/team/:membershipId/capabilities', authenticate, async (req, res, next) => {
  try {
    rejectMarketId(req.body);
    const capabilities = Array.isArray(req.body?.capabilities) ? req.body.capabilities : null;
    if (!capabilities) {
      return res.status(400).json({ error: 'capabilities doit être un tableau.', code: 'TEAM_CAPABILITIES_REQUIRED' });
    }

    const result = await withTransaction(async (client) => {
      const authz = await authorization(client, req, 'team.grant');
      if (!authz.capabilities.includes('team.revoke')) {
        const error = new Error('La modification complète des capabilities exige team.grant et team.revoke.');
        error.code = 'MARKET_CAPABILITY_REQUIRED';
        error.status = 403;
        throw error;
      }
      const updated = await replaceTeamMemberCapabilities(client, {
        assignmentId: authz.assignment_id,
        membershipId: req.params.membershipId,
        actorUserId: req.user.id,
        capabilities,
        correlationId: correlationId(req),
      });
      await projectAssignment(client, authz.assignment_id);
      return updated;
    });
    res.json({ success: true, ...result });
  } catch (error) {
    if (sendDelegationError(res, error)) return;
    next(error);
  }
});

router.delete('/markets/:marketCode/team/:membershipId', authenticate, async (req, res, next) => {
  try {
    const revoked = await withTransaction(async (client) => {
      const authz = await authorization(client, req, 'team.revoke');
      const result = await revokeTeamMember(client, {
        assignmentId: authz.assignment_id,
        membershipId: req.params.membershipId,
        actorUserId: req.user.id,
        correlationId: correlationId(req),
      });
      await projectAssignment(client, authz.assignment_id);
      return result;
    });
    res.json({ success: true, revoked });
  } catch (error) {
    if (sendDelegationError(res, error)) return;
    next(error);
  }
});

router.delete('/markets/:marketCode/team/invitations/:invitationId', authenticate, async (req, res, next) => {
  try {
    const revoked = await withTransaction(async (client) => {
      const authz = await authorization(client, req, 'team.revoke');
      return revokeInvitation(client, {
        assignmentId: authz.assignment_id,
        invitationId: req.params.invitationId,
        actorUserId: req.user.id,
        actorMembershipId: authz.membership_id,
        correlationId: correlationId(req),
      });
    });
    res.json({ success: true, revoked });
  } catch (error) {
    if (sendDelegationError(res, error)) return;
    next(error);
  }
});

module.exports = router;
