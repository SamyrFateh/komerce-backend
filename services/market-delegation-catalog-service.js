/**
 * @komerce-arch
 * @role          market-delegation-catalog-service
 * @domain        market-delegation
 * @layer         service
 * @criticality   high
 * @inputs        authenticated market operator, market code, product exposure decision
 * @outputs       product exposure read model, auditable exposure mutations
 * @depends       services/market-delegation-team-service.js, services/market-delegation-service.js, services/catalog-market-exposure-service.js
 * @used-by       routes/market-delegation-catalog.js
 * @db-read       none
 * @db-write      none
 * @db-write-via:catalog-market-exposure-service product_market_exposure
 * @db-write-via:market-delegation-service market_delegation_audit
 * @db-txn        caller-owned
 * @doctrine      catalog_authority_is_capability_based, client_market_id_never_authority, writer_not_owner_boundary, catalog_stays_unique_exposure_is_projection
 * @impact-areas  market, delegation, catalog
 * @version       2026-09
 */
'use strict';

const { audit } = require('./market-delegation-service');
const { resolveActiveAssignmentByMarketCode, resolveAuthorization } = require('./market-delegation-team-service');
const exposureService = require('./catalog-market-exposure-service');

function requireExecutor(executor) {
  if (!executor || typeof executor.query !== 'function') {
    throw new TypeError('market-delegation-catalog-service: executor.query requis');
  }
  return executor;
}

function delegationError(code, message, status = 403) {
  const error = new Error(message || code);
  error.code = code;
  error.status = status;
  return error;
}

async function listExposure(executor, { marketId }) {
  return exposureService.listExposureForMarket(marketId, requireExecutor(executor));
}

async function setExposure(executor, { marketCode, actorUserId, correlationId = null, productId, exposure }) {
  const db = requireExecutor(executor);
  const authz = await resolveAuthorization(db, { userId: actorUserId, marketCode, requiredCapability: 'catalog.expose' });

  let before;
  try {
    before = await exposureService.getExposure(productId, authz.market_id, db);
  } catch (_) {
    before = null;
  }

  let after;
  try {
    after = await exposureService.setExposure(productId, authz.market_id, exposure, actorUserId, db);
  } catch (error) {
    if (/produit introuvable/.test(error.message)) {
      throw delegationError('CATALOG_PRODUCT_NOT_FOUND', 'Produit introuvable.', 404);
    }
    if (/exposition invalide/.test(error.message)) {
      throw delegationError('CATALOG_EXPOSURE_INVALID', error.message, 400);
    }
    throw error;
  }

  await audit(db, {
    actorUserId, assignmentId: authz.assignment_id, membershipId: authz.membership_id,
    capability: 'catalog.expose',
    action: exposure === 'ENABLED' ? 'CATALOG_PRODUCT_EXPOSED' : 'CATALOG_PRODUCT_HIDDEN',
    before: { commercial_exposure: before }, after, correlationId,
  });

  return after;
}

module.exports = {
  resolveActiveAssignmentByMarketCode,
  resolveAuthorization,
  listExposure,
  setExposure,
};
