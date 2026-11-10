#!/usr/bin/env node
/**
 * @komerce-arch-lite
 * @role hub-v1-staging-run-census
 * @domain logistics
 * @layer script
 * @owner backend-core
 * @purpose Retrouver les RUN8 effectivement présents sur Railway staging, y compris ceux dont les commandes ont été retirées. Diagnostic sans suppression.
 * @db-read orders, users, relais, suppliers, products, hub_physical_units, international_shipments, customs_shipments, sourcing_candidates, pg_catalog
 * @db-write none
 * @db-txn REPEATABLE READ READ ONLY
 */
'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../../db');
const { confirmTarget } = require('./target-guard');
const { buildCleanupInventory } = require('./hub-v1-fixture-dependency-inventory');
const BASE = 'https://komerce-backend-production.up.railway.app';
const RUN8 = /^[A-F0-9]{8}$/;
const MAX_RUNS = 40;

// All selectors are static; no user-supplied SQL identifiers, UUIDs or emails.
// Include the non-order roots to detect partial cleanup and orphaned fixtures.
const MARKERS = Object.freeze([
  ['orders', "SELECT substring(reference FROM '^E2E-HUB-V1-([A-F0-9]{8})-') AS run8, COUNT(*)::int AS n FROM orders WHERE reference ~ '^E2E-HUB-V1-[A-F0-9]{8}-(KOM-101|KOM-102|KOM-103|LOCAL)$' GROUP BY 1"],
  ['users', "SELECT upper(substring(lower(email) FROM '^e2e-hub-v1-([a-f0-9]{8})(-|@)')) AS run8, COUNT(*)::int AS n FROM users WHERE lower(email) ~ '^e2e-hub-v1-[a-f0-9]{8}(-|@)' GROUP BY 1"],
  ['relais', "SELECT substring(name FROM '^E2E-HUB-V1-([A-F0-9]{8})-') AS run8, COUNT(*)::int AS n FROM relais WHERE name ~ '^E2E-HUB-V1-[A-F0-9]{8}-RELAIS$' GROUP BY 1"],
  ['products', "SELECT substring(product_ref FROM '^E2E-HUB-V1-([A-F0-9]{8})-') AS run8, COUNT(*)::int AS n FROM products WHERE product_ref ~ '^E2E-HUB-V1-[A-F0-9]{8}-' GROUP BY 1"],
  ['suppliers', "SELECT substring(name FROM '^E2E-HUB-V1-([A-F0-9]{8})-') AS run8, COUNT(*)::int AS n FROM suppliers WHERE name ~ '^E2E-HUB-V1-[A-F0-9]{8}-SUP-' GROUP BY 1"],
  ['hub_physical_units', "SELECT substring(reference FROM '^E2E-HUB-V1-([A-F0-9]{8})-') AS run8, COUNT(*)::int AS n FROM hub_physical_units WHERE reference ~ '^E2E-HUB-V1-[A-F0-9]{8}-' GROUP BY 1"],
  ['international_shipments', "SELECT substring(reference FROM '^E2E-HUB-V1-([A-F0-9]{8})-') AS run8, COUNT(*)::int AS n FROM international_shipments WHERE reference ~ '^E2E-HUB-V1-[A-F0-9]{8}-' GROUP BY 1"],
  ['customs_shipments', "SELECT substring(reference FROM '^E2E-HUB-V1-([A-F0-9]{8})-') AS run8, COUNT(*)::int AS n FROM customs_shipments WHERE reference ~ '^E2E-HUB-V1-[A-F0-9]{8}-' GROUP BY 1"],
  ['sourcing_candidates', "SELECT substring(supplier_name FROM '^E2E-HUB-V1-([A-F0-9]{8})$') AS run8, COUNT(*)::int AS n FROM sourcing_candidates WHERE supplier_name ~ '^E2E-HUB-V1-[A-F0-9]{8}$' GROUP BY 1"],
]);

function groupMarkers(rows) {
  const grouped = new Map();
  for (const row of rows) {
    if (!RUN8.test(String(row.run8 || '')) ||
        !MARKERS.some(([source]) => source === row.source) ||
        !Number.isSafeInteger(Number(row.n)) || Number(row.n) < 1)
      throw Error('HUB_V1_CENSUS_UNTRUSTED_MARKER');
    if (!grouped.has(row.run8)) grouped.set(row.run8, {});
    const bySource = grouped.get(row.run8);
    if (bySource[row.source] != null) throw Error('HUB_V1_CENSUS_DUPLICATE_MARKER');
    bySource[row.source] = Number(row.n);
  }
  if (grouped.size > MAX_RUNS) throw Error('HUB_V1_CENSUS_RUN_LIMIT');
  return [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([run8, sources]) => ({ run8, sources }));
}

async function listMarkers(client) {
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    const rows = [];
    for (const [source, sql] of MARKERS) {
      const result = await client.query(sql);
      rows.push(...result.rows.map((row) => ({ ...row, source })));
    }
    return groupMarkers(rows);
  } finally {
    await client.query('ROLLBACK');
  }
}

function assertEnvironment(env) {
  if (env.KOMERCE_ENV !== 'staging' || env.KOMERCE_TARGET_ENV !== 'staging' ||
      env.NODE_ENV !== 'test' || env.EXPECTED_RAILWAY_ENVIRONMENT !== 'staging' ||
      env.STAGING_BASE_URL !== BASE)
    throw Error('HUB_V1_RUN_CENSUS_STAGING_ONLY');
  if (!/^[a-f0-9]{40}$/i.test(String(env.E2E_EXPECTED_DEPLOY_SHA || '')))
    throw Error('HUB_V1_RUN_CENSUS_DEPLOY_PIN_REQUIRED');
}

async function run({ database = db, env = process.env, fetchImpl = fetch } = {}) {
  assertEnvironment(env);
  const target = await confirmTarget({ db: database, fetchImpl, env });
  if (!target?.confirmed) throw Error('HUB_V1_RUN_CENSUS_DB_PIN_MISMATCH');
  const response = await fetchImpl(BASE + '/health/version');
  if (!response.ok) throw Error('HUB_V1_RUN_CENSUS_RUNTIME_UNAVAILABLE');
  const version = await response.json();
  const sha = String(version.commit || version.sha || '');
  if (sha.toLowerCase() !== env.E2E_EXPECTED_DEPLOY_SHA.toLowerCase())
    throw Error('HUB_V1_RUN_CENSUS_SHA_DRIFT');
  const client = await database.getClient();
  try {
    const markers = await listMarkers(client);
    const runs = [];
    for (const marker of markers) {
      // Each existing inventory runs in its own atomic READ ONLY PG snapshot.
      // A missing order does not make related product/relay/user roots safe to delete.
      const inv = await buildCleanupInventory(client, marker.run8);
      runs.push({
        run8: marker.run8,
        observed_sources: marker.sources,
        orders: inv.roots.length,
        missing_orders: inv.missing.length,
        verdict: inv.verdict,
        owned_non_order_rows: inv.owned_roots_outside_fk_graph
          .filter((x) => x.count).map(({ table, count }) => ({ table, count })),
        opaque_dependencies: inv.opaque_dependencies.length,
        external_fixture_consumers: inv.external_fixture_consumers,
        immutable_proof_tables: inv.cleanup_strategy.immutable_tables,
        snapshot_sha256: inv.snapshot_sha256,
        delete_performed: false,
        cleanup_certified: false,
      });
    }
    return {
      schema: 'komerce-hub-v1-staging-run-census/1',
      mode: 'READ_ONLY',
      runtime_sha: sha,
      run_count: runs.length,
      verdict: 'INVENTORY_ONLY_NO_CLEANUP_CERTIFICATION',
      runs,
      delete_performed: false,
      cleanup_certified: false,
    };
  } finally { client.release(); }
}

async function main() {
  try {
    const result = await run();
    const dir = path.join('test-results', 'hub-v1-cert');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'staging-run-census.json');
    fs.writeFileSync(file, JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify({
      verdict: result.verdict, run_count: result.run_count,
      runs: result.runs.map((x) => ({
        run8: x.run8, orders: x.orders, verdict: x.verdict,
        non_order_count: x.owned_non_order_rows.reduce((n, t) => n + t.count, 0),
      })),
      delete_performed: false, cleanup_certified: false, file,
    }));
  } finally { if (db.pool?.end) await db.pool.end(); }
}

if (require.main === module) main().catch((error) => {
  console.error('HUB_V1_RUN_CENSUS_REFUSED:' + String(error.code || error.message).slice(0, 150));
  process.exitCode = 2;
});

module.exports = { MARKERS, groupMarkers, listMarkers, assertEnvironment, run };
