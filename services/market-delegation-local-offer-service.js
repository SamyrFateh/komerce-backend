/**
 * @komerce-arch
 * @role          market-delegation-local-offer-service
 * @domain        market-delegation
 * @layer         service
 * @criticality   high
 * @inputs        authenticated market operator, market code, service/physical_offer exposure decision
 * @outputs       service/physical_offer read models, auditable exposure mutations
 * @depends       services/market-delegation-team-service.js, services/market-delegation-service.js, services/providers-service.js
 * @used-by       routes/market-delegation-local-offer.js
 * @db-read       none
 * @db-write      none
 * @db-write-via:providers-service services, physical_offers
 * @db-write-via:market-delegation-service market_delegation_audit
 * @db-txn        caller-owned
 * @doctrine      local_offer_authority_is_capability_based, client_market_id_never_authority, writer_not_owner_boundary
 * @impact-areas  market, delegation, providers-services
 * @version       2026-09
 */
'use strict';

const { audit } = require('./market-delegation-service');
const { resolveActiveAssignmentByMarketCode, resolveAuthorization } = require('./market-delegation-team-service');
const providersService = require('./providers-service');

function requireExecutor(executor) {
  if (!executor || typeof executor.query !== 'function') {
    throw new TypeError('market-delegation-local-offer-service: executor.query requis');
  }
  return executor;
}

function delegationError(code, message, status = 403) {
  const error = new Error(message || code);
  error.code = code;
  error.status = status;
  return error;
}

async function listServices(executor, { marketId }) {
  return providersService.listServicesForMarket(marketId, requireExecutor(executor));
}

async function listPhysicalOffers(executor, { marketId }) {
  return providersService.listPhysicalOffersForMarket(marketId, requireExecutor(executor));
}

async function setServiceExposure(executor, { marketCode, actorUserId, correlationId = null, serviceId, exposure }) {
  const db = requireExecutor(executor);
  const authz = await resolveAuthorization(db, { userId: actorUserId, marketCode, requiredCapability: 'local_offer.manage' });

  let result;
  try {
    result = await providersService.setServiceExposure(serviceId, authz.market_id, exposure, db);
  } catch (error) {
    if (/exposition invalide/.test(error.message)) {
      throw delegationError('LOCAL_OFFER_EXPOSURE_INVALID', error.message, 400);
    }
    throw error;
  }
  if (!result) throw delegationError('LOCAL_OFFER_NOT_FOUND', 'Service introuvable.', 404);
  if (!result.changed) return result.after;

  await audit(db, {
    actorUserId, assignmentId: authz.assignment_id, membershipId: authz.membership_id,
    capability: 'local_offer.manage',
    action: exposure === 'ENABLED' ? 'LOCAL_SERVICE_EXPOSED' : 'LOCAL_SERVICE_HIDDEN',
    before: result.before, after: result.after, correlationId,
  });
  return result.after;
}

async function setPhysicalOfferExposure(executor, { marketCode, actorUserId, correlationId = null, physicalOfferId, exposure }) {
  const db = requireExecutor(executor);
  const authz = await resolveAuthorization(db, { userId: actorUserId, marketCode, requiredCapability: 'local_offer.manage' });

  let result;
  try {
    result = await providersService.setPhysicalOfferExposure(physicalOfferId, authz.market_id, exposure, db);
  } catch (error) {
    if (/exposition invalide/.test(error.message)) {
      throw delegationError('LOCAL_OFFER_EXPOSURE_INVALID', error.message, 400);
    }
    throw error;
  }
  if (!result) throw delegationError('LOCAL_OFFER_NOT_FOUND', 'Offre physique introuvable.', 404);
  if (!result.changed) return result.after;

  await audit(db, {
    actorUserId, assignmentId: authz.assignment_id, membershipId: authz.membership_id,
    capability: 'local_offer.manage',
    action: exposure === 'ENABLED' ? 'LOCAL_PHYSICAL_OFFER_EXPOSED' : 'LOCAL_PHYSICAL_OFFER_HIDDEN',
    before: result.before, after: result.after, correlationId,
  });
  return result.after;
}

module.exports = {
  resolveActiveAssignmentByMarketCode,
  resolveAuthorization,
  listServices,
  listPhysicalOffers,
  setServiceExposure,
  setPhysicalOfferExposure,
};
