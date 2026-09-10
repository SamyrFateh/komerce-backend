/**
 * @komerce-arch
 * @role          market-cash-control-policy-service
 * @domain        market-delegation
 * @layer         service
 * @criticality   critical
 * @inputs        authenticated user, market code, partner cash policy
 * @outputs       effective market cash policy, auditable policy mutation
 * @depends       services/market-delegation-team-service.js, services/market-delegation-service.js
 * @used-by       routes/market-delegation-cash-control.js, services/cash-confirmation-control-service.js
 * @db-read       market_cash_control_policies, market_operating_assignments, markets, assignment_memberships, membership_capabilities, assignment_capability_ceiling
 * @db-write      market_cash_control_policies
 * @db-write-via:market-delegation-service market_delegation_audit
 * @db-txn        caller-owned
 * @doctrine      partner_controls_local_cash_policy, central_safety_floor_non_bypassable, no_client_market_id_authority
 * @impact-areas  market-delegation, payment, cash, relay
 * @version       2026-09
 */
'use strict';

const { resolveAuthorization } = require('./market-delegation-team-service');
const { audit } = require('./market-delegation-service');

const DEFAULT_POLICY = Object.freeze({
  cash_enabled: true,
  confirmation_mode: 'SINGLE',
});

function requireExecutor(executor) {
  if (!executor || typeof executor.query !== 'function') {
    throw new TypeError('market-cash-control-policy-service: executor.query requis');
  }
  return executor;
}

function policyError(code, message, status = 400) {
  const error = new Error(message || code);
  error.code = code;
  error.status = status;
  return error;
}

function normalizePolicyInput(payload) {
  const source = payload || {};
  const allowed = new Set(['cash_enabled', 'confirmation_mode']);
  const unknown = Object.keys(source).filter(key => !allowed.has(key));
  if (unknown.length) {
    throw policyError('CASH_POLICY_FIELD_FORBIDDEN', `Champ(s) non autorisé(s) : ${unknown.join(', ')}`);
  }

  const cashEnabled = source.cash_enabled;
  if (typeof cashEnabled !== 'boolean') {
    throw policyError('CASH_POLICY_ENABLED_REQUIRED', 'cash_enabled doit être un booléen.');
  }

  const confirmationMode = String(source.confirmation_mode || '').trim().toUpperCase();
  if (!['SINGLE', 'DUAL_ALWAYS'].includes(confirmationMode)) {
    throw policyError('CASH_POLICY_CONFIRMATION_MODE_INVALID', 'confirmation_mode doit être SINGLE ou DUAL_ALWAYS.');
  }

  return {
    cash_enabled: cashEnabled,
    confirmation_mode: confirmationMode,
  };
}

function serializePolicy(row, fallback = {}) {
  if (!row) {
    return {
      ...DEFAULT_POLICY,
      assignment_id: fallback.assignment_id || null,
      market_id: fallback.market_id || null,
      market_code: fallback.market_code || null,
      source: 'DEFAULT',
      updated_at: null,
    };
  }
  return {
    id: row.id,
    assignment_id: row.assignment_id,
    market_id: row.market_id,
    market_code: fallback.market_code || null,
    cash_enabled: Boolean(row.cash_enabled),
    confirmation_mode: row.confirmation_mode,
    source: 'MARKET_POLICY',
    updated_by_membership_id: row.updated_by_membership_id || null,
    updated_at: row.updated_at,
  };
}

async function loadPolicyForAssignment(executor, { assignmentId, marketId, marketCode = null, forUpdate = false }) {
  const db = requireExecutor(executor);
  const { rows } = await db.query(
    `SELECT id, assignment_id, market_id, cash_enabled, confirmation_mode,
            updated_by_membership_id, created_at, updated_at
       FROM market_cash_control_policies
      WHERE assignment_id=$1::uuid
        AND market_id=$2::uuid
      LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
    [assignmentId, marketId]
  );
  return serializePolicy(rows[0], {
    assignment_id: assignmentId,
    market_id: marketId,
    market_code: marketCode,
  });
}

async function readMarketCashPolicy(executor, { userId, marketCode }) {
  const db = requireExecutor(executor);
  const authz = await resolveAuthorization(db, {
    userId,
    marketCode,
    requiredCapability: 'finance.read',
  });
  const policy = await loadPolicyForAssignment(db, {
    assignmentId: authz.assignment_id,
    marketId: authz.market_id,
    marketCode: authz.market_code,
  });
  return { authz, policy };
}

async function updateMarketCashPolicy(executor, {
  userId,
  marketCode,
  payload,
  correlationId = null,
}) {
  const db = requireExecutor(executor);
  const next = normalizePolicyInput(payload);
  const authz = await resolveAuthorization(db, {
    userId,
    marketCode,
    requiredCapability: 'cash_control.policy.manage',
  });

  const before = await loadPolicyForAssignment(db, {
    assignmentId: authz.assignment_id,
    marketId: authz.market_id,
    marketCode: authz.market_code,
    forUpdate: true,
  });

  const { rows } = await db.query(
    `INSERT INTO market_cash_control_policies
      (assignment_id, market_id, cash_enabled, confirmation_mode, updated_by_membership_id)
     VALUES ($1::uuid,$2::uuid,$3,$4,$5::uuid)
     ON CONFLICT (assignment_id) DO UPDATE SET
       market_id = EXCLUDED.market_id,
       cash_enabled = EXCLUDED.cash_enabled,
       confirmation_mode = EXCLUDED.confirmation_mode,
       updated_by_membership_id = EXCLUDED.updated_by_membership_id,
       updated_at = NOW()
     RETURNING id, assignment_id, market_id, cash_enabled, confirmation_mode,
               updated_by_membership_id, created_at, updated_at`,
    [authz.assignment_id, authz.market_id, next.cash_enabled, next.confirmation_mode, authz.membership_id]
  );

  const after = serializePolicy(rows[0], { market_code: authz.market_code });
  await audit(db, {
    actorUserId: userId,
    assignmentId: authz.assignment_id,
    membershipId: authz.membership_id,
    capability: 'cash_control.policy.manage',
    action: 'CASH_CONTROL_POLICY_UPDATED',
    before,
    after,
    correlationId,
  });

  return { authz, policy: after };
}

module.exports = {
  DEFAULT_POLICY,
  normalizePolicyInput,
  loadPolicyForAssignment,
  readMarketCashPolicy,
  updateMarketCashPolicy,
};
