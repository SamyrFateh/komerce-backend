/**
 * @komerce-arch
 * @role          market-provisioning-orchestrator
 * @domain        market-control-plane
 * @layer         service
 * @criticality   high
 * @inputs        central admin, market identity, central referent, first operating lead
 * @outputs       PROVISIONING market, ACTIVE assignment, first lead invitation/membership, readiness
 * @depends       services/market-lifecycle-service.js, services/market-delegation-service.js, services/market-operator-provisioning.js, services/market-delegation-team-service.js, services/central-authority.js, services/market-control-plane.js
 * @used-by       routes/admin-market-control-plane.js
 * @db-read       central authority grant tables
 * @db-write      none
 * @db-write-via:market-lifecycle-service markets
 * @db-write-via:market-delegation-service market_operating_assignments, assignment_capability_ceiling, market_delegation_audit
 * @db-write-via:market-delegation-team-service market_team_invitations, assignment_memberships, membership_capabilities
 * @db-txn        caller-owned
 * @doctrine      compose_existing_primitives, provisioning_is_not_activation, readiness_precedes_activation
 * @impact-areas  market, market-delegation, market-control-plane, authorization
 * @version       2026-10-v1
 */
'use strict';

const { createProvisioningMarket, transitionMarketLifecycle } = require('./market-lifecycle-service');
const delegation = require('./market-delegation-service');
const { targetCapabilitiesForScope } = require('./market-operator-provisioning');
const { inviteTeamMember } = require('./market-delegation-team-service');
const centralAuthority = require('./central-authority');
const controlPlane = require('./market-control-plane');

function provisionError(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

async function assertCentralReferent(executor, userId) {
  if (!userId) throw provisionError('CENTRAL_REFERENT_REQUIRED', 'Référent central requis.');
  const view = await centralAuthority.overview(executor);
  const domains = view.domains
    .filter(domain => domain.holders.some(holder => String(holder.user_id) === String(userId)))
    .map(domain => domain.domain);
  if (!domains.length) {
    throw provisionError(
      'CENTRAL_REFERENT_AUTHORITY_REQUIRED',
      'Le référent central doit détenir au moins une autorisation centrale explicite active.',
      409
    );
  }
  return domains;
}

async function provisionMarket(executor, {
  actorUserId,
  code,
  name,
  currency,
  minorUnit = 0,
  storefrontTexts = {},
  centralReferentUserId,
  financialLimits = {},
  lead = {},
  correlationId = null,
}) {
  if (!executor || typeof executor.query !== 'function') throw new TypeError('market-provisioning-service: executor.query requis');
  const referentDomains = await assertCentralReferent(executor, centralReferentUserId);

  const market = await createProvisioningMarket(executor, {
    code, name, currency, minorUnit, storefrontTexts, actorUserId, correlationId,
  });
  await delegation.audit(executor, {
    actorUserId,
    marketId: market.id,
    action: 'MARKET_PROVISIONING_STARTED',
    after: { code: market.code, currency: market.currency, lifecycle_status: market.lifecycle_status },
    correlationId,
  });

  const assignment = await delegation.createAssignment(executor, {
    marketId: market.id,
    actorUserId,
    status: 'ACTIVE',
    correlationId,
  });

  await delegation.setCentralReferent(executor, {
    assignmentId: assignment.id,
    userId: centralReferentUserId,
    actorUserId,
    marketId: market.id,
    authorityDomains: referentDomains,
    correlationId,
  });
  await delegation.setCeilingAmountLimits(executor, {
    assignmentId: assignment.id,
    limits: financialLimits,
    actorUserId,
    marketId: market.id,
    correlationId,
  });

  const capabilities = await targetCapabilitiesForScope(executor, {
    assignmentId: assignment.id,
    scope: 'manager',
  });

  const leadResult = await inviteTeamMember(executor, {
    assignmentId: assignment.id,
    actorUserId,
    actorMembershipId: null,
    actorIsCentral: true,
    email: lead.email || null,
    phone: lead.phone || null,
    channel: lead.channel || (lead.phone ? 'WHATSAPP' : 'EMAIL'),
    grantsOperatingLead: true,
    capabilities,
    correlationId,
  });

  const control = await controlPlane.getControlPlane(executor, market.code);
  return {
    market,
    assignment_id: assignment.id,
    central_referent_user_id: centralReferentUserId,
    lead: leadResult,
    readiness: control.readiness,
    gaps: control.gaps,
  };
}


async function setMarketLifecycle(executor, {
  actorUserId, marketCode, targetStatus, correlationId = null,
}) {
  const target = String(targetStatus || '').trim().toUpperCase();
  if (target === 'ACTIVE') {
    const control = await controlPlane.getControlPlane(executor, marketCode);
    if (!control.readiness.ready_for_activation) {
      throw provisionError(
        'MARKET_NOT_READY_FOR_ACTIVATION',
        'Activation refusée : readiness plate-forme et exploitation doivent être vertes.',
        409
      );
    }
  }

  const result = await transitionMarketLifecycle(executor, { marketCode, targetStatus: target });
  if (result.changed) {
    await delegation.audit(executor, {
      actorUserId,
      marketId: result.after.id,
      action: 'MARKET_LIFECYCLE_CHANGED',
      before: { lifecycle_status: result.before.lifecycle_status, is_active: result.before.is_active },
      after: { lifecycle_status: result.after.lifecycle_status, is_active: result.after.is_active },
      correlationId,
    });
  }
  return result;
}

module.exports = { assertCentralReferent, provisionMarket, setMarketLifecycle };
