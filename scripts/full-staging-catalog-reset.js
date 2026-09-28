#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          staging-clean-room-reset
 * @domain        catalog,sourcing
 * @layer         script
 * @criticality   high
 * @inputs        staging DATABASE_URL
 * @outputs       empty staging operational catalogue+sourcing pipeline
 * @depends       db.js
 * @used-by       .github/workflows/staging-catalog-ops.yml
 * @db-read       products, orders, supplier_catalog_imports, sourcing_*
 * @db-write      products, orders, supplier_catalog_imports, sourcing_*
 * @db-txn        yes
 * @doctrine      staging_only, clean_room_e2e, preserve_configuration_not_test_data
 * @impact-areas  staging-catalog, staging-orders, sourcing, certification, import-runtime
 * @version       2026-09-v2
 */
'use strict';

const db = require('../db');

const ROOT_TABLES = Object.freeze([
  'orders',
  'products',
  'supplier_catalog_imports',
  'import_runtime_runs',
  'sourcing_captures',
  'sourcing_commercial_principals',
]);

const ZERO_TABLES = Object.freeze([
  'orders',
  'products',
  'supplier_catalog_imports',
  'sourcing_candidates',
  'sourcing_candidate_events',
  'import_runtime_runs',
  'sourcing_captures',
  'sourcing_observations',
  'sourcing_observation_evidence',
  'sourcing_commercial_principals',
  'sourcing_source_principal_refs',
  'sourcing_canonical_entities',
  'sourcing_canonical_entity_refs',
  'sourcing_match_proposals',
  'sourcing_resolution_decisions',
  'sourcing_resolution_bindings',
  'sourcing_identity_constraints',
]);

const PRESERVE_TABLES = Object.freeze([
  'sourcing_sources',
  'sourcing_source_provides',
  'sourcing_source_execution_modes',
  'sourcing_merge_policies',
  'sourcing_global_access_grants',
]);

const RESET_SEQUENCES = Object.freeze([
  'product_ref_seq',
  'catalog_import_ref_seq',
  'sourcing_candidate_ref_seq',
  'import_runtime_run_ref_seq',
]);

function assertStaging() {
  if (String(process.env.KOMERCE_ENV || '').toLowerCase() !== 'staging') {
    throw new Error('REFUS: KOMERCE_ENV=staging requis');
  }
  if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
    throw new Error('REFUS: clean-room reset interdit avec NODE_ENV=production');
  }
  if (process.env.KOMERCE_ALLOW_FULL_CATALOG_RESET !== '1') {
    throw new Error('KOMERCE_ALLOW_FULL_CATALOG_RESET=1 requis');
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL requis');
}

async function objectExists(client, kind, name) {
  const fn = kind === 'sequence' ? 'to_regclass' : 'to_regclass';
  const { rows: [row] } = await client.query(
    `SELECT ${fn}($1) IS NOT NULL AS ok`,
    [`public.${name}`]
  );
  return Boolean(row?.ok);
}

async function requireObjects(client) {
  for (const table of [...ROOT_TABLES, ...ZERO_TABLES, ...PRESERVE_TABLES]) {
    if (!(await objectExists(client, 'table', table))) {
      throw new Error(`REFUS: table staging requise absente: ${table}`);
    }
  }
  for (const sequence of RESET_SEQUENCES) {
    if (!(await objectExists(client, 'sequence', sequence))) {
      throw new Error(`REFUS: séquence staging requise absente: ${sequence}`);
    }
  }
}

async function counts(client, tables) {
  const result = {};
  for (const table of tables) {
    const { rows: [row] } = await client.query(`SELECT COUNT(*)::int AS count FROM ${table}`);
    result[table] = row.count;
  }
  return result;
}

async function resetSequences(client) {
  for (const sequence of RESET_SEQUENCES) {
    await client.query('SELECT setval($1::regclass, 1, false)', [sequence]);
  }
}

async function reset() {
  assertStaging();
  const client = await db.getClient();

  try {
    await client.query('BEGIN');
    await requireObjects(client);

    const before = {
      operational: await counts(client, ZERO_TABLES),
      preserved: await counts(client, PRESERVE_TABLES),
    };

    // Clean-room staging reset:
    // - root business/test data are truncated,
    // - CASCADE removes all dependent operational projections,
    // - configuration/authority tables are intentionally not roots.
    //
    // TRUNCATE is required because observation/resolution audit tables are
    // append-only and correctly reject DELETE mutations.
    await client.query(
      `TRUNCATE TABLE ${ROOT_TABLES.join(', ')} RESTART IDENTITY CASCADE`
    );

    // Business-reference sequences are standalone sequences, not necessarily
    // OWNED BY the tables above; reset them explicitly for a readable clean run.
    await resetSequences(client);

    const after = {
      operational: await counts(client, ZERO_TABLES),
      preserved: await counts(client, PRESERVE_TABLES),
    };

    const residual = Object.entries(after.operational).filter(([, count]) => count !== 0);
    if (residual.length) {
      throw new Error(`Reset incomplet: ${JSON.stringify(Object.fromEntries(residual))}`);
    }

    for (const table of PRESERVE_TABLES) {
      if (after.preserved[table] !== before.preserved[table]) {
        throw new Error(
          `Configuration altérée: ${table} avant=${before.preserved[table]} après=${after.preserved[table]}`
        );
      }
    }

    await client.query('COMMIT');

    const result = {
      mode: 'CLEAN_ROOM',
      before,
      after,
      reset_sequences: RESET_SEQUENCES,
      invariant: 'operational_zero_configuration_preserved',
    };
    console.log(`[full-staging-catalog-reset] ${JSON.stringify(result)}`);
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  reset()
    .then(() => db.pool.end().catch(() => {}))
    .catch(async (error) => {
      console.error('[full-staging-catalog-reset] FAILED:', error.message);
      await db.pool.end().catch(() => {});
      process.exitCode = 1;
    });
}

module.exports = {
  ROOT_TABLES,
  ZERO_TABLES,
  PRESERVE_TABLES,
  RESET_SEQUENCES,
  assertStaging,
  reset,
};
