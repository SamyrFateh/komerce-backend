/**
 * @komerce-arch
 * @role          canonical-admin-context-resolver
 * @domain        admin-dashboard
 * @layer         service
 * @criticality   high
 * @inputs        authenticated_admin, dashboard_global_access_grants, operator_market_scopes, markets, market_delegation_memberships
 * @outputs       server_resolved_admin_context
 * @depends       db.js, middleware/require-dashboard-global-authority.js, services/market-delegation-service.js
 * @used-by       routes/admin-dashboard-market.js
 * @db-read       dashboard_global_access_grants, operator_market_scopes, markets, market_operating_assignments, assignment_memberships, membership_capabilities, assignment_capability_ceiling, users, relais
 * @db-write      none
 * @db-txn        none
 * @doctrine      server_global_context_explicit, central_hub_logistics_context_not_dashboard_grant, server_market_scope_is_authority, delegated_capability_projection_is_never_authority, delegated_capability_projection_stays_market_scoped
 * @impact-areas  admin-dashboard, market-authorization, canonical
 * @version       2026-09
 */

'use strict';

const db = require('../db');
const { hasDashboardGlobalAuthority } = require('../middleware/require-dashboard-global-authority');
const { CENTRAL_TRANSIT_ROLES } = require('../config/central-transit-roles');
const { resolveAuthorization, listAuthorizedMarketsForCapability } = require('./market-delegation-service');

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

/**
 * Workspace-only market selection: never derive it from users.role, user.country
 * or an unrelated operator_market_scopes legacy row.
 *
 * The market delegation service applies ACTIVE membership + assignment +
 * capability ceiling + non-revoked grant. Individual workspace API routes
 * continue to enforce their own rights for every selected market.
 */
const WORKSPACE_READ_CAPABILITIES = Object.freeze({
  finance: Object.freeze(['finance.read']),
});

async function getWorkspaceMarketCodes(user) {
  if (CENTRAL_TRANSIT_ROLES.includes(user.role)) {
    // Central Hub serves imported orders from all ACTIVE markets.
    // These codes are a read-only logistics filter, not an authorization
    // to access prices, teams, finance or market-scoped business actions.
    return getAllActiveMarketCodes();
  }
  if (user.role === 'agent_relais') {
    // Physical relay binding is the server-side authority for Relay workspaces.
    const { rows } = await db.query(
      `SELECT DISTINCT m.code
         FROM users u
         JOIN relais r ON r.id = u.relais_id AND r.is_active = TRUE
         JOIN markets m ON m.id = r.market_id AND m.is_active = TRUE
        WHERE u.id = $1::uuid
        ORDER BY m.code`,
      [user.id]
    );
    return rows.map(row => row.code);
  }

  const capabilities = WORKSPACE_READ_CAPABILITIES[user.role];
  if (!capabilities) return getScopedMarketCodes(user.id);

  const lists = await Promise.all(capabilities.map(requiredCapability =>
    listAuthorizedMarketsForCapability(db, { userId: user.id, requiredCapability })
  ));
  const delegatedCodes = [...new Set(lists.flatMap(rows =>
    rows.map(row => row.market_code).filter(Boolean)
  ))];
  if (!delegatedCodes.length) return [];

  // Workspaces reject inactive markets. Filter the context by that same
  // lifecycle boundary; do not turn a suspended/inactive market into access.
  const { rows } = await db.query(
    `SELECT code FROM markets
      WHERE is_active = TRUE AND code = ANY($1::text[])
      ORDER BY code ASC`,
    [delegatedCodes]
  );
  return rows.map(row => row.code);
}

// LOT B (audit dashboard.market.read) : dashboard.market.read est
// DELEGATION/MARKET/DELEGABLE au registre — elle n'est jamais fabriquée ici
// juste parce que mode === 'market' (même fix que client.read). Sa détention
// réelle vit uniquement dans delegatedCapabilities[marketCode], jamais dans
// cette liste de base.
function capabilitiesFor(mode) {
  // V1 Hub is not Admin central: do not advertise dashboard/global business
  // capabilities from a logistics-wide set of visible market codes.
  if (mode === 'hub') return [];
  const base = ['pilotage.read'];
  if (mode === 'global') base.push('dashboard.global.read');
  return base;
}

// Codes d'erreur `market-delegation-service::resolveAuthorization` qui ne
// signifient rien d'autre que « ce user ne détient aucune capability
// DELEGATION active sur ce marché » (pas de Market Operating Assignment
// actif, pas de membership active, marché inconnu/inactif). Ce ne sont
// jamais des pannes : l'UI doit juste projeter une liste vide pour ce
// marché, jamais faire échouer tout le AdminContext.
const NO_DELEGATED_CAPABILITY_CODES = new Set([
  'MARKET_MEMBERSHIP_REQUIRED',
  'MARKET_ASSIGNMENT_NOT_ACTIVE',
  'MARKET_NOT_FOUND',
  'MARKET_CODE_INVALID',
]);

// Projette, marché par marché, les capabilities DELEGATION réellement
// détenues par ce user (assignment_memberships / membership_capabilities).
// ATTENTION (GAP 3B / LOT A) :
//  - ce n'est JAMAIS une autorité : chaque route market-delegation revérifie
//    systématiquement `requireMarketDelegatedCapability(...)` server-side ;
//  - la projection reste strictement scoped à chaque `code` — on ne fabrique
//    jamais une union qui ferait croire qu'une capability détenue sur un
//    marché existe aussi sur un autre.
async function delegatedCapabilitiesByMarket(userId, marketCodes) {
  const entries = await Promise.all(marketCodes.map(async code => {
    try {
      // requiredCapability volontairement omis (null) : on veut la liste
      // complète des capabilities actives sur CE marché, pas la vérification
      // d'une capability précise.
      const authz = await resolveAuthorization(db, { userId, marketCode: code, requiredCapability: null });
      return [code, authz.capabilities];
    } catch (error) {
      if (error && NO_DELEGATED_CAPABILITY_CODES.has(error.code)) return [code, []];
      throw error;
    }
  }));
  return Object.fromEntries(entries);
}

async function resolveDashboardAdminContext(user) {
  if (!user || !user.id || !user.role) throw new DashboardAccessDeniedError();

  // Four operational profiles V1: Hub is a CENTRAL logistics actor, NOT a
  // subordinate of a country's market team. Never project dashboard-global
  // authority or delegated commercial capabilities onto this role.
  const centralHub = user.role === 'agent_hub';
  const globalAuthority = !centralHub && await hasDashboardGlobalAuthority(user.id);
  const allowedMarkets = globalAuthority
    ? await getAllActiveMarketCodes()
    : await getWorkspaceMarketCodes(user);

  if (!allowedMarkets.length) {
    throw new DashboardAccessDeniedError();
  }

  // UI context only. Every business API separately enforces its own role
  // and operation guard; 'hub' must never behave like 'global' in guards.
  const mode = centralHub ? 'hub' : globalAuthority ? 'global' : 'market';

  // Un admin global voit déjà tout (dashboard.global.read) : cette projection
  // ne sert qu'à décider une visibilité UI pour un opérateur scopé, donc on
  // ne la calcule (et n'interroge la DELEGATION) qu'en mode market.
  const delegatedCapabilities = mode === 'market' && !CENTRAL_TRANSIT_ROLES.includes(user.role)
    ? await delegatedCapabilitiesByMarket(user.id, allowedMarkets)
    : {};

  return Object.freeze({
    actor: Object.freeze({ id: String(user.id), role: String(user.role) }),
    access: Object.freeze({
      mode,
      allowedMarkets: Object.freeze([...allowedMarkets]),
      defaultMarket: mode === 'global' ? null : allowedMarkets[0],
      capabilities: Object.freeze(capabilitiesFor(mode)),
      delegatedCapabilities: Object.freeze(
        Object.fromEntries(
          Object.entries(delegatedCapabilities).map(([code, caps]) => [code, Object.freeze([...caps])])
        )
      ),
    }),
  });
}

module.exports = {
  DashboardAccessDeniedError,
  getAllActiveMarketCodes,
  getScopedMarketCodes,
  getWorkspaceMarketCodes,
  capabilitiesFor,
  delegatedCapabilitiesByMarket,
  resolveDashboardAdminContext,
};
