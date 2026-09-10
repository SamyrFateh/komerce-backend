/**
 * @komerce-arch
 * @role          market-delegation-network-service
 * @domain        market-delegation
 * @layer         service
 * @criticality   high
 * @inputs        authenticated market operator, market code, relais payload
 * @outputs       relais read model, auditable network mutations
 * @depends       services/market-delegation-service.js, services/relais-mutation-service.js
 * @used-by       routes/market-delegation-network.js
 * @db-read       none
 * @db-write      none
 * @db-write-via:relais-mutation-service relais
 * @db-write-via:market-delegation-service market_delegation_audit
 * @db-txn        caller-owned
 * @doctrine      network_authority_is_capability_based, client_market_id_never_authority, writer_not_owner_boundary
 * @impact-areas  market, delegation, logistics, network
 * @version       2026-09
 */
'use strict';

const {
  resolveActiveAssignmentByMarketCode,
  resolveAuthorization,
  audit,
} = require('./market-delegation-service');

const relaisMutation = require('./relais-mutation-service');

function requireExecutor(executor) {
  if (!executor || typeof executor.query !== 'function') {
    throw new TypeError('market-delegation-network-service: executor.query requis');
  }
  return executor;
}

async function listRelais(executor, { marketId }) {
  return relaisMutation.listRelais(requireExecutor(executor), { marketId });
}

async function createRelais(executor, {
  marketCode, actorUserId, correlationId = null,
  name, agentName, phone, address, zone, hours, island, islandCode, latitude, longitude, photoUrl,
}) {
  const db = requireExecutor(executor);
  const authz = await resolveAuthorization(db, { userId: actorUserId, marketCode, requiredCapability: 'network.create' });

  // La validation des champs et l'écriture SQL appartiennent à logistics,
  // lifecycle owner de la table relais — market-delegation ne fait jamais de
  // SQL direct sur une table qu'il ne possède pas (doctrine writer_not_owner_boundary).
  const relais = await relaisMutation.createRelais(db, {
    marketId: authz.market_id, name, agentName, phone, address, zone, hours, island, islandCode, latitude, longitude, photoUrl,
  });

  await audit(db, {
    actorUserId, assignmentId: authz.assignment_id, membershipId: authz.membership_id,
    capability: 'network.create', action: 'NETWORK_RELAIS_CREATED',
    after: relais, correlationId,
  });

  return relais;
}

async function updateRelais(executor, { marketCode, relaisId, actorUserId, correlationId = null, patch = {} }) {
  const db = requireExecutor(executor);
  const authz = await resolveAuthorization(db, { userId: actorUserId, marketCode, requiredCapability: 'network.update' });

  const { before, after } = await relaisMutation.updateRelais(db, { marketId: authz.market_id, relaisId, patch });

  await audit(db, {
    actorUserId, assignmentId: authz.assignment_id, membershipId: authz.membership_id,
    capability: 'network.update', action: 'NETWORK_RELAIS_UPDATED',
    before, after, correlationId,
  });

  return after;
}

async function setRelaisActive(executor, { marketCode, relaisId, actorUserId, active, correlationId = null }) {
  const db = requireExecutor(executor);
  const capability = active ? 'network.update' : 'network.suspend';
  const authz = await resolveAuthorization(db, { userId: actorUserId, marketCode, requiredCapability: capability });

  const { before, after, changed } = await relaisMutation.setRelaisActive(db, { marketId: authz.market_id, relaisId, active });
  if (!changed) return after; // idempotent, pas de bruit d'audit

  await audit(db, {
    actorUserId, assignmentId: authz.assignment_id, membershipId: authz.membership_id,
    capability, action: active ? 'NETWORK_RELAIS_ACTIVATED' : 'NETWORK_RELAIS_SUSPENDED',
    before, after, correlationId,
  });

  return after;
}

module.exports = {
  resolveActiveAssignmentByMarketCode,
  resolveAuthorization,
  listRelais,
  createRelais,
  updateRelais,
  setRelaisActive,
};
