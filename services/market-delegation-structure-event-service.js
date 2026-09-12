/**
 * @komerce-arch
 * @role          market-delegation-structure-event-service
 * @domain        market-delegation
 * @layer         service
 * @criticality   critical
 * @inputs        authenticated market operator, market code, structure cost event payload
 * @outputs       economic_structure_cost_events read model, auditable MARKET_DIRECT event recording
 * @depends       services/market-delegation-team-service.js, services/market-delegation-service.js, services/pricing-period-structure.js
 * @used-by       routes/market-delegation-structure-event.js
 * @db-read       none
 * @db-write      none
 * @db-write-via:pricing-period-structure economic_structure_cost_events
 * @db-write-via:market-delegation-service market_delegation_audit
 * @db-txn        caller-owned
 * @doctrine      structure_authority_is_capability_based, client_market_id_never_authority, group_scope_never_delegated, writer_not_owner_boundary
 * @impact-areas  market, delegation, economic-engine
 * @version       2026-09
 */
'use strict';

const { audit } = require('./market-delegation-service');
const { resolveActiveAssignmentByMarketCode, resolveAuthorization } = require('./market-delegation-team-service');
const pricingPeriodStructure = require('./pricing-period-structure');

function requireExecutor(executor) {
  if (!executor || typeof executor.query !== 'function') {
    throw new TypeError('market-delegation-structure-event-service: executor.query requis');
  }
  return executor;
}

function delegationError(code, message, status = 403) {
  const error = new Error(message || code);
  error.code = code;
  error.status = status;
  return error;
}

async function listStructureEvents(executor, { marketCode, actorUserId, chargeId = null, limit = undefined }) {
  const db = requireExecutor(executor);
  const authz = await resolveAuthorization(db, { userId: actorUserId, marketCode, requiredCapability: 'pricing.read' });
  const events = await pricingPeriodStructure.listStructureCostEvents({
    chargeId,
    scopeKind: pricingPeriodStructure.SCOPE_KINDS.MARKET_DIRECT,
    marketId: authz.market_id,
    limit,
  });
  return { authz, events };
}

/**
 * Enregistre un fait de charge structurelle MARKET_DIRECT pour le marché de
 * l'appelant. scope_kind et market_id sont TOUJOURS ceux résolus serveur —
 * jamais une valeur du body, même si le client en fournit une identique par
 * coïncidence : un scope_kind=GROUP ou un market_id envoyé est un refus
 * explicite, jamais une correction silencieuse.
 *
 * Le writer canonique accepte ici l'executor transactionnel du caller.
 * Le fait économique et market_delegation_audit utilisent donc exactement
 * la même transaction : si l'audit échoue, le fait est rollbacké.
 * economic-engine reste lifecycle owner et seul writer de la table métier.
 */
async function recordStructureEvent(executor, { marketCode, actorUserId, correlationId = null, payload = {} }) {
  const db = requireExecutor(executor);
  const authz = await resolveAuthorization(db, { userId: actorUserId, marketCode, requiredCapability: 'structure.event.record' });

  if (payload.market_id != null || payload.marketId != null) {
    throw delegationError('MARKET_ID_FORBIDDEN', 'market_id client interdit ; utilisez le code marché de la route.', 400);
  }
  const requestedScope = payload.scope_kind ? String(payload.scope_kind).trim().toUpperCase() : null;
  if (requestedScope && requestedScope !== pricingPeriodStructure.SCOPE_KINDS.MARKET_DIRECT) {
    throw delegationError('STRUCTURE_EVENT_SCOPE_FORBIDDEN', 'Un opérateur pays ne peut jamais enregistrer un événement GROUP.', 403);
  }

  let event;
  try {
    event = await pricingPeriodStructure.recordStructureCostEvent(
      { ...payload, scope_kind: pricingPeriodStructure.SCOPE_KINDS.MARKET_DIRECT, market_id: authz.market_id },
      actorUserId,
      { executor: db }
    );
  } catch (error) {
    throw translateStructureEventError(error);
  }

  // Même executor transactionnel que le writer : vérité + preuve sont atomiques.
  await audit(db, {
    actorUserId, assignmentId: authz.assignment_id, membershipId: authz.membership_id,
    capability: 'structure.event.record', action: 'STRUCTURE_EVENT_RECORDED',
    after: event, correlationId,
  });

  return event;
}

function translateStructureEventError(error) {
  const message = String((error && error.message) || '');
  if (message === 'charge not found') return delegationError('STRUCTURE_EVENT_CHARGE_NOT_FOUND', 'Charge introuvable.', 404);
  if (message === 'market not found or inactive') return delegationError('MARKET_NOT_FOUND', 'Marché introuvable ou inactif.', 404);
  if (message === 'adjusted event not found') return delegationError('STRUCTURE_EVENT_NOT_FOUND', 'Fait à corriger introuvable.', 404);
  if (
    message.endsWith('is required')
    || message.includes('must be')
    || message.includes('length must be')
    || message.includes('invalid')
    || message.includes('cannot')
    || message.includes('requires')
  ) {
    return delegationError('STRUCTURE_EVENT_VALIDATION_FAILED', message, 400);
  }
  return error;
}

module.exports = {
  resolveActiveAssignmentByMarketCode,
  resolveAuthorization,
  listStructureEvents,
  recordStructureEvent,
};
