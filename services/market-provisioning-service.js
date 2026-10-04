/**
 * @komerce-arch
 * @role          market-provisioning-orchestrator
 * @domain        market-control-plane
 * @layer         service
 * @criticality   high
 * @inputs        central admin, market identity, central referent, first operating lead
 * @outputs       PROVISIONING market, ACTIVE assignment, first lead invitation/membership, readiness
 * @depends       services/market-lifecycle-service.js, services/market-delegation-service.js, services/market-operator-provisioning.js, services/market-delegation-team-service.js, services/market-scope-projector.js, services/market-cash-control-policy-service.js, services/market-payment-provider-config-service.js, services/relais-mutation-service.js, services/central-authority.js, services/market-control-plane.js
 * @used-by       routes/admin-market-control-plane.js
 * @db-read       central authority grant tables
 * @db-write      none
 * @db-write-via:market-lifecycle-service markets
 * @db-write-via:market-delegation-service market_operating_assignments, assignment_capability_ceiling, market_delegation_audit
 * @db-write-via:market-delegation-team-service market_team_invitations, assignment_memberships, membership_capabilities
 * @db-write-via:market-cash-control-policy-service market_cash_control_policies
 * @db-write-via:market-payment-provider-config-service market_payment_providers
 * @db-write-via:relais-mutation-service relais
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
const { projectAssignment } = require('./market-scope-projector');
const { initializeProvisioningCashPolicy } = require('./market-cash-control-policy-service');
const { configureProvisioningProvider } = require('./market-payment-provider-config-service');
const relaisMutation = require('./relais-mutation-service');
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
  paymentProvider = null,
  cashPolicy = null,
  initialRelais = null,
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
    capabilityLimits: financialLimits,
    correlationId,
  });

  const initialPaymentProvider = paymentProvider
    ? await configureProvisioningProvider(executor, {
        marketId: market.id,
        provider: paymentProvider.provider,
        currency: paymentProvider.currency || market.currency,
        priority: paymentProvider.priority || 10,
      })
    : null;

  const initialCashPolicy = cashPolicy
    ? await initializeProvisioningCashPolicy(executor, {
        assignmentId: assignment.id,
        marketId: market.id,
        actorUserId,
        payload: cashPolicy,
        correlationId,
      })
    : null;

  const initialRelay = initialRelais
    ? await relaisMutation.createRelais(executor, {
        marketId: market.id,
        name: initialRelais.name,
        agentName: initialRelais.agent_name,
        phone: initialRelais.phone,
        address: initialRelais.address,
        zone: initialRelais.zone,
        hours: initialRelais.hours,
        island: initialRelais.island,
        islandCode: initialRelais.island_code,
        latitude: initialRelais.latitude,
        longitude: initialRelais.longitude,
        photoUrl: initialRelais.photo_url,
      })
    : null;

  if (initialRelay) {
    await delegation.audit(executor, {
      actorUserId,
      marketId: market.id,
      assignmentId: assignment.id,
      action: 'NETWORK_RELAIS_PROVISIONED',
      after: initialRelay,
      correlationId,
    });
  }

  const control = await controlPlane.getControlPlane(executor, market.code);
  return {
    market,
    assignment_id: assignment.id,
    central_referent_user_id: centralReferentUserId,
    lead: leadResult,
    initial_payment_provider: initialPaymentProvider,
    initial_cash_policy: initialCashPolicy,
    initial_relais: initialRelay,
    readiness: control.readiness,
    gaps: control.gaps,
  };
}


async function setMarketLifecycle(executor, {
  actorUserId, marketCode, targetStatus, correlationId = null,
}) {
  const target = String(targetStatus || '').trim().toUpperCase();
  let activationControl = null;
  if (target === 'ACTIVE') {
    activationControl = await controlPlane.getControlPlane(executor, marketCode);
    if (!activationControl.readiness.ready_for_activation) {
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
  if (target === 'ACTIVE' && activationControl?.assignment?.id) {
    await projectAssignment(executor, activationControl.assignment.id);
  }
  return result;
}

module.exports = { assertCentralReferent, provisionMarket, setMarketLifecycle };
