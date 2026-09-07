/**
 * @komerce-arch
 * @role          market-operator-scope-admin-boundary
 * @domain        market
 * @layer         service
 * @criticality   high
 * @inputs        caller_owned_executor, user_id, market_code, scope_role, actor_id
 * @outputs       active_markets, scope_projection, scope_history, revoke_result
 * @depends       none
 * @used-by       dashboard
 * @db-read       markets, operator_market_scopes
 * @db-write      operator_market_scopes
 * @db-txn        caller-owned
 * @doctrine      lifecycle_owner_persistence_boundary
 * @impact-areas  market, dashboard, admin-dashboard
 * @version       2026-09
 */

'use strict';

const VALID_SCOPE_ROLES = new Set(['viewer', 'manager']);

function requireExecutor(executor) {
  if (!executor || typeof executor.query !== 'function') {
    throw new TypeError('market-scope-admin-service: executor.query requis');
  }
  return executor;
}

function normalizeMarketCode(marketCode) {
  const code = String(marketCode || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

function normalizeScopeRole(scopeRole) {
  const role = String(scopeRole || '').trim().toLowerCase();
  return VALID_SCOPE_ROLES.has(role) ? role : null;
}

async function listActiveMarkets(executor) {
  const { rows } = await requireExecutor(executor).query(
    `SELECT id, code, name, currency, minor_unit
       FROM markets
      WHERE is_active = true
      ORDER BY name ASC, code ASC`
  );
  return rows;
}

async function listActiveScopesForUsers(executor, userIds) {
  if (!Array.isArray(userIds) || userIds.length === 0) return [];
  const { rows } = await requireExecutor(executor).query(
    `SELECT oms.id,
            oms.user_id,
            oms.role AS scope_role,
            oms.granted_at,
            oms.granted_by,
            m.id AS market_id,
            m.code AS market_code,
            m.name AS market_name,
            m.currency
       FROM operator_market_scopes oms
       JOIN markets m ON m.id = oms.market_id
      WHERE oms.user_id = ANY($1::uuid[])
        AND oms.revoked_at IS NULL
      ORDER BY oms.user_id, m.code`,
    [userIds]
  );
  return rows;
}

async function listUserMarketScopeHistory(executor, userId) {
  const { rows } = await requireExecutor(executor).query(
    `SELECT oms.id,
            oms.user_id,
            oms.role AS scope_role,
            oms.granted_at,
            oms.granted_by,
            oms.revoked_at,
            oms.revoked_by,
            m.id AS market_id,
            m.code AS market_code,
            m.name AS market_name,
            m.currency
       FROM operator_market_scopes oms
       JOIN markets m ON m.id = oms.market_id
      WHERE oms.user_id = $1::uuid
      ORDER BY oms.granted_at DESC, oms.id DESC`,
    [userId]
  );
  return rows;
}

async function hasUserMarketScopeHistory(executor, userId) {
  const { rows } = await requireExecutor(executor).query(
    `SELECT EXISTS (
       SELECT 1
         FROM operator_market_scopes
        WHERE user_id = $1::uuid
     ) AS has_history`,
    [userId]
  );
  return Boolean(rows[0] && rows[0].has_history);
}

async function resolveActiveMarket(executor, marketCode) {
  const code = normalizeMarketCode(marketCode);
  if (!code) return null;
  const { rows } = await requireExecutor(executor).query(
    `SELECT id, code, name, currency, minor_unit
       FROM markets
      WHERE code = $1
        AND is_active = true
      LIMIT 1`,
    [code]
  );
  return rows[0] || null;
}

async function grantOrReplaceMarketScope(executor, {
  userId,
  marketCode,
  scopeRole,
  grantedBy = null,
}) {
  const db = requireExecutor(executor);
  const role = normalizeScopeRole(scopeRole);
  const market = await resolveActiveMarket(db, marketCode);

  if (!role) return { status: 'invalid_scope_role', scope: null };
  if (!market) return { status: 'market_not_found', scope: null };

  const { rows: activeRows } = await db.query(
    `SELECT id, role, granted_at, granted_by
       FROM operator_market_scopes
      WHERE user_id = $1::uuid
        AND market_id = $2::uuid
        AND revoked_at IS NULL
      FOR UPDATE`,
    [userId, market.id]
  );

  const active = activeRows[0] || null;
  if (active && active.role === role) {
    return {
      status: 'unchanged',
      scope: {
        id: active.id,
        user_id: userId,
        market_id: market.id,
        market_code: market.code,
        market_name: market.name,
        currency: market.currency,
        scope_role: active.role,
        granted_at: active.granted_at,
        granted_by: active.granted_by,
      },
    };
  }

  if (active) {
    await db.query(
      `UPDATE operator_market_scopes
          SET revoked_at = NOW(),
              revoked_by = $3::uuid
        WHERE id = $1::uuid
          AND user_id = $2::uuid
          AND revoked_at IS NULL`,
      [active.id, userId, grantedBy]
    );
  }

  const { rows } = await db.query(
    `INSERT INTO operator_market_scopes (
       user_id,
       market_id,
       role,
       granted_by
     )
     VALUES ($1::uuid, $2::uuid, $3, $4::uuid)
     RETURNING id, user_id, market_id, role AS scope_role, granted_at, granted_by`,
    [userId, market.id, role, grantedBy]
  );

  return {
    status: active ? 'replaced' : 'granted',
    scope: {
      ...rows[0],
      market_code: market.code,
      market_name: market.name,
      currency: market.currency,
    },
  };
}

async function revokeMarketScope(executor, {
  userId,
  marketCode,
  revokedBy = null,
}) {
  const db = requireExecutor(executor);
  const market = await resolveActiveMarket(db, marketCode);
  if (!market) return { status: 'market_not_found', revoked: null };

  const { rows } = await db.query(
    `UPDATE operator_market_scopes
        SET revoked_at = NOW(),
            revoked_by = $3::uuid
      WHERE user_id = $1::uuid
        AND market_id = $2::uuid
        AND revoked_at IS NULL
      RETURNING id, user_id, market_id, role AS scope_role, granted_at, revoked_at, revoked_by`,
    [userId, market.id, revokedBy]
  );

  if (!rows[0]) return { status: 'not_active', revoked: null };
  return {
    status: 'revoked',
    revoked: {
      ...rows[0],
      market_code: market.code,
      market_name: market.name,
      currency: market.currency,
    },
  };
}

async function revokeAllUserMarketScopes(executor, {
  userId,
  revokedBy = null,
}) {
  const { rows } = await requireExecutor(executor).query(
    `UPDATE operator_market_scopes
        SET revoked_at = NOW(),
            revoked_by = $2::uuid
      WHERE user_id = $1::uuid
        AND revoked_at IS NULL
      RETURNING id, market_id, role AS scope_role, revoked_at`,
    [userId, revokedBy]
  );
  return rows;
}

module.exports = {
  VALID_SCOPE_ROLES,
  normalizeMarketCode,
  normalizeScopeRole,
  listActiveMarkets,
  listActiveScopesForUsers,
  listUserMarketScopeHistory,
  hasUserMarketScopeHistory,
  grantOrReplaceMarketScope,
  revokeMarketScope,
  revokeAllUserMarketScopes,
};
