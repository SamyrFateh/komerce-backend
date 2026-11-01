/**
 * @komerce-arch
 * @role          staging-verify-empty
 * @domain        infrastructure
 * @layer         script
 * @criticality   high
 * @inputs        DATABASE_URL
 * @outputs       rapport JSON de verification, code de sortie 1 si le Staging n'est pas dans l'etat "fondation propre"
 * @depends       db.js, config/market-delegation-capabilities.js, scripts/seed-reference-data.js, scripts/run-migrations.js, scripts/recette/staging-reset-classification.js, scripts/recette/staging-reset-fixtures.js
 * @used-by       scripts/recette/staging-reset.js, .github/workflows/staging-reset.yml
 * @db-read       toutes les tables du schema public (COUNT), referentiels, schema_migrations
 * @db-write      none
 * @db-txn        none
 * @doctrine      verify_after_reset_zero_rows_zero_fixture_reference_data_present_migrations_current
 * @impact-areas  database, staging, recette
 * @version       2026-11
 */
'use strict';

const db = require('../../db');
const classification = require('./staging-reset-classification');
const fixtures = require('./staging-reset-fixtures');
const { REFERENCE_MARKETS, FIXED_CURRENCY_PARITIES, OFFICIAL_FX_PEGS } = require('../seed-reference-data');
const { CAPABILITIES } = require('../../config/market-delegation-capabilities');
const { listMigrationFiles } = require('../run-migrations');

const ident = (n) => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(n)) throw new Error(`Unsafe identifier: ${n}`);
  return `"${n}"`;
};

async function verify(q = db, { env = process.env, migrationFiles = listMigrationFiles() } = {}) {
  const checks = [];
  const add = (id, ok, detail) => checks.push({ id, ok: Boolean(ok), detail });

  const { rows: tr } = await q.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`);
  const tables = tr.map((r) => r.tablename);
  const { unclassified } = classification.diffAgainstSchema(tables);
  add('classification_complete', unclassified.length === 0, unclassified);

  const nonEmpty = {};
  for (const t of tables.filter(classification.isPurgeClass)) {
    const { rows: [r] } = await q.query(`SELECT COUNT(*)::bigint AS c FROM ${ident(t)}`);
    if (Number(r.c) > 0) nonEmpty[t] = Number(r.c);
  }
  add('purge_tables_empty', Object.keys(nonEmpty).length === 0, nonEmpty);

  const plan = await fixtures.buildFixturePlan(q, { env, purgeTables: tables.filter(classification.isPurgeClass) });
  const residual = plan.summary.users + plan.summary.relais + plan.summary.partners;
  add('no_residual_fixture', residual === 0 && Object.keys(plan.would_delete).length === 0,
    { users: plan.summary.users, relais: plan.summary.relais, partners: plan.summary.partners, would_delete: plan.would_delete });
  const { rows: [adm] } = await q.query(`SELECT COUNT(*)::int AS c FROM users WHERE role::text = 'admin'`);
  add('admin_present', adm.c >= 1, { admins: adm.c });

  const { rows: mk } = await q.query(`SELECT code FROM markets`);
  const haveMk = new Set(mk.map((r) => r.code));
  const missingMk = REFERENCE_MARKETS.map((m) => m.code).filter((c) => !haveMk.has(c));
  add('markets_present', missingMk.length === 0, { expected: REFERENCE_MARKETS.length, missing: missingMk });
  const { rows: cp } = await q.query(`SELECT currency FROM currency_parities`);
  const haveCp = new Set(cp.map((r) => r.currency));
  add('currency_parities_present', FIXED_CURRENCY_PARITIES.every((p) => haveCp.has(p.currency)),
    { missing: FIXED_CURRENCY_PARITIES.map((p) => p.currency).filter((c) => !haveCp.has(c)) });
  const { rows: pg } = await q.query(`SELECT DISTINCT quote_ccy FROM fx_pegs`);
  const havePg = new Set(pg.map((r) => r.quote_ccy));
  add('fx_pegs_present', OFFICIAL_FX_PEGS.every((p) => havePg.has(p.quote_ccy)),
    { missing: OFFICIAL_FX_PEGS.map((p) => p.quote_ccy).filter((c) => !havePg.has(c)) });
  const { rows: [fc] } = await q.query(`SELECT COUNT(*)::int AS c FROM finance_config WHERE id = 1`);
  add('finance_config_present', fc.c === 1, { rows: fc.c });
  const { rows: [cap] } = await q.query(`SELECT COUNT(*)::int AS c FROM capability_registry`);
  add('capability_registry_present', cap.c >= CAPABILITIES.length, { rows: cap.c, expected_min: CAPABILITIES.length });

  const { rows: ap } = await q.query(`SELECT filename FROM schema_migrations`);
  const applied = new Set(ap.map((r) => r.filename));
  const pending = migrationFiles.filter((f) => !applied.has(f));
  add('migrations_current', pending.length === 0, { pending });

  return { ok: checks.every((c) => c.ok), checks, kept_unmatched_accounts: plan.summary.users_kept_unmatched.length };
}

async function main() {
  try {
    const report = await verify();
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.ok ? 0 : 1;
  } catch (error) {
    console.error(`STAGING_VERIFY_ERROR: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await db.pool.end().catch(() => {});
  }
}

if (require.main === module) main();

module.exports = { verify };
