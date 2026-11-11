/**
 * @komerce-arch
 * @role          market-delegation-network-service
 * @domain        market-delegation
 * @layer         service
 * @criticality   high
 * @inputs        authenticated market operator, market code, relais payload
 * @outputs       relais read model, auditable network mutations
 * @depends       services/market-delegation-service.js, services/relais-mutation-service.js, services/user-mutation-service.js
 * @used-by       routes/market-delegation-network.js
 * @db-read       none
 * @db-write      none
 * @db-write-via:relais-mutation-service relais
 * @db-write-via:user-mutation-service users
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
const userMutation = require('./user-mutation-service');

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
    marketId: authz.market_id, marketCode: authz.market_code, name, agentName, phone, address, zone, hours, island, islandCode, latitude, longitude, photoUrl,
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

  const { before, after } = await relaisMutation.updateRelais(db, { marketId: authz.market_id, marketCode: authz.market_code, relaisId, patch });

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

// Capacités de membership relais existantes (pas de nouvelle capacité) : un agent appartient au marché
// s'il a une membership ACTIVE sur l'assignment du marché avec réception ou remise de colis.
const RELAY_MEMBER_CAPABILITIES = ['execution.parcel.receive', 'execution.parcel.collect'];

// admin : autorité centrale (pas de membership requise) ; sinon responsable pays via capability network.* sur son marché.
async function authorizeNetwork(db, { marketCode, actorUserId, actorRole, capability }) {
  if (actorRole === 'admin') {
    const a = await resolveActiveAssignmentByMarketCode(db, marketCode);
    return { ...a, membership_id: null, capabilities: [capability] };
  }
  return resolveAuthorization(db, { userId: actorUserId, marketCode, requiredCapability: capability });
}

async function listRelaisAgents(executor, { marketCode, actorUserId, actorRole }) {
  const db = requireExecutor(executor);
  const authz = await authorizeNetwork(db, { marketCode, actorUserId, actorRole, capability: 'network.read' });
  const { rows } = await db.query(
    `SELECT DISTINCT u.id, u.full_name, u.email, u.relais_id
       FROM users u
       JOIN assignment_memberships am ON am.user_id = u.id AND am.assignment_id = $1::uuid AND am.status = 'ACTIVE'
       JOIN membership_capabilities mc ON mc.membership_id = am.id AND mc.revoked_at IS NULL AND mc.capability = ANY($2::text[])
      WHERE u.role = 'agent_relais'
      ORDER BY u.full_name`,
    [authz.assignment_id, RELAY_MEMBER_CAPABILITIES]
  );
  return rows;
}

async function assignAgentToRelais(executor, { marketCode, relaisId, userId, actorUserId, actorRole, correlationId = null }) {
  const db = requireExecutor(executor);
  const authz = await authorizeNetwork(db, { marketCode, actorUserId, actorRole, capability: 'network.update' });
  // 404 si le relais est d'un autre marché (jamais de fuite cross-market).
  const relais = await relaisMutation.getOwnedRelais(db, { marketId: authz.market_id, relaisId });
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(userId || ''))) {
    const error = new Error('user_id invalide.');
    error.code = 'AGENT_ID_INVALID';
    error.status = 400;
    throw error;
  }
  const { rows: [agent] } = await db.query(
    `SELECT u.id, u.relais_id
       FROM users u
       JOIN assignment_memberships am ON am.user_id = u.id AND am.assignment_id = $2::uuid AND am.status = 'ACTIVE'
       JOIN membership_capabilities mc ON mc.membership_id = am.id AND mc.revoked_at IS NULL AND mc.capability = ANY($3::text[])
      WHERE u.id = $1::uuid AND u.role = 'agent_relais'
      LIMIT 1`,
    [userId, authz.assignment_id, RELAY_MEMBER_CAPABILITIES]
  );
  if (!agent) {
    const error = new Error('Cet agent relais n’appartient pas à ce marché.');
    error.code = 'AGENT_MARKET_MISMATCH';
    error.status = 403;
    throw error;
  }
  const res = await userMutation.assignAgentRelais(db, { userId, relaisId: relais.id });
  if (!['assigned', 'already'].includes(res.status)) {
    const error = new Error('Rattachement refusé : relais inactif ou agent invalide.');
    error.code = 'AGENT_ASSIGN_REFUSED';
    error.status = 409;
    throw error;
  }
  if (res.status === 'assigned') {
    await audit(db, {
      actorUserId, marketId: authz.market_id, assignmentId: authz.assignment_id, membershipId: authz.membership_id,
      capability: 'network.update', action: 'NETWORK_RELAIS_AGENT_ASSIGNED',
      before: { user_id: userId, relais_id: agent.relais_id }, after: { user_id: userId, relais_id: relais.id }, correlationId,
    });
  }
  return { status: res.status, user_id: userId, relais_id: relais.id };
}

module.exports = {
  listRelaisAgents,
  assignAgentToRelais,
  resolveActiveAssignmentByMarketCode,
  resolveAuthorization,
  listRelais,
  createRelais,
  updateRelais,
  setRelaisActive,
};
