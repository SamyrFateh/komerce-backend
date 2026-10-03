#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          economic-engine-market-cost-attribution-conservation-check
 * @domain        economic-engine
 * @layer         tooling
 * @criticality   high
 * @purpose       Audit opérationnel en lecture seule : somme des attributions actives = montant du fait GROUP.
 * @inputs        DATABASE_URL, optional --event-id
 * @outputs       stdout report, process exit code
 * @depends       db, services/market-cost-attribution-service.js
 * @used-by       package.json
 * @db-read       economic_structure_cost_events, market_cost_attributions
 * @db-write      none
 * @db-txn        none
 * @doctrine      pricing_market_viability_cost_scope
 * @impact-areas  economic-engine, governance
 * @version       2026-10
 */

'use strict';

const db = require('../db');
const { auditAttributionConservation } = require('../services/market-cost-attribution-service');

function parseEventIds(argv) {
  const ids = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--event-id' && argv[i + 1]) ids.push(argv[i + 1]);
  }
  return ids.length ? ids : null;
}

async function main(argv = process.argv.slice(2)) {
  const report = await auditAttributionConservation({ eventIds: parseEventIds(argv) });
  console.log(`Attributions : ${report.checked_events} fait(s) contrôlé(s), ${report.violations.length} violation(s).`);
  for (const violation of report.violations) {
    console.log(`  [${violation.code}] fait ${violation.event_id} : actif ${violation.active_total_kmf} / montant ${violation.event_amount_kmf}`);
  }
  return report.conserved ? 0 : 1;
}

/* istanbul ignore next -- point d'entrée CLI, la logique est testée via main() */
if (require.main === module) {
  main()
    .then(async (code) => { await db.pool.end(); process.exit(code); })
    .catch(async (error) => {
      console.error(error.message);
      try { await db.pool.end(); } catch (_) { /* ignore */ }
      process.exit(2);
    });
}

module.exports = { main, parseEventIds };
