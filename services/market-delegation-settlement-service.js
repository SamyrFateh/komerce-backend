/**
 * @komerce-arch
 * @role          market-delegation-settlement-orchestration
 * @domain        market-delegation
 * @layer         service
 * @criticality   high
 * @inputs        authenticated market operator, market code, settlement action
 * @outputs       assignment-scoped settlement read/actions with delegation audit
 * @depends       services/market-delegation-team-service.js, services/market-delegation-service.js, services/market-settlement-service.js
 * @used-by       routes/market-delegation-settlement.js
 * @db-read       none
 * @db-write      none
 * @db-write-via:market-settlement-service market_settlements, market_settlement_events
 * @db-write-via:market-delegation-service market_delegation_audit
 * @db-txn        caller-owned
 * @doctrine      capability_based_finance_actions, client_market_id_never_authority, monetary_snapshot_never_client_writable
 * @impact-areas  market, delegation, settlement, finance
 * @version       2026-09
 */
'use strict';

const { audit } = require('./market-delegation-service');
const { resolveAuthorization } = require('./market-delegation-team-service');
const settlement = require('./market-settlement-service');

function requireExecutor(executor) {
  if (!executor || typeof executor.query !== 'function') {
    throw new TypeError('market-delegation-settlement-service: executor.query requis');
  }
  return executor;
}

function translate(error) {
  if (error instanceof settlement.MarketSettlementError) return error;
  return error;
}

async function listSettlements(executor, { marketCode, actorUserId }) {
  const db = requireExecutor(executor);
  const authz = await resolveAuthorization(db, {
    userId: actorUserId,
    marketCode,
    requiredCapability: 'finance.read',
  });
  const settlements = await settlement.listForAssignment(db, {
    marketId: authz.market_id,
    assignmentId: authz.assignment_id,
  });
  return { authz, settlements };
}

async function requestSettlement(executor, { marketCode, actorUserId, settlementId, correlationId = null }) {
  const db = requireExecutor(executor);
  const authz = await resolveAuthorization(db, {
    userId: actorUserId,
    marketCode,
    requiredCapability: 'finance.act',
  });
  let result;
  try {
    result = await settlement.requestSettlement(db, {
      settlementId,
      marketId: authz.market_id,
      assignmentId: authz.assignment_id,
      actorUserId,
      correlationId,
    });
  } catch (error) {
    throw translate(error);
  }
  await audit(db, {
    actorUserId,
    assignmentId: authz.assignment_id,
    membershipId: authz.membership_id,
    capability: 'finance.act',
    action: 'SETTLEMENT_REQUESTED',
    before: result.before,
    after: result.after,
    correlationId,
  });
  return result.after;
}

async function confirmSettlementReceived(executor, {
  marketCode,
  actorUserId,
  settlementId,
  receiptNote = null,
  correlationId = null,
}) {
  const db = requireExecutor(executor);
  const authz = await resolveAuthorization(db, {
    userId: actorUserId,
    marketCode,
    requiredCapability: 'settlement.receive',
  });
  let result;
  try {
    result = await settlement.confirmReceived(db, {
      settlementId,
      marketId: authz.market_id,
      assignmentId: authz.assignment_id,
      actorUserId,
      receiptNote,
      correlationId,
    });
  } catch (error) {
    throw translate(error);
  }
  await audit(db, {
    actorUserId,
    assignmentId: authz.assignment_id,
    membershipId: authz.membership_id,
    capability: 'settlement.receive',
    action: 'SETTLEMENT_RECEIVED',
    before: result.before,
    after: result.after,
    correlationId,
  });
  return result.after;
}

module.exports = {
  listSettlements,
  requestSettlement,
  confirmSettlementReceived,
};
