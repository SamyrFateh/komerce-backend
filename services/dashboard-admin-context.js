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
 * @db-read       dashboard_global_access_grants, operator_market_scopes, markets, market_operating_assignments, assignment_memberships, membership_capabilities, assignment_capability_ceiling
 * @db-write      none
 * @db-txn        none
 * @doctrine      server_global_context_explicit, server_market_scope_is_authority, delegated_capability_projection_is_never_authority, delegated_capability_projection_stays_market_scoped
 * @impact-areas  admin-dashboard, market-authorization, canonical
 * @version       2026-09
 */

'use strict';

const db = require('../db');
const { hasDashboardGlobalAuthority } = require('../middleware/require-dashboard-global-authority');
const { resolveAuthorization } = require('./market-delegation-service');

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

// LOT B (audit dashboard.market.read) : dashboard.market.read est
// DELEGATION/MARKET/DELEGABLE au registre — elle n'est jamais fabriquée ici
// juste parce que mode === 'market' (même fix que client.read). Sa détention
// réelle vit uniquement dans delegatedCapabilities[marketCode], jamais dans
// cette liste de base.
function capabilitiesFor(mode) {
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

  const globalAuthority = await hasDashboardGlobalAuthority(user.id);
  const allowedMarkets = globalAuthority
    ? await getAllActiveMarketCodes()
    : await getScopedMarketCodes(user.id);

  if (!globalAuthority && allowedMarkets.length === 0) {
    throw new DashboardAccessDeniedError();
  }

  const mode = globalAuthority ? 'global' : 'market';

  // Un admin global voit déjà tout (dashboard.global.read) : cette projection
  // ne sert qu'à décider une visibilité UI pour un opérateur scopé, donc on
  // ne la calcule (et n'interroge la DELEGATION) qu'en mode market.
  const delegatedCapabilities = mode === 'market'
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
  capabilitiesFor,
  delegatedCapabilitiesByMarket,
  resolveDashboardAdminContext,
};
