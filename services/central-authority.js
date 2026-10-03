/**
 * @komerce-arch
 * @role          central-authority-single-lookup
 * @domain        market-control-plane
 * @layer         service
 * @criticality   high
 * @inputs        user id, central domain (dashboard, catalog, decision_signal, pricing, sourcing)
 * @outputs       central(user, domain) boolean and the read-only overview of active central grants
 * @depends       config/market-delegation-capabilities.js, middleware/require-dashboard-global-authority.js, middleware/require-catalog-global-authority.js, middleware/require-decision-signal-global-authority.js, middleware/require-pricing-global-authority.js, middleware/require-sourcing-global-authority.js
 * @used-by       services/market-control-plane.js
 * @db-read       dashboard_global_access_grants, catalog_global_access_grants, decision_signal_global_access_grants, pricing_global_access_grants, sourcing_global_access_grants
 * @db-write      none
 * @db-txn        none
 * @doctrine      central_authority_is_explicit_grant, admin_role_never_implies_canonical_authority, no_second_authorization_engine
 * @impact-areas  market-delegation, authorization, dashboard, economic-engine
 * @version       2026-10-v1
 */
'use strict';

/**
 * `central(X, domaine)` : UNE seule porte d'entrée vers les cinq autorisations
 * centrales explicites. Elle délègue aux fonctions existantes de chaque middleware
 * (aucun SQL d'autorisation dupliqué) et déclare le catalogue dans le registre
 * (config/market-delegation-capabilities.js). Elle n'accorde rien : elle répond.
 */

const { CENTRAL_AUTHORITY, GROUP_CAPABILITY_AUTHORITY } = require('../config/market-delegation-capabilities');
const { hasDashboardGlobalAuthority } = require('../middleware/require-dashboard-global-authority');
const { hasCatalogGlobalAuthority } = require('../middleware/require-catalog-global-authority');
const { hasDecisionSignalGlobalAuthority } = require('../middleware/require-decision-signal-global-authority');
const { hasPricingGlobalAuthority } = require('../middleware/require-pricing-global-authority');
const { hasSourcingGlobalAuthority } = require('../middleware/require-sourcing-global-authority');

const LOOKUPS = Object.freeze({
  dashboard: hasDashboardGlobalAuthority,
  catalog: hasCatalogGlobalAuthority,
  decision_signal: hasDecisionSignalGlobalAuthority,
  pricing: hasPricingGlobalAuthority,
  sourcing: hasSourcingGlobalAuthority,
});

function domains() {
  return Object.keys(CENTRAL_AUTHORITY);
}

async function central(userId, domain) {
  const lookup = LOOKUPS[domain];
  if (!lookup) throw new Error(`domaine d'autorité centrale inconnu : ${domain}`);
  return lookup(userId);
}

/** Lecture seule : titulaires actifs par domaine. Les noms de table viennent du registre figé. */
async function overview(executor) {
  if (!executor || typeof executor.query !== 'function') throw new TypeError('central-authority: executor.query requis');
  const result = [];
  for (const domain of domains()) {
    const { table, guard } = CENTRAL_AUTHORITY[domain];
    const { rows } = await executor.query(
      `SELECT user_id, granted_at, reason FROM ${table} WHERE revoked_at IS NULL ORDER BY granted_at, user_id`
    );
    result.push({ domain, table, guard, holders: rows, count: rows.length });
  }
  const groupCapabilities = Object.entries(GROUP_CAPABILITY_AUTHORITY)
    .map(([capability, domain]) => ({ capability, authority: domain }));
  return { domains: result, group_capabilities: groupCapabilities };
}

module.exports = { LOOKUPS, central, domains, overview };
