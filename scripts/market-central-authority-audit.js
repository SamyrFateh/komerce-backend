#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          market-central-authority-audit
 * @domain        market-control-plane
 * @layer         tooling
 * @criticality   low
 * @inputs        DATABASE_URL
 * @outputs       read-only central authority overview enriched with user identity
 * @depends       db.js, services/central-authority.js
 * @used-by       market provisioning/reprovisioning operations
 * @db-read       users, dashboard_global_access_grants, catalog_global_access_grants, decision_signal_global_access_grants, pricing_global_access_grants, sourcing_global_access_grants
 * @db-write      none
 * @db-txn        none
 * @doctrine      central_authority_is_explicit, tooling_is_read_only
 * @impact-areas  market-control-plane, authorization
 * @version       2026-10-v1
 */
'use strict';

const db = require('../db');
const centralAuthority = require('../services/central-authority');

async function main() {
  const overview = await centralAuthority.overview(db);
  const ids = [...new Set(
    overview.domains
      .flatMap(domain => domain.holders.map(holder => holder.user_id))
      .filter(Boolean)
      .map(String)
  )];

  const users = ids.length
    ? (await db.query(
        'SELECT id,full_name,email,phone,role FROM users WHERE id=ANY($1::uuid[]) ORDER BY full_name',
        [ids]
      )).rows
    : [];

  console.log(JSON.stringify({
    domains: overview.domains,
    users,
  }, null, 2));
}

if (require.main === module) {
  main()
    .catch(error => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => db.pool.end());
}

module.exports = { main };
