/**
 * @komerce-arch
 * @role          controlled-business-data-purge
 * @domain        infrastructure
 * @layer         script
 * @criticality   critical
 * @inputs        DATABASE_URL, explicit execute flag, explicit confirmation token
 * @outputs       dry-run/execute JSON report
 * @depends       db.js, scripts/recette/staging-reset-classification.js, scripts/recette/staging-reset-fixtures.js
 * @used-by       scripts/recette/staging-reset.js, operator one-shot job only
 * @db-read       pg_catalog, public business tables
 * @db-write      transient business tables, sourcing_sources.autopilot_enabled, fixture accounts (withFixtures)
 * @db-txn        owned
 * @doctrine      preserve_schema_migrations_reference_and_runtime_configuration
 * @impact-areas  database, sourcing, catalog, orders, payments, logistics
 * @version       2026-11
 */
'use strict';

const db = require('../db');
const classification = require('./recette/staging-reset-classification');
const fixtures = require('./recette/staging-reset-fixtures');

const CONFIRM_TOKEN = 'PURGE_BUSINESS_DATA_KEEP_FOUNDATION';

// Source unique : scripts/recette/staging-reset-classification.js (chaque table du schema y est classee).
// Racines = classe purge_root ; les enfants FK sont decouverts dans PostgreSQL et vides par TRUNCATE ... CASCADE,
// uniquement apres que la garde "fondation" ait prouve que la cascade ne peut pas la toucher.
// Les racines absentes du schema sont ignorees (voir listSchemaTablesStatic / test de derive).
const ROOT_CANDIDATES = classification.ROOTS_TRUNCATE;
const DELETE_ROOTS = classification.ROOTS_DELETE; // videes par DELETE (FK retour vers un registre protege)
const PROTECTED_TABLES = classification.PROTECTED; // foundation + fixture_scoped

const TRANSIENT_HINT_RE = /(order|purchase|supplier_execution|payment|refund|invoice|notification|parcel|scan|shipping|basket|cart|sourcing|catalog|product|incident|inventory|outbox|receipt|hub_|custody|cash_|settlement|signal)/i;

function quoteIdent(name) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`Unsafe identifier: ${name}`);
  return `"${name}"`;
}

function computeCascadeClosure(roots, edges) {
  const closure = new Set(roots);
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of edges) {
      if (closure.has(edge.referenced_table) && !closure.has(edge.referencing_table)) {
        closure.add(edge.referencing_table);
        changed = true;
      }
    }
  }
  return [...closure].sort();
}

function protectedHits(tables) {
  return tables.filter((table) => PROTECTED_TABLES.has(table)).sort();
}

async function listPublicTables(q = db) {
  const { rows } = await q.query(
    `SELECT tablename
       FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename`
  );
  return rows.map((row) => row.tablename);
}

async function foreignKeyEdges(q = db) {
  const { rows } = await q.query(
    `SELECT parent.relname AS referenced_table,
            child.relname AS referencing_table
       FROM pg_constraint c
       JOIN pg_class child ON child.oid = c.conrelid
       JOIN pg_class parent ON parent.oid = c.confrelid
       JOIN pg_namespace nchild ON nchild.oid = child.relnamespace
       JOIN pg_namespace nparent ON nparent.oid = parent.relnamespace
      WHERE c.contype = 'f'
        AND nchild.nspname = 'public'
        AND nparent.nspname = 'public'`
  );
  return rows;
}

async function countTables(tableNames, q = db) {
  const result = {};
  for (const table of tableNames) {
    const { rows: [row] } = await q.query(`SELECT COUNT(*)::bigint AS c FROM ${quoteIdent(table)}`);
    result[table] = Number(row.c);
  }
  return result;
}

function nonZeroEntries(counts) {
  return Object.fromEntries(Object.entries(counts).filter(([, count]) => Number(count) > 0));
}

async function buildPlan(q = db, { withFixtures = false, env = process.env } = {}) {
  const allTables = await listPublicTables(q);
  const existing = new Set(allTables);
  const roots = ROOT_CANDIDATES.filter((table) => existing.has(table));
  const deleteRoots = DELETE_ROOTS.filter((table) => existing.has(table));
  const edges = await foreignKeyEdges(q);
  const cascadeTables = computeCascadeClosure(roots, edges);
  const protectedCascadeHits = protectedHits(cascadeTables);

  // Garde anti-derive : toute table doit etre classee ; la fermeture FK doit coincider avec la classe purge_*.
  const { unclassified } = classification.diffAgainstSchema(allTables);
  const purgeClassed = allTables.filter((t) => classification.isPurgeClass(t) && !deleteRoots.includes(t));
  const classificationDrift = {
    unclassified_tables: unclassified,
    purge_class_outside_closure: purgeClassed.filter((t) => !cascadeTables.includes(t)),
    closure_outside_purge_class: cascadeTables.filter((t) => !classification.isPurgeClass(t)),
  };

  const protectedExisting = [...PROTECTED_TABLES].filter((table) => existing.has(table)).sort();
  const cascadeCounts = await countTables(cascadeTables, q);
  const deleteRootCounts = await countTables(deleteRoots, q);
  const protectedCounts = await countTables(protectedExisting, q);

  const hintedOutsideCascade = allTables
    .filter((table) => TRANSIENT_HINT_RE.test(table))
    .filter((table) => !cascadeTables.includes(table))
    .filter((table) => !PROTECTED_TABLES.has(table) && !deleteRoots.includes(table));
  const hintedOutsideCounts = await countTables(hintedOutsideCascade, q);

  const plan = {
    roots,
    delete_roots: deleteRoots,
    cascade_tables: cascadeTables,
    protected_cascade_hits: protectedCascadeHits,
    classification_drift: classificationDrift,
    before: nonZeroEntries({ ...cascadeCounts, ...deleteRootCounts }),
    protected_before: protectedCounts,
    nonzero_transient_hints_outside_plan: nonZeroEntries(hintedOutsideCounts),
    uncertain_foundation: classification.UNCERTAIN_FOUNDATION.filter((t) => existing.has(t)),
  };
  if (withFixtures) {
    const { _exec, ...report } = await fixtures.buildFixturePlan(q, { env, purgeTables: [...cascadeTables, ...deleteRoots] });
    plan.fixtures = report;
  }
  return plan;
}

function assertPlanSafe(plan, base) {
  const drift = plan.classification_drift;
  if (drift.unclassified_tables.length || drift.purge_class_outside_closure.length || drift.closure_outside_purge_class.length) {
    const error = new Error(`PURGE_ABORTED_CLASSIFICATION_DRIFT:${JSON.stringify(drift)}`);
    error.report = base;
    throw error;
  }
  if (plan.protected_cascade_hits.length) {
    const error = new Error(`PURGE_ABORTED_PROTECTED_CASCADE:${plan.protected_cascade_hits.join(',')}`);
    error.report = base;
    throw error;
  }
}

async function run({ execute = false, withFixtures = false, env = process.env, q = db } = {}) {
  const plan = await buildPlan(q, { withFixtures, env });
  const base = {
    mode: execute ? 'execute' : 'dry-run',
    runtime: env.KOMERCE_ENV || env.NODE_ENV || null,
    confirmation_required: CONFIRM_TOKEN,
    ...plan,
  };

  // Une cascade vers la fondation ou un schema non classe interdit meme un dry-run "vert".
  if (plan.protected_cascade_hits.length || plan.classification_drift.unclassified_tables.length) assertPlanSafe(plan, base);
  if (!execute) {
    if (env.KOMERCE_STAGING_RESET_SIMULATE === '1' && !(plan.fixtures && plan.fixtures.blockers.length)) {
      base.simulation = await simulatePurge(plan, { withFixtures, env });
    }
    return base;
  }
  assertPlanSafe(plan, base);
  if (String(env.KOMERCE_CONTROLLED_PURGE_CONFIRM || '') !== CONFIRM_TOKEN) {
    const error = new Error('PURGE_CONFIRMATION_TOKEN_MISSING');
    error.report = base;
    throw error;
  }
  if (!plan.roots.length) {
    const error = new Error('PURGE_NO_TARGET_TABLES_FOUND');
    error.report = base;
    throw error;
  }
  if (plan.fixtures && plan.fixtures.blockers.length) {
    const error = new Error(`FIXTURE_RETIREMENT_BLOCKED:${JSON.stringify(plan.fixtures.blockers)}`);
    error.report = base;
    throw error;
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const result = await applyPurge(client, plan, { withFixtures, env });
    await client.query('COMMIT');
    return { ...base, success: true, ...result };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Repetition generale OPT-IN (KOMERCE_STAGING_RESET_SIMULATE=1, dry-run uniquement) : joue exactement la purge dans une
 * transaction puis ROLLBACK, pour reveler les triggers/contraintes qui ne se voient pas dans un plan (ex. triggers append-only).
 * Prend brievement des verrous exclusifs sur les tables purgees : a ne lancer que hors activite.
 */
async function simulatePurge(plan, { withFixtures, env }) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const result = await applyPurge(client, plan, { withFixtures, env });
    return { ok: true, rolled_back: true, fixtures_deleted: result.fixtures_deleted };
  } catch (error) {
    return { ok: false, rolled_back: true, error: String(error.message).slice(0, 400) };
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
}

async function applyPurge(client, plan, { withFixtures, env }) {
  // Ne jamais bloquer l'environnement partage : echec franc si un verrou n'est pas obtenu.
  await client.query("SET LOCAL lock_timeout = '15s'");
  await client.query("SET LOCAL statement_timeout = '300s'");

  // Freeze acquisition before deleting its captures/candidates. Keep source
  // definitions so operators can deliberately re-enable one source afterwards.
  let sourcesDisabled = 0;
  if ((await listPublicTables(client)).includes('sourcing_sources')) {
    const disabled = await client.query(
      `UPDATE sourcing_sources
          SET autopilot_enabled = FALSE,
              updated_at = NOW()
        WHERE autopilot_enabled = TRUE`
    );
    sourcesDisabled = disabled.rowCount;
  }

  await client.query(
    `TRUNCATE TABLE ${plan.roots.map(quoteIdent).join(', ')} RESTART IDENTITY CASCADE`
  );

  // sourcing_sources.production_certified_capture_id points back to captures.
  // PostgreSQL TRUNCATE follows FK structure regardless of ON DELETE SET NULL,
  // so making sourcing_captures a TRUNCATE root would also truncate the
  // protected source registry. Its append-only children are already emptied
  // by the roots above; DELETE can now safely clear captures and lets the FK
  // null the certification pointer without touching sourcing_sources.
  for (const table of plan.delete_roots) {
    await client.query(`DELETE FROM ${quoteIdent(table)}`);
  }

  // Fixtures (comptes/relais/partenaires de test) : meme transaction, plan recalcule sur l'etat reel post-purge.
  let fixturesDeleted = {};
  if (withFixtures) {
    const fixturePlan = await fixtures.buildFixturePlan(client, { env, purgeTables: [...plan.cascade_tables, ...plan.delete_roots] });
    fixturesDeleted = await fixtures.retireFixtures(client, fixturePlan, { env });
  }

  // Fondation : lignes strictement inchangees. fixture_scoped : uniquement les suppressions planifiees.
  const protectedAfter = await countTables(Object.keys(plan.protected_before), client);
  const protectedChanged = Object.keys(plan.protected_before).filter((table) => {
    const expected = Number(plan.protected_before[table]) - Number(fixturesDeleted[table] || 0);
    return Number(protectedAfter[table]) !== expected;
  });
  if (protectedChanged.length) {
    throw new Error(`PURGE_PROTECTED_ROWCOUNT_CHANGED:${protectedChanged.join(',')}`);
  }

  const afterCounts = await countTables([...plan.cascade_tables, ...plan.delete_roots], client);
  const residual = nonZeroEntries(afterCounts);
  if (Object.keys(residual).length) {
    throw new Error(`PURGE_RESIDUAL_ROWS:${JSON.stringify(residual)}`);
  }

  return {
    sourcing_sources_disabled: sourcesDisabled,
    fixtures_deleted: fixturesDeleted,
    after: residual,
    protected_after: protectedAfter,
  };
}

if (require.main === module) {
  const execute = process.argv.includes('--execute');
  const withFixtures = process.argv.includes('--with-fixtures');
  run({ execute, withFixtures })
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
      process.exitCode = 0;
    })
    .catch((error) => {
      console.error(error.message);
      if (error.report) console.error(JSON.stringify(error.report, null, 2));
      process.exitCode = 1;
    })
    .finally(async () => {
      await db.pool.end().catch(() => {});
    });
}

module.exports = {
  CONFIRM_TOKEN,
  ROOT_CANDIDATES,
  DELETE_ROOTS,
  PROTECTED_TABLES,
  computeCascadeClosure,
  protectedHits,
  assertPlanSafe,
  buildPlan,
  run,
};
