/**
 * @komerce-arch
 * @role          market-delegation-client-case-service
 * @domain        market-delegation
 * @layer         service
 * @criticality   high
 * @inputs        authenticated market operator, market code, dispute workflow payload
 * @outputs       dispute read model, auditable workflow mutations
 * @depends       services/market-delegation-team-service.js, services/market-delegation-service.js, services/dispute-mutation-service.js
 * @used-by       routes/market-delegation-client-case.js
 * @db-read       none
 * @db-write      none
 * @db-write-via:dispute-mutation-service disputes
 * @db-write-via:market-delegation-service market_delegation_audit
 * @db-txn        caller-owned
 * @doctrine      client_case_authority_is_capability_based, client_market_id_never_authority, writer_not_owner_boundary, refund_authority_never_delegated
 * @impact-areas  market, delegation, orders
 * @version       2026-09
 */
'use strict';

const { audit } = require('./market-delegation-service');
const { resolveActiveAssignmentByMarketCode, resolveAuthorization } = require('./market-delegation-team-service');
const disputeMutation = require('./dispute-mutation-service');

function requireExecutor(executor) {
  if (!executor || typeof executor.query !== 'function') {
    throw new TypeError('market-delegation-client-case-service: executor.query requis');
  }
  return executor;
}

function delegationError(code, message, status = 403) {
  const error = new Error(message || code);
  error.code = code;
  error.status = status;
  return error;
}

async function listDisputes(executor, { marketId }) {
  return disputeMutation.listDisputesForMarket(marketId, requireExecutor(executor));
}

async function updateDisputeWorkflow(executor, { marketCode, actorUserId, correlationId = null, disputeId, status, resolution }) {
  const db = requireExecutor(executor);
  const authz = await resolveAuthorization(db, { userId: actorUserId, marketCode, requiredCapability: 'client.case.handle' });

  let result;
  try {
    result = await disputeMutation.updateDisputeWorkflow(disputeId, authz.market_id, { status, resolution }, actorUserId, db);
  } catch (error) {
    if (error instanceof disputeMutation.DisputeValidationError) {
      throw delegationError(error.code, error.message, error.status);
    }
    throw error;
  }
  if (!result) throw delegationError('CLIENT_CASE_NOT_FOUND', 'Litige introuvable.', 404);

  // refund_kmf/refund_eur ne changent jamais par cette voie — avant/après
  // audités tels quels pour preuve qu'ils sont restés identiques.
  await audit(db, {
    actorUserId, assignmentId: authz.assignment_id, membershipId: authz.membership_id,
    capability: 'client.case.handle', action: 'CLIENT_CASE_WORKFLOW_UPDATED',
    before: result.before, after: result.after, correlationId,
  });

  return result.after;
}

module.exports = {
  resolveActiveAssignmentByMarketCode,
  resolveAuthorization,
  listDisputes,
  updateDisputeWorkflow,
};
