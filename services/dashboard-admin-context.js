/**
 * @komerce-arch
 * @role          canonical-admin-context-resolver
 * @domain        admin-dashboard
 * @layer         service
 * @criticality   high
 * @inputs        authenticated_admin, dashboard_global_access_grants, operator_market_scopes, markets
 * @outputs       server_resolved_admin_context
 * @depends       db.js, middleware/require-dashboard-global-authority.js
 * @used-by       routes/admin-dashboard-market.js
 * @db-read       dashboard_global_access_grants, operator_market_scopes, markets
 * @db-write      none
 * @db-txn        none
 * @doctrine      server_global_context_explicit, server_market_scope_is_authority
 * @impact-areas  admin-dashboard, market-authorization, canonical
 * @version       2026-08
 */

'use strict';

const db = require('../db');
const { hasDashboardGlobalAuthority } = require('../middleware/require-dashboard-global-authority');

class DashboardAccessDeniedError extends Error {
  constructor() {
    super('dashboard_access_denied');
    this.name = 'DashboardAccessDeniedError';
    this.code = 'dashboard_access_denied';
  }
}

async function getAllActiveMarketCodes() {
  const { rows } = await db.query(
    `SELECT code
     FROM markets
     WHERE is_active = TRUE
     ORDER BY code ASC`
  );
  return rows.map(row => row.code);
}

async function getScopedMarketCodes(userId) {
  const { rows } = await db.query(
    `SELECT m.code
     FROM operator_market_scopes oms
     JOIN markets m ON m.id = oms.market_id
     WHERE oms.user_id = $1
       AND oms.revoked_at IS NULL
       AND m.is_active = TRUE
     ORDER BY oms.granted_at ASC, m.code ASC`,
    [userId]
  );
  return rows.map(row => row.code);
}

function capabilitiesFor(mode) {
  const base = ['pilotage.read', 'dashboard.market.read'];
  if (mode === 'global') base.push('dashboard.global.read');
  return base;
}

async function resolveDashboardAdminContext(user) {
  if (!user || !user.id || !user.role) throw new DashboardAccessDeniedError();

  const globalAuthority = await hasDashboardGlobalAuthority(user.id);
  const allowedMarkets = globalAuthority
    ? await getAllActiveMarketCodes()
    : await getScopedMarketCodes(user.id);

  if (!globalAuthority && allowedMarkets.length === 0) {
    throw new DashboardAccessDeniedError();
  }

  const mode = globalAuthority ? 'global' : 'market';
  return Object.freeze({
    actor: Object.freeze({ id: String(user.id), role: String(user.role) }),
    access: Object.freeze({
      mode,
      allowedMarkets: Object.freeze([...allowedMarkets]),
      defaultMarket: mode === 'global' ? null : allowedMarkets[0],
      capabilities: Object.freeze(capabilitiesFor(mode)),
    }),
  });
}

module.exports = {
  DashboardAccessDeniedError,
  getAllActiveMarketCodes,
  getScopedMarketCodes,
  capabilitiesFor,
  resolveDashboardAdminContext,
};
