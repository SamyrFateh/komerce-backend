/**
 * @komerce-arch
 * @role          market-provisioning-orchestrator
 * @domain        market-control-plane
 * @layer         service
 * @criticality   high
 * @inputs        central admin, market identity, central referent, first operating lead
 * @outputs       PROVISIONING market, ACTIVE assignment, first lead invitation/membership, readiness
 * @depends       services/user-mutation-service.js, utils/phone.js, bcryptjs, crypto, services/market-lifecycle-service.js, services/market-delegation-service.js, services/market-operator-provisioning.js, services/market-delegation-team-service.js, services/market-scope-projector.js, services/market-cash-control-policy-service.js, services/market-payment-provider-config-service.js, services/relais-mutation-service.js, services/central-authority.js, services/market-control-plane.js, services/economic-cost-reference-service.js
 * @used-by       routes/admin-market-control-plane.js
 * @db-read       users, assignment_memberships, catalog_global_access_grants, dashboard_global_access_grants, decision_signal_global_access_grants, pricing_global_access_grants, sourcing_global_access_grants, markets, market_operating_assignments
 * @db-write      none
 * @db-write-via:user-mutation-service users
 * @db-write-via:market-lifecycle-service markets
 * @db-write-via:market-delegation-service market_operating_assignments, assignment_capability_ceiling, market_delegation_audit
 * @db-write-via:market-delegation-team-service market_team_invitations, assignment_memberships, membership_capabilities
 * @db-write-via:market-cash-control-policy-service market_cash_control_policies
 * @db-write-via:market-payment-provider-config-service market_payment_providers, market_central_collection_modes
 * @db-write-via:relais-mutation-service relais
 * @db-write-via:economic-cost-reference-service economic_cost_centers, economic_cost_families
 * @db-txn        caller-owned
 * @doctrine      compose_existing_primitives, provisioning_is_not_activation, readiness_precedes_activation
 * @impact-areas  market, market-delegation, market-control-plane, authorization
 * @version       2026-10-v1
 */
'use strict';

const { createProvisioningMarket, loadProvisioningMarket, transitionMarketLifecycle, validateProvisioningCurrency, validateBusinessTimezone } = require('./market-lifecycle-service');
const delegation = require('./market-delegation-service');
const { targetCapabilitiesForScope } = require('./market-operator-provisioning');
const { inviteTeamMember } = require('./market-delegation-team-service');
const { projectAssignment } = require('./market-scope-projector');
const { initializeProvisioningCashPolicy } = require('./market-cash-control-policy-service');
const { configureProvisioningProvider, configureCentralCollectionModes, assertMobileMarketEligibility } = require('./market-payment-provider-config-service');
const relaisMutation = require('./relais-mutation-service');
const centralAuthority = require('./central-authority');
const controlPlane = require('./market-control-plane');
const {provisionCostReferences}=require('./economic-cost-reference-service');
const { createAdminUser } = require('./user-mutation-service');
const { normalizePhone } = require('../utils/phone');
const { randomBytes } = require('crypto');
const bcrypt = require('bcryptjs');

function provisionError(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

// New named-lead contract. Historical invitation callers remain compatible until
// their UI has migrated; email is never accepted as authority for the named path.
function normalizeProfessionalLead(lead) {
  function namePart(raw) {
    if (typeof raw !== 'string' || !raw.trim() || raw.trim().length > 100) {
      throw provisionError('LEAD_NAME_REQUIRED', 'Nom et prénom du responsable requis.');
    }
    const display = raw.trim().replace(/\s+/g, ' ');
    const local = display.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae')
      .replace(/[\s'’\-]+/g, '-');
    if (!/^[a-z]+(?:-[a-z]+)*$/.test(local)) {
      throw provisionError('LEAD_NAME_INVALID', 'Nom ou prénom incompatible avec la convention email Komerce.');
    }
    return { display, local };
  }
  const last = namePart(lead?.last_name);
  const first = namePart(lead?.first_name);
  const local = last.local + '.' + first.local;
  if (local.length > 64) throw provisionError('LEAD_EMAIL_TOO_LONG', 'Identifiant professionnel trop long.');
  const rawPhone = lead?.phone;
  const phone = typeof rawPhone === 'string' && /^(?:\+|00)[0-9\s().-]+$/.test(rawPhone.trim())
    ? normalizePhone(rawPhone) : null;
  if (!phone) throw provisionError('LEAD_PHONE_INVALID', 'Téléphone international requis (E.164).');
  const email = local + '@komerce.co';
  if (lead.email != null && String(lead.email).trim().toLowerCase() !== email) {
    throw provisionError('LEAD_EMAIL_MISMATCH', 'L’email doit être généré à partir du nom et du prénom.');
  }
  return { fullName: last.display + ' ' + first.display, email, phone };
}

async function ensureProfessionalLead(executor, { identity, assignmentId, currency }) {
  // Consider both identifiers and the legacy WhatsApp alias used by OTP lookup.
  // Never pick the first match, change an existing person's identity or role, or
  // silently extend a manager's perimeter to another market.
  const { rows } = await executor.query(
    `SELECT u.id, u.full_name, u.email, u.phone, u.role,
            u.account_activation_required,
            EXISTS (SELECT 1 FROM assignment_memberships am
              WHERE am.user_id=u.id AND am.status='ACTIVE' AND am.assignment_id<>$3::uuid) AS other_market
       FROM users u
      WHERE lower(u.email)=$1 OR u.phone=$2 OR u.whatsapp_phone=$2
      FOR UPDATE OF u`, [identity.email, identity.phone, assignmentId]);
  if (rows.length) {
    const u = rows[0];
    if (rows.length !== 1 || String(u.email || '').toLowerCase() !== identity.email ||
        u.phone !== identity.phone || u.role !== 'market_operator' || u.other_market ||
        u.account_activation_required) {
      throw provisionError('LEAD_IDENTITY_CONFLICT',
        'Email ou téléphone déjà utilisé, identité ou habilitation incompatible. Vérifier le compte avant de poursuivre.', 409);
    }
    return u;
  }
  try {
    // No mailbox or shared password is required. The unknown random password
    // cannot be used to sign in; the existing verified phone OTP flow remains.
    const passwordHash = await bcrypt.hash(randomBytes(32).toString('hex'), 12);
    const result = await createAdminUser(executor, {
      fullName: identity.fullName, email: identity.email, phone: identity.phone,
      role: 'market_operator', currencyPref: currency, passwordHash,
    });
    if (!result.rows[0]) throw provisionError('LEAD_ACCOUNT_NOT_CREATED', 'Création du responsable impossible.', 409);
    return result.rows[0];
  } catch (error) {
    if (error.code === '23505') {
      throw provisionError('LEAD_IDENTITY_CONFLICT', 'Email ou téléphone déjà utilisé. Vérifier le compte avant de poursuivre.', 409);
    }
    throw error;
  }
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

async function configureProvisioningMarket(executor, {
  market,
  actorUserId,
  centralReferentUserId,
  financialLimits = {},
  lead = {},
  paymentProvider = null,
  centralCollectionModes = null,
  cashPolicy = null,
  initialRelais = null,
  correlationId = null,
}) {
  if (!executor || typeof executor.query !== 'function') throw new TypeError('market-provisioning-service: executor.query requis');
  const referentDomains = await assertCentralReferent(executor, centralReferentUserId);

  await delegation.audit(executor, {
    actorUserId,
    marketId: market.id,
    action: 'MARKET_PROVISIONING_STARTED',
    after: { code: market.code, currency: market.currency, lifecycle_status: market.lifecycle_status, business_timezone: market.business_timezone ?? null },
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

  const namedLead = Object.prototype.hasOwnProperty.call(lead, 'last_name') ||
    Object.prototype.hasOwnProperty.call(lead, 'first_name');
  const identity = namedLead ? normalizeProfessionalLead(lead) : null;
  if (identity) {
    await ensureProfessionalLead(executor, { identity, assignmentId: assignment.id, currency: market.currency });
  }
  const leadResult = await inviteTeamMember(executor, {
    assignmentId: assignment.id,
    actorUserId,
    actorMembershipId: null,
    actorIsCentral: true,
    email: identity ? identity.email : lead.email || null,
    phone: identity ? identity.phone : lead.phone || null,
    channel: identity ? 'WHATSAPP' : lead.channel || (lead.phone ? 'WHATSAPP' : 'EMAIL'),
    strictIdentity: Boolean(identity),
    grantsOperatingLead: true,
    capabilities,
    capabilityLimits: financialLimits,
    correlationId,
  });

  if (identity && paymentProvider) assertMobileMarketEligibility(market.code, paymentProvider.provider);
  const initialCentralModes = centralCollectionModes == null ? [] :
    await configureCentralCollectionModes(executor, {
      marketId: market.id, actorUserId, modes: centralCollectionModes,
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

  const economicReferences=await provisionCostReferences(executor,{marketId:market.id,actorId:actorUserId});
  const control = await controlPlane.getControlPlane(executor, market.code);
  return {
    market,
    assignment_id: assignment.id,
    central_referent_user_id: centralReferentUserId,
    lead: leadResult,
    initial_payment_provider: initialPaymentProvider,
    initial_central_collection_modes: initialCentralModes,
    initial_cash_policy: initialCashPolicy,
    initial_relais: initialRelay,
    economic_references: economicReferences,
    readiness: control.readiness,
    gaps: control.gaps,
  };
}

async function provisionMarket(executor, {
  actorUserId,
  code,
  name,
  currency,
  minorUnit,
  businessTimezone = null,
  storefrontTexts = {},
  centralReferentUserId,
  financialLimits = {},
  lead = {},
  paymentProvider = null,
  centralCollectionModes = null,
  cashPolicy = null,
  initialRelais = null,
  correlationId = null,
}) {
  const named = lead.last_name != null || lead.first_name != null;
  const canonicalUnit = named ? validateProvisioningCurrency(currency,minorUnit) : minorUnit;
  const timezone = validateBusinessTimezone(businessTimezone,{required:named});
  const market = await createProvisioningMarket(executor, {
    code, name, currency, minorUnit:canonicalUnit, businessTimezone:timezone, storefrontTexts, actorUserId, correlationId,
  });
  return configureProvisioningMarket(executor, {
    market, actorUserId, centralReferentUserId, financialLimits, lead,
    paymentProvider, centralCollectionModes, cashPolicy, initialRelais, correlationId,
  });
}

async function reprovisionMarket(executor, {
  actorUserId,
  marketCode,
  centralReferentUserId,
  financialLimits = {},
  lead = {},
  paymentProvider = null,
  centralCollectionModes = null,
  cashPolicy = null,
  initialRelais = null,
  correlationId = null,
}) {
  const market = await loadProvisioningMarket(executor, { marketCode });
  return configureProvisioningMarket(executor, {
    market, actorUserId, centralReferentUserId, financialLimits, lead,
    paymentProvider, centralCollectionModes, cashPolicy, initialRelais, correlationId,
  });
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

const ASSIGNMENT_TRANSITIONS = Object.freeze({
  ACTIVE: ['SUSPENDED', 'ENDED'],
  SUSPENDED: ['ACTIVE', 'ENDED'],
});

/**
 * Cycle de vie du mandat (suspendre / reprendre / terminer), distinct du cycle de vie du marché.
 * Le mandat non ACTIVE coupe l'accès délégué (projection des scopes révoquée, gardes fail-closed).
 * ENDED est terminal et refusé tant qu'un règlement reste non reçu.
 */
async function setAssignmentLifecycle(executor, {
  actorUserId, marketCode, targetStatus, reason = null, correlationId = null,
}) {
  const target = String(targetStatus || '').trim().toUpperCase();
  if (!['ACTIVE', 'SUSPENDED', 'ENDED'].includes(target)) {
    throw provisionError('ASSIGNMENT_STATUS_INVALID', 'Statut de mandat invalide (ACTIVE, SUSPENDED ou ENDED).', 400);
  }
  const code = delegation.normalizeMarketCode(marketCode);
  if (!code) throw provisionError('MARKET_CODE_INVALID', 'Code marché invalide.', 400);

  const { rows } = await executor.query(
    `SELECT a.id, a.status
       FROM market_operating_assignments a
       JOIN markets m ON m.id = a.market_id
      WHERE m.code = $1 AND a.status IN ('ACTIVE','SUSPENDED')
      ORDER BY (a.status = 'ACTIVE') DESC, a.created_at DESC
      LIMIT 1
      FOR UPDATE OF a`, [code]
  );
  const assignment = rows[0];
  if (!assignment) throw provisionError('ASSIGNMENT_NOT_FOUND', 'Aucun mandat actif ou suspendu pour ce marché.', 404);
  if (assignment.status === target) return { changed: false, assignment_id: assignment.id, status: target };

  if (!(ASSIGNMENT_TRANSITIONS[assignment.status] || []).includes(target)) {
    throw provisionError('ASSIGNMENT_TRANSITION_FORBIDDEN', `Transition ${assignment.status} → ${target} interdite.`, 409);
  }
  if (target === 'ENDED') {
    const exit = await controlPlane.getExitReadiness(executor, code);
    if (!exit.ready_to_end) {
      throw provisionError('ASSIGNMENT_EXIT_BLOCKED', 'Fin de mandat refusée : règlements non reçus (' + exit.blockers.join(', ') + ').', 409);
    }
  }

  const cleanReason = reason == null ? null : String(reason).trim().slice(0, 500) || null;
  await delegation.setAssignmentStatus(executor, {
    assignmentId: assignment.id, status: target, reason: cleanReason, actorUserId, correlationId,
  });
  await projectAssignment(executor, assignment.id);
  return { changed: true, assignment_id: assignment.id, status: target, previous_status: assignment.status };
}

module.exports = { normalizeProfessionalLead, ensureProfessionalLead, assertCentralReferent, configureProvisioningMarket, provisionMarket, reprovisionMarket, setMarketLifecycle, setAssignmentLifecycle };
