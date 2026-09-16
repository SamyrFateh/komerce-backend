/**
 * @komerce-arch
 * @role          controlled-business-data-purge
 * @domain        infrastructure
 * @layer         script
 * @criticality   critical
 * @inputs        DATABASE_URL, explicit execute flag, explicit confirmation token
 * @outputs       dry-run/execute JSON report
 * @depends       db.js
 * @used-by       operator one-shot job only
 * @db-read       pg_catalog, public business tables
 * @db-write      transient business tables, sourcing_sources.autopilot_enabled
 * @db-txn        owned
 * @doctrine      preserve_schema_migrations_reference_and_runtime_configuration
 * @impact-areas  database, sourcing, catalog, orders, payments, logistics
 * @version       2026-09
 */
'use strict';

const db = require('../db');

const CONFIRM_TOKEN = 'PURGE_BUSINESS_DATA_KEEP_FOUNDATION';

// Explicit business/transient roots only. Missing tables are ignored. FK children
// are discovered from PostgreSQL and included through TRUNCATE ... CASCADE, but
// only after the protected-table guard proves the cascade cannot touch foundation.
const ROOT_CANDIDATES = Object.freeze([
  'orders',
  'purchase_orders',
  'supplier_orders',
  'payments',
  'payment_attempts',
  'payment_events',
  'refunds',
  'invoices',
  'transaction_documents',
  'notification_log',
  'notifications',
  'sms_log',
  'parcels',
  'shipping_sessions',
  'scan_events',
  'customs_history',
  'inventory_items',
  'incidents',
  'outbox_events',
  'physical_outcome_receipts',
  'baskets',
  'recipients',
  'cart_shares',
  'shared_carts',
  'shared_cart_items',
  'shared_lists',
  'shared_list_items',
  'supplier_catalog_imports',
  'supplier_catalog_sync_checkpoints',
  'sourcing_candidates',
  'sourcing_captures',
  'sourcing_observations',
  'sourcing_candidate_events',
  'sourcing_resolutions',
  'sourcing_offers',
  'sourcing_canonical_entities',
  'sourcing_canonical_entity_refs',
  'sourcing_source_provides',
  'products',
]);

const PROTECTED_TABLES = Object.freeze(new Set([
  'schema_migrations',
  'migrations',
  'knex_migrations',
  'knex_migrations_lock',
  'markets',
  'relais',
  'partners',
  'users',
  'roles',
  'permissions',
  'finance_config',
  'economic_variables',
  'charges',
  'business_rules',
  'business_rules_history',
  'supplier_oauth_connections',
  'sourcing_sources',
  'market_delegations',
  'market_operator_delegations',
  'loyalty_tiers',
  'pricing_rules',
  'catalog_exclusions',
  'catalog_global_access_grants',
  'catalog_glossary',
  'sourcing_global_access_grants',
  'market_payment_providers',
]));

const TRANSIENT_HINT_RE = /(order|purchase|payment|refund|invoice|notification|parcel|scan|shipping|basket|cart|sourcing|catalog|product|incident|inventory|outbox|receipt)/i;

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

async function buildPlan(q = db) {
  const allTables = await listPublicTables(q);
  const existing = new Set(allTables);
  const roots = ROOT_CANDIDATES.filter((table) => existing.has(table));
  const edges = await foreignKeyEdges(q);
  const cascadeTables = computeCascadeClosure(roots, edges);
  const protectedCascadeHits = protectedHits(cascadeTables);

  const protectedExisting = [...PROTECTED_TABLES].filter((table) => existing.has(table)).sort();
  const cascadeCounts = await countTables(cascadeTables, q);
  const protectedCounts = await countTables(protectedExisting, q);

  const hintedOutsideCascade = allTables
    .filter((table) => TRANSIENT_HINT_RE.test(table))
    .filter((table) => !cascadeTables.includes(table))
    .filter((table) => !PROTECTED_TABLES.has(table));
  const hintedOutsideCounts = await countTables(hintedOutsideCascade, q);

  return {
    roots,
    cascade_tables: cascadeTables,
    protected_cascade_hits: protectedCascadeHits,
    before: nonZeroEntries(cascadeCounts),
    protected_before: protectedCounts,
    nonzero_transient_hints_outside_plan: nonZeroEntries(hintedOutsideCounts),
  };
}

async function run({ execute = false, env = process.env, q = db } = {}) {
  const plan = await buildPlan(q);
  const base = {
    mode: execute ? 'execute' : 'dry-run',
    runtime: env.KOMERCE_ENV || env.NODE_ENV || null,
    confirmation_required: CONFIRM_TOKEN,
    ...plan,
  };

  if (plan.protected_cascade_hits.length) {
    const error = new Error(`PURGE_ABORTED_PROTECTED_CASCADE:${plan.protected_cascade_hits.join(',')}`);
    error.report = base;
    throw error;
  }

  if (!execute) return base;
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

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

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

    const protectedAfter = await countTables(Object.keys(plan.protected_before), client);
    const protectedChanged = Object.keys(plan.protected_before).filter(
      (table) => Number(protectedAfter[table]) !== Number(plan.protected_before[table])
    );
    if (protectedChanged.length) {
      throw new Error(`PURGE_PROTECTED_ROWCOUNT_CHANGED:${protectedChanged.join(',')}`);
    }

    const afterCounts = await countTables(plan.cascade_tables, client);
    const residual = nonZeroEntries(afterCounts);
    if (Object.keys(residual).length) {
      throw new Error(`PURGE_RESIDUAL_ROWS:${JSON.stringify(residual)}`);
    }

    await client.query('COMMIT');
    return {
      ...base,
      success: true,
      sourcing_sources_disabled: sourcesDisabled,
      after: residual,
      protected_after: protectedAfter,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  const execute = process.argv.includes('--execute');
  run({ execute })
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
  PROTECTED_TABLES,
  computeCascadeClosure,
  protectedHits,
  buildPlan,
  run,
};
