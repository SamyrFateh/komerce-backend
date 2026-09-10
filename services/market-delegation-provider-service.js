/**
 * @komerce-arch
 * @role          market-delegation-provider-service
 * @domain        market-delegation
 * @layer         service
 * @criticality   high
 * @inputs        authenticated market operator, market code, provider payload
 * @outputs       provider read model, auditable provider mutations
 * @depends       services/market-delegation-service.js, services/providers-service.js
 * @used-by       routes/market-delegation-provider.js
 * @db-read       none
 * @db-write      none
 * @db-write-via:providers-service providers
 * @db-write-via:market-delegation-service market_delegation_audit
 * @db-txn        caller-owned
 * @doctrine      provider_authority_is_capability_based, client_market_id_never_authority, writer_not_owner_boundary
 * @impact-areas  market, delegation, providers-services
 * @version       2026-09
 */
'use strict';

const {
  audit,
} = require('./market-delegation-service');

const {
  resolveActiveAssignmentByMarketCode,
  resolveAuthorization,
} = require('./market-delegation-team-service');

const providersService = require('./providers-service');

function requireExecutor(executor) {
  if (!executor || typeof executor.query !== 'function') {
    throw new TypeError('market-delegation-provider-service: executor.query requis');
  }
  return executor;
}

function delegationError(code, message, status = 403) {
  const error = new Error(message || code);
  error.code = code;
  error.status = status;
  return error;
}

async function listProviders(executor, { marketId }) {
  return providersService.listProviders(marketId, requireExecutor(executor));
}

async function createProvider(executor, { marketCode, actorUserId, correlationId = null, name, phone }) {
  const db = requireExecutor(executor);
  const authz = await resolveAuthorization(db, { userId: actorUserId, marketCode, requiredCapability: 'provider.manage' });

  // Validation et écriture SQL appartiennent à providers-services, lifecycle
  // owner de la table providers — market-delegation ne fait jamais de SQL
  // direct sur une table qu'il ne possède pas (doctrine writer_not_owner_boundary).
  const provider = await providersService.createProvider({ name, phone, marketId: authz.market_id }, db);

  await audit(db, {
    actorUserId, assignmentId: authz.assignment_id, membershipId: authz.membership_id,
    capability: 'provider.manage', action: 'NETWORK_PROVIDER_CREATED',
    after: provider, correlationId,
  });

  return provider;
}

async function updateProvider(executor, { marketCode, providerId, actorUserId, correlationId = null, patch = {} }) {
  const db = requireExecutor(executor);
  const authz = await resolveAuthorization(db, { userId: actorUserId, marketCode, requiredCapability: 'provider.manage' });

  const result = await providersService.updateProvider(providerId, authz.market_id, patch, db);
  if (!result) throw delegationError('NETWORK_PROVIDER_NOT_FOUND', 'Provider introuvable.', 404);

  await audit(db, {
    actorUserId, assignmentId: authz.assignment_id, membershipId: authz.membership_id,
    capability: 'provider.manage', action: 'NETWORK_PROVIDER_UPDATED',
    before: result.before, after: result.after, correlationId,
  });

  return result.after;
}

async function setProviderStatus(executor, { marketCode, providerId, actorUserId, status, correlationId = null }) {
  const db = requireExecutor(executor);
  const authz = await resolveAuthorization(db, { userId: actorUserId, marketCode, requiredCapability: 'provider.manage' });

  const before = await providersService.getOwnedProvider(providerId, authz.market_id, db);
  if (!before) throw delegationError('NETWORK_PROVIDER_NOT_FOUND', 'Provider introuvable.', 404);
  if (before.status === status) return before; // idempotent, pas de bruit d'audit

  const after = await providersService.setProviderStatus(providerId, status, db);

  await audit(db, {
    actorUserId, assignmentId: authz.assignment_id, membershipId: authz.membership_id,
    capability: 'provider.manage',
    action: status === 'suspended' ? 'NETWORK_PROVIDER_SUSPENDED' : 'NETWORK_PROVIDER_ACTIVATED',
    before, after, correlationId,
  });

  return after;
}

module.exports = {
  resolveActiveAssignmentByMarketCode,
  resolveAuthorization,
  listProviders,
  createProvider,
  updateProvider,
  setProviderStatus,
};
