/**
 * @komerce-arch
 * @role          market-operator-access-lifecycle
 * @domain        market
 * @layer         service
 * @criticality   high
 * @inputs        admin_actor, user_id, market_code, viewer_or_manager
 * @outputs       active_market_grants, grant_or_revoke_result
 * @depends       db.withTransaction, users, markets, operator_market_scopes
 * @used-by       routes/admin-market-operators.js
 * @db-read       users, markets, operator_market_scopes
 * @db-write      operator_market_scopes
 * @db-txn        required_for_role_change
 * @doctrine      market_grant_history_append_only, revoke_never_delete, market_operator_only
 * @impact-areas  market, admin-authorization, partner-access
 * @version       2026-09
 */
'use strict';

const VALID_ROLES = new Set(['viewer', 'manager']);
const MARKET_CODE = /^[A-Z]{2}$/;

class MarketOperatorAccessError extends Error {
  constructor(message, status = 400, code = 'market_operator_access_error') {
    super(message);
    this.name = 'MarketOperatorAccessError';
    this.status = status;
    this.code = code;
  }
}

function requireDb(db) {
  if (!db || typeof db.query !== 'function' || typeof db.withTransaction !== 'function') {
    throw new TypeError('market-operator-access-service: db.query + db.withTransaction requis');
  }
  return db;
}

function normalizeMarketCode(value) {
  const code = String(value || '').trim().toUpperCase();
  if (!MARKET_CODE.test(code)) {
    throw new MarketOperatorAccessError('Code marché invalide', 400, 'invalid_market_code');
  }
  return code;
}

function normalizeRole(value) {
  const role = String(value || '').trim().toLowerCase();
  if (!VALID_ROLES.has(role)) {
    throw new MarketOperatorAccessError('Rôle marché invalide — utilisez viewer ou manager', 400, 'invalid_market_scope_role');
  }
  return role;
}

async function listOperators(db) {
  requireDb(db);
  const { rows } = await db.query(
    `SELECT
       u.id AS user_id,
       u.full_name,
       u.email,
       u.phone,
       u.role AS user_role,
       oms.id AS grant_id,
       oms.role AS market_role,
       oms.granted_at,
       m.code AS market_code,
       m.name AS market_name,
       m.currency
     FROM users u
     LEFT JOIN operator_market_scopes oms
       ON oms.user_id = u.id
      AND oms.revoked_at IS NULL
     LEFT JOIN markets m ON m.id = oms.market_id
     WHERE u.role = 'market_operator'
     ORDER BY u.full_name ASC, m.code ASC`
  );

  const byUser = new Map();
  for (const row of rows) {
    let operator = byUser.get(row.user_id);
    if (!operator) {
      operator = {
        user_id: row.user_id,
        full_name: row.full_name,
        email: row.email,
        phone: row.phone,
        role: row.user_role,
        scopes: [],
      };
      byUser.set(row.user_id, operator);
    }
    if (row.grant_id && row.market_code) {
      operator.scopes.push({
        market_code: row.market_code,
        market_name: row.market_name,
        currency: row.currency,
        role: row.market_role,
        granted_at: row.granted_at,
      });
    }
  }
  return [...byUser.values()];
}

async function loadUserAndMarket(client, userId, marketCode) {
  const { rows: users } = await client.query(
    `SELECT id, full_name, email, role
       FROM users
      WHERE id = $1::uuid
      FOR UPDATE`,
    [userId]
  );
  if (!users.length) {
    throw new MarketOperatorAccessError('Utilisateur introuvable', 404, 'user_not_found');
  }
  if (users[0].role !== 'market_operator') {
    throw new MarketOperatorAccessError(
      'Le compte doit avoir le rôle market_operator avant attribution d’un marché',
      409,
      'market_operator_role_required'
    );
  }

  const { rows: markets } = await client.query(
    `SELECT id, code, name, currency
       FROM markets
      WHERE code = $1 AND is_active = TRUE
      LIMIT 1`,
    [marketCode]
  );
  if (!markets.length) {
    throw new MarketOperatorAccessError('Marché introuvable ou inactif', 404, 'market_not_found');
  }
  return { user: users[0], market: markets[0] };
}

async function grantScope(db, { userId, marketCode, role, actorId }) {
  requireDb(db);
  const code = normalizeMarketCode(marketCode);
  const normalizedRole = normalizeRole(role);
  if (!actorId) throw new MarketOperatorAccessError('Administrateur acteur requis', 400, 'actor_required');

  return db.withTransaction(async client => {
    const { user, market } = await loadUserAndMarket(client, userId, code);
    const { rows: activeRows } = await client.query(
      `SELECT id, role, granted_at
         FROM operator_market_scopes
        WHERE user_id = $1::uuid
          AND market_id = $2::uuid
          AND revoked_at IS NULL
        FOR UPDATE`,
      [user.id, market.id]
    );

    const active = activeRows[0] || null;
    if (active && active.role === normalizedRole) {
      return {
        changed: false,
        user: { id: user.id, email: user.email },
        market: { code: market.code, name: market.name, currency: market.currency },
        role: active.role,
        granted_at: active.granted_at,
      };
    }

    if (active) {
      await client.query(
        `UPDATE operator_market_scopes
            SET revoked_at = NOW(), revoked_by = $2::uuid
          WHERE id = $1::uuid AND revoked_at IS NULL`,
        [active.id, actorId]
      );
    }

    const { rows: inserted } = await client.query(
      `INSERT INTO operator_market_scopes (user_id, market_id, role, granted_by)
       VALUES ($1::uuid, $2::uuid, $3, $4::uuid)
       RETURNING id, role, granted_at`,
      [user.id, market.id, normalizedRole, actorId]
    );

    return {
      changed: true,
      user: { id: user.id, email: user.email },
      market: { code: market.code, name: market.name, currency: market.currency },
      role: inserted[0].role,
      granted_at: inserted[0].granted_at,
    };
  });
}

async function revokeScope(db, { userId, marketCode, actorId }) {
  requireDb(db);
  const code = normalizeMarketCode(marketCode);
  if (!actorId) throw new MarketOperatorAccessError('Administrateur acteur requis', 400, 'actor_required');

  return db.withTransaction(async client => {
    const { rows: users } = await client.query(
      `SELECT id, email FROM users WHERE id = $1::uuid FOR UPDATE`,
      [userId]
    );
    if (!users.length) {
      throw new MarketOperatorAccessError('Utilisateur introuvable', 404, 'user_not_found');
    }

    const { rows: markets } = await client.query(
      `SELECT id, code, name, currency
         FROM markets
        WHERE code = $1
        LIMIT 1`,
      [code]
    );
    if (!markets.length) {
      throw new MarketOperatorAccessError('Marché introuvable', 404, 'market_not_found');
    }

    const { rows } = await client.query(
      `UPDATE operator_market_scopes
          SET revoked_at = NOW(), revoked_by = $3::uuid
        WHERE user_id = $1::uuid
          AND market_id = $2::uuid
          AND revoked_at IS NULL
        RETURNING id, role, granted_at, revoked_at`,
      [users[0].id, markets[0].id, actorId]
    );
    if (!rows.length) {
      throw new MarketOperatorAccessError('Aucun scope actif à révoquer sur ce marché', 404, 'active_market_scope_not_found');
    }

    return {
      revoked: true,
      user: { id: users[0].id, email: users[0].email },
      market: { code: markets[0].code, name: markets[0].name, currency: markets[0].currency },
      previous_role: rows[0].role,
      revoked_at: rows[0].revoked_at,
    };
  });
}

module.exports = {
  VALID_ROLES,
  MarketOperatorAccessError,
  listOperators,
  grantScope,
  revokeScope,
};
