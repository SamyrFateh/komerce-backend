/**
 * @komerce-arch
 * @role          staging-reset-entrypoint
 * @domain        infrastructure
 * @layer         script
 * @criticality   critical
 * @inputs        --dry-run | --execute ; DATABASE_URL, KOMERCE_ENV=staging, STAGING_BASE_URL, EXPECTED_RAILWAY_ENVIRONMENT, KOMERCE_STAGING_RESET_DB_PIN, KOMERCE_CONTROLLED_PURGE_CONFIRM, KOMERCE_STAGING_RESET_ACK
 * @outputs       rapport JSON (tables videes et volumes, fixtures retirees, referentiels, verification)
 * @depends       db.js, scripts/controlled-business-purge.js, scripts/recette/target-guard.js, scripts/recette/staging-verify-empty.js, scripts/seed-reference-data.js
 * @used-by       .github/workflows/staging-reset.yml
 * @db-read       pg_catalog, tables du schema public, referentiels
 * @db-write      tables purge_* (TRUNCATE), fixtures (DELETE cible), referentiels (seed idempotent)
 * @db-txn        owned (purge+fixtures en une transaction ; seed en transaction separee)
 * @doctrine      single_staging_reset_entrypoint_guard_before_any_write_dry_run_default_two_secrets_to_execute
 * @impact-areas  database, staging, recette
 * @version       2026-11
 */
'use strict';

const db = require('../../db');
const purge = require('../controlled-business-purge');
const { confirmTarget } = require('./target-guard');
const { verify } = require('./staging-verify-empty');
const { seedReferenceData } = require('../seed-reference-data');
const { resetScope } = require('./staging-reset-classification');

const ACK_VALUE = 'RESET-STAGING-BUSINESS-DATA';
const REFERENCE_TABLES = Object.freeze(['markets', 'currency_parities', 'fx_pegs', 'capability_registry', 'ceiling_templates', 'ceiling_template_capabilities', 'finance_config']);

class ResetRefusal extends Error {
  constructor(code, detail) {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
  }
}

/** Epingle non secrete de la base : host:port/nom (jamais d'identifiants). */
function databasePin(databaseUrl) {
  try {
    const u = new URL(databaseUrl);
    return `${u.hostname}:${u.port || '5432'}${u.pathname}`;
  } catch {
    return null;
  }
}

/** Gardes PURES, evaluees avant toute connexion et avant toute ecriture. */
function assertResetAllowed(mode, env = process.env) {
  if (!['dry-run', 'execute'].includes(mode)) throw new ResetRefusal('STAGING_RESET_MODE_REQUIRED', 'passer exactement --dry-run ou --execute');
  if (env.NODE_ENV === 'production' || env.KOMERCE_ENV === 'production') throw new ResetRefusal('STAGING_RESET_REFUSED_PRODUCTION');
  if (env.KOMERCE_ENV !== 'staging') throw new ResetRefusal('STAGING_RESET_REFUSED_NOT_STAGING', 'KOMERCE_ENV=staging requis');
  if (!env.DATABASE_URL) throw new ResetRefusal('STAGING_RESET_DATABASE_URL_MISSING');
  if (!/^https:\/\//.test(String(env.STAGING_BASE_URL || ''))) throw new ResetRefusal('STAGING_RESET_REFUSED_BASE_URL', 'STAGING_BASE_URL https requis');
  if (env.EXPECTED_RAILWAY_ENVIRONMENT !== 'staging') throw new ResetRefusal('STAGING_RESET_REFUSED_ENV_PIN', 'EXPECTED_RAILWAY_ENVIRONMENT=staging requis');
  const pin = databasePin(env.DATABASE_URL);
  if (!pin || env.KOMERCE_STAGING_RESET_DB_PIN !== pin) {
    throw new ResetRefusal('STAGING_RESET_DATABASE_NOT_PINNED', 'KOMERCE_STAGING_RESET_DB_PIN doit egaler host:port/base de DATABASE_URL');
  }
  try { resetScope(env); } catch (e) { throw new ResetRefusal('STAGING_RESET_SCOPE_INVALID', 'KOMERCE_STAGING_RESET_MODE doit valoir prudent (defaut) ou full'); }
  if (mode === 'execute') {
    if (env.KOMERCE_STAGING_RESET_ACK !== ACK_VALUE) throw new ResetRefusal('STAGING_RESET_ACK_MISSING', `KOMERCE_STAGING_RESET_ACK=${ACK_VALUE}`);
    if (env.KOMERCE_CONTROLLED_PURGE_CONFIRM !== purge.CONFIRM_TOKEN) throw new ResetRefusal('STAGING_RESET_PURGE_TOKEN_MISSING', 'KOMERCE_CONTROLLED_PURGE_CONFIRM');
  }
}

const REFERENCE_KEYS = Object.freeze({
  markets: ['code'], currency_parities: ['currency'], fx_pegs: ['quote_ccy', 'valid_from'], capability_registry: ['capability'],
  ceiling_templates: ['name', 'version'], ceiling_template_capabilities: ['template_id', 'capability'], finance_config: ['id'],
});
const VOLATILE = new Set(['updated_at', 'created_at', 'applied_at']);

async function snapshotReference(q) {
  const out = {};
  for (const t of REFERENCE_TABLES) {
    const { rows } = await q.query(`SELECT to_jsonb(t) AS r FROM "${t}" t`);
    out[t] = rows.map((r) => Object.fromEntries(Object.entries(r.r).filter(([k]) => !VOLATILE.has(k))));
  }
  return out;
}

/** Diff exact staging -> seed par ligne et colonne, mesure dans une transaction ANNULEE. */
function diffReference(before, after) {
  const drift = {};
  for (const t of REFERENCE_TABLES) {
    const keyCols = REFERENCE_KEYS[t];
    const k = (row) => keyCols.map((c) => String(row[c])).join('|');
    const b = new Map(before[t].map((r) => [k(r), r]));
    const a = new Map(after[t].map((r) => [k(r), r]));
    const diffs = [];
    for (const [key, row] of a) {
      const old = b.get(key);
      if (!old) { diffs.push({ key, change: 'added_by_seed', seed_row: row }); continue; }
      for (const col of Object.keys(row)) {
        if (JSON.stringify(old[col]) !== JSON.stringify(row[col])) diffs.push({ key, column: col, staging: old[col], seed: row[col], change: 'overwritten_by_seed' });
      }
    }
    for (const [key, row] of b) if (!a.has(key)) diffs.push({ key, change: 'removed', staging_row: row });
    if (diffs.length) {
      drift[t] = {
        rows_before: before[t].length, rows_after: after[t].length,
        changed_or_removed: diffs.filter((d) => d.change !== 'added_by_seed').length,
        new_or_changed_values: diffs.length, diffs,
      };
    }
  }
  return drift;
}

async function seedDrift(deps) {
  const client = await deps.db.getClient();
  try {
    await client.query('BEGIN');
    const before = await snapshotReference(client);
    await deps.seed(client);
    const after = await snapshotReference(client);
    return diffReference(before, after);
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
}

/** Decompte livemode des webhooks Stripe traites si l'information est stockee (colonne ou payload_summary). */
async function stripeLivemode(q) {
  const { rows: cols } = await q.query(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='stripe_events_processed'`);
  const names = cols.map((c) => c.column_name);
  const { rows: [tot] } = await q.query('SELECT COUNT(*)::int AS n FROM stripe_events_processed');
  const out = { total: tot.n, columns: names };
  if (names.includes('livemode')) {
    const { rows } = await q.query('SELECT livemode::text AS livemode, COUNT(*)::int AS n FROM stripe_events_processed GROUP BY 1');
    return { ...out, stored: 'column', by_livemode: Object.fromEntries(rows.map((r) => [r.livemode, r.n])) };
  }
  const payload = cols.find((c) => c.column_name === 'payload_summary');
  if (payload && ['jsonb', 'json'].includes(payload.data_type)) {
    const { rows } = await q.query(
      `SELECT COALESCE(payload_summary::jsonb ->> 'livemode', 'absent') AS livemode, COUNT(*)::int AS n FROM stripe_events_processed GROUP BY 1`);
    const by = Object.fromEntries(rows.map((r) => [r.livemode, r.n]));
    return { ...out, stored: Object.keys(by).every((k) => k === 'absent') ? 'not_stored' : 'payload_summary', by_livemode: by };
  }
  return { ...out, stored: 'not_stored', by_livemode: null };
}

async function runReset(mode, { env = process.env, deps = {} } = {}) {
  const d = {
    db, purge, confirmTarget, verify, seed: seedReferenceData,
    ...deps,
  };
  assertResetAllowed(mode, env);
  const execute = mode === 'execute';

  const target = await d.confirmTarget({ db: d.db, env });
  if (!target || target.confirmed !== true) throw new ResetRefusal('STAGING_RESET_TARGET_NOT_CONFIRMED');

  // Derive des referentiels : le seed ne doit rien ECRASER de different sur un Staging deja configure.
  const drift = await seedDrift(d);
  const driftOnExisting = Object.entries(drift).filter(([, v]) => v.changed_or_removed > 0).map(([t]) => t);
  if (execute && driftOnExisting.length && env.KOMERCE_STAGING_RESET_ALLOW_REFERENCE_DRIFT !== '1') {
    const err = new ResetRefusal('STAGING_RESET_REFERENCE_DRIFT', `le seed modifierait des referentiels existants: ${driftOnExisting.join(',')} (KOMERCE_STAGING_RESET_ALLOW_REFERENCE_DRIFT=1 pour converger)`);
    err.report = { mode, reference_drift: drift };
    throw err;
  }

  let stripeBefore;
  try { stripeBefore = await stripeLivemode(d.db); } catch (e) { stripeBefore = { stored: 'unavailable', error: String(e.message).slice(0, 120) }; }
  const purgeReport = await d.purge.run({ execute, withFixtures: true, env, q: d.db });
  const report = {
    mode,
    target: { confirmed: true, fingerprint: target.fingerprint || null },
    tables_emptied: purgeReport.before,
    delete_roots: purgeReport.delete_roots,
    purge_tables_total: purgeReport.cascade_tables.length + purgeReport.delete_roots.length,
    fixtures: purgeReport.fixtures,
    fixtures_deleted: purgeReport.fixtures_deleted || {},
    foundation_rows_before: purgeReport.protected_before,
    uncertain_foundation: purgeReport.uncertain_foundation,
    reference_drift: drift,
    scope: resetScope(env),
    rows_to_purge_total: Object.values(purgeReport.before || {}).reduce((n, v) => n + Number(v), 0),
    stripe_events_processed: stripeBefore,
    simulation: purgeReport.simulation || null,
    sourcing_sources_disabled: purgeReport.sourcing_sources_disabled || 0,
  };

  if (!execute) {
    report.status = 'DRY_RUN_OK';
    report.fixture_blockers = (purgeReport.fixtures && purgeReport.fixtures.blockers) || [];
    if (report.fixture_blockers.length || (report.simulation && !report.simulation.ok)) report.status = 'DRY_RUN_BLOCKED';
    return report;
  }

  // Le seed est idempotent mais rafraichit updated_at : on ne le rejoue que si les referentiels divergent ou manquent.
  if (Object.keys(drift).length) {
    const client = await d.db.getClient();
    try {
      await client.query('BEGIN');
      report.reference_seeded = await d.seed(client);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  } else report.reference_seeded = 'skipped_already_canonical';

  report.verify = await d.verify(d.db, { env });
  report.status = report.verify.ok ? 'RESET_OK' : 'RESET_VERIFY_FAILED';
  return report;
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const modes = ['--dry-run', '--execute'].filter((f) => argv.includes(f));
  let code = 1;
  try {
    if (modes.length !== 1) throw new ResetRefusal('STAGING_RESET_MODE_REQUIRED', 'passer exactement --dry-run ou --execute');
    const report = await runReset(modes[0].slice(2), { env });
    console.log(JSON.stringify(report, null, 2));
    code = ['DRY_RUN_OK', 'RESET_OK'].includes(report.status) ? 0 : 1;
  } catch (error) {
    console.error(`REFUS: ${error.message}`);
    if (error.report) console.error(JSON.stringify(error.report, null, 2));
  } finally {
    await db.pool.end().catch(() => {});
  }
  process.exitCode = code;
}

if (require.main === module) main();

module.exports = { REFERENCE_TABLES, diffReference, stripeLivemode, ACK_VALUE, ResetRefusal, databasePin, assertResetAllowed, seedDrift, runReset, main };
