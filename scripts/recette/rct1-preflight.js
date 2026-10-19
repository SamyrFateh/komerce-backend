/**
 * @komerce-arch-lite
 * @role          rct1-staging-preflight
 * @domain        economic-engine
 * @layer         script
 * @owner         backend-core
 * @purpose       Inventorier en lecture seule les commandes RCT1 et confirmer le périmètre simulation.
 * @impact-areas  staging-only, economic-engine, recette
 */
'use strict';

// RCT1 preflight: strictly read-only. No installation and no state transitions.
// target-guard.js MUST be called by the workflow before this script.
async function inspect({ db }) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const version = await client.query(
      "SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='simulation_scope') AS has_scope");
    if (!version.rows[0].has_scope) throw new Error('migration 303 absente : simulation_scope indisponible');
    const orders = await client.query(
      "SELECT reference, status::text AS status, simulation_scope, created_at FROM orders WHERE reference LIKE 'RCT1-%' OR simulation_scope = 'RCT1' ORDER BY created_at, reference LIMIT 200");
    const counts = await client.query(
      "SELECT COUNT(*)::int AS total, COUNT(*) FILTER(WHERE simulation_scope='RCT1')::int AS tagged, COUNT(*) FILTER(WHERE reference LIKE 'RCT1-%' AND simulation_scope IS DISTINCT FROM 'RCT1')::int AS untagged FROM orders WHERE reference LIKE 'RCT1-%' OR simulation_scope='RCT1'");
    const bad = orders.rows.filter(x => x.reference.startsWith('RCT1-') && x.simulation_scope !== 'RCT1');
    const out = {
      mode: 'READ_ONLY', scope: 'RCT1', migration_303: true,
      totals: counts.rows[0], orders: orders.rows,
      violations: bad.map(x => ({ reference: x.reference, reason: 'RCT1_SCOPE_MISSING' })),
      installation_confirmed: false,
      next: 'Installer seulement via les services canoniques après validation de ce rapport'
    };
    await client.query('ROLLBACK');
    return out;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
async function main() {
  const db = require('../../db');
  try {
    const report = await inspect({ db });
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    if (report.violations.length) process.exitCode = 2;
  } finally { await db.pool.end(); }
}
if (require.main === module) main().catch(e => { process.stderr.write('RCT1 PREFLIGHT REFUS: ' + e.message + '\n'); process.exitCode = 1; });
module.exports = { inspect };
