#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          staging-clean-room-reset
 * @domain        sourcing
 * @layer         script
 * @criticality   high
 * @inputs        staging DATABASE_URL
 * @outputs       empty staging catalog + empty sourcing runtime data
 * @depends       db.js
 * @used-by       .github/workflows/staging-catalog-ops.yml
 * @db-read       products, sourcing runtime tables, orders
 * @db-write      products, sourcing runtime tables, orders, sourcing_sources certification evidence
 * @db-txn        yes
 * @doctrine      staging_only, no_seed, preserve_provider_configuration
 * @impact-areas  staging-catalog, staging-sourcing, staging-import-runtime
 * @version       2026-09-clean-room-v1
 */
'use strict';

const db = require('../db');

const RUNTIME_TABLES = Object.freeze([
  'import_runtime_item_events',
  'import_runtime_runs',
  'sourcing_candidate_events',
  'supplier_catalog_import_rejections',
  'sourcing_candidate_observations',
  'sourcing_candidates',
  'supplier_catalog_imports',
  'sourcing_observation_evidence',
  'sourcing_resolution_bindings',
  'sourcing_identity_constraints',
  'sourcing_resolution_decisions',
  'sourcing_match_proposals',
  'sourcing_canonical_entity_refs',
  'sourcing_source_principal_refs',
  'sourcing_observations',
  'sourcing_captures',
  'sourcing_canonical_entities',
  'sourcing_commercial_principals',
  'sourcing_provider_control_events',
  'catalog_stock_sync_state',
  'catalog_field_sync_state',
]);

const PRESERVED_CONFIGURATION = Object.freeze([
  'sourcing_sources',
  'sourcing_source_provides',
  'sourcing_source_execution_modes',
  'sourcing_merge_policies',
  'sourcing_global_access_grants',
  'supplier_oauth_connections',
  // Coffre des identifiants fournisseurs : jamais effacé par un reset (sinon les sources perdent leur connexion).
  'provider_credentials',
]);

function assertStaging() {
  if (String(process.env.KOMERCE_ENV || '').toLowerCase() !== 'staging') {
    throw new Error('REFUS: KOMERCE_ENV=staging requis');
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('REFUS: clean-room reset interdit avec NODE_ENV=production');
  }
  if (process.env.KOMERCE_ALLOW_CLEAN_ROOM_RESET !== '1') {
    throw new Error('KOMERCE_ALLOW_CLEAN_ROOM_RESET=1 requis');
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL requis');
}

async function relationExists(client, name) {
  const { rows: [row] } = await client.query(
    'SELECT to_regclass($1) IS NOT NULL AS ok',
    [`public.${name}`]
  );
  return Boolean(row?.ok);
}

async function countRows(client, table) {
  if (!(await relationExists(client, table))) return null;
  const { rows: [row] } = await client.query(`SELECT COUNT(*)::int AS count FROM ${table}`);
  return Number(row?.count || 0);
}

async function snapshot(client, tables) {
  const out = {};
  for (const table of tables) out[table] = await countRows(client, table);
  out.products = await countRows(client, 'products');
  out.orders = await countRows(client, 'orders');
  return out;
}

async function resetSequence(client, name) {
  if (await relationExists(client, name)) {
    await client.query(`ALTER SEQUENCE ${name} RESTART WITH 1`);
  }
}

async function reset() {
  assertStaging();
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const existingRuntimeTables = [];
    for (const table of RUNTIME_TABLES) {
      if (await relationExists(client, table)) existingRuntimeTables.push(table);
    }

    const before = await snapshot(client, existingRuntimeTables);
    const preservedBefore = await snapshot(client, PRESERVED_CONFIGURATION);

    if (await relationExists(client, 'orders')) {
      await client.query('TRUNCATE TABLE orders CASCADE');
    }
    for (const table of ['basket_items', 'baskets', 'recipients']) {
      if (await relationExists(client, table)) await client.query(`DELETE FROM ${table}`);
    }

    // Runtime certification is evidence-bound; old evidence must not survive the reset.
    if (await relationExists(client, 'sourcing_sources')) {
      await client.query(
        `UPDATE sourcing_sources
            SET production_certified_capture_id = NULL,
                production_certified_at = NULL
          WHERE production_certified_capture_id IS NOT NULL
             OR production_certified_at IS NOT NULL`
      );
    }

    // Do not CASCADE: sourcing_sources references sourcing_captures for certification
    // evidence. CASCADE would truncate the preserved provider configuration itself.
    const truncatableRuntimeTables = existingRuntimeTables.filter(
      table => table !== 'sourcing_captures'
    );
    if (truncatableRuntimeTables.length) {
      await client.query(
        `TRUNCATE TABLE ${truncatableRuntimeTables.join(', ')} RESTART IDENTITY`
      );
    }

    // Captures are deleted only after observations/resolution facts are gone.
    // DELETE follows the FK without touching the preserved sourcing_sources table.
    if (existingRuntimeTables.includes('sourcing_captures')) {
      await client.query('DELETE FROM sourcing_captures');
    }

    let deletedProducts = 0;
    if (await relationExists(client, 'products')) {
      const products = await client.query('DELETE FROM products RETURNING id');
      deletedProducts = products.rowCount;
    }

    await resetSequence(client, 'sourcing_candidate_ref_seq');
    await resetSequence(client, 'import_runtime_run_ref_seq');

    const after = await snapshot(client, existingRuntimeTables);
    const preservedAfter = await snapshot(client, PRESERVED_CONFIGURATION);

    const nonEmptyRuntime = Object.entries(after)
      .filter(([key, value]) => !['orders', 'products'].includes(key) && value !== null && value !== 0);

    if (after.products !== 0 || after.orders !== 0 || nonEmptyRuntime.length) {
      throw new Error(`Clean-room incomplet: ${JSON.stringify(after)}`);
    }

    for (const table of PRESERVED_CONFIGURATION) {
      if (preservedBefore[table] !== preservedAfter[table]) {
        throw new Error(
          `Configuration altérée: ${table} avant=${preservedBefore[table]} après=${preservedAfter[table]}`
        );
      }
    }

    await client.query('COMMIT');

    const result = {
      before,
      deleted_products: deletedProducts,
      after,
      preserved_configuration: preservedAfter,
      seed: false,
    };
    console.log(`[staging-clean-room-reset] ${JSON.stringify(result)}`);
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
      console.error('[staging-clean-room-reset] FAILED:', error.message);
      await db.pool.end().catch(() => {});
      process.exitCode = 1;
    });
}

module.exports = { assertStaging, reset, RUNTIME_TABLES, PRESERVED_CONFIGURATION };
