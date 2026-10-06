#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          cm-cg-full-market-reset
 * @domain        market
 * @layer         tooling
 * @criticality   critical
 * @inputs        DATABASE_URL, KOMERCE_ENV=staging, --dry-run|--execute, KOMERCE_MARKET_FULL_RESET_ACK=DELETE-CG-CM
 * @outputs       CG/CM removed from markets after all directly-related staging data is purged
 * @depends       db.js
 * @used-by       explicit Market Control Plane end-to-end creation certification
 * @db-read       pg_constraint, pg_class, pg_namespace, pg_attribute, markets, orders, mobile_money_transactions, market_settlements
 * @db-write      all tables with a direct FK to markets(id), markets
 * @db-txn        all mutations in one PostgreSQL transaction
 * @doctrine      staging_only, explicit_destructive_reset, preserve_no_business_history, recreate_through_canonical_process
 * @impact-areas  market, market-control-plane, market-delegation
 * @version       2026-10-v1
 */
'use strict';

const db = require('../db');

const TARGET_CODES = Object.freeze(['CG', 'CM']);
const ACK = 'DELETE-CG-CM';
const LOCK_NAMESPACE = 'komerce';
const LOCK_KEY = 'cm-cg-full-market-reset';

// These are business facts that must never be erased merely to make a clean test.
const PROTECTED_TABLES = new Set([
  'orders',
  'mobile_money_transactions',
  'market_settlements',
  'economic_structure_cost_events',
  'economic_risk_cost_events',
  'pricing_market_decision_policy_events',
  'pricing_maturity_disposition_events',
  'market_cost_attributions',
  'cash_confirmation_controls',
  'customs_shipments',
  'hub_physical_allocations',
  'signals',
]);

function modeFromArgv(argv = process.argv.slice(2)) {
  const execute = argv.includes('--execute');
  const dryRun = argv.includes('--dry-run');
  if (execute && dryRun) throw new Error('Choisir soit --dry-run soit --execute');
  return execute ? 'execute' : 'dry-run';
}

function assertRuntime(mode, env = process.env) {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL requis');
  if (mode === 'execute') {
    if (String(env.KOMERCE_ENV || '').trim().toLowerCase() !== 'staging') {
      throw new Error('REFUS: KOMERCE_ENV=staging requis pour --execute');
    }
    if (String(env.KOMERCE_MARKET_FULL_RESET_ACK || '') !== ACK) {
      throw new Error(`REFUS: KOMERCE_MARKET_FULL_RESET_ACK=${ACK} requis pour --execute`);
    }
  }
}

function quoteIdent(value) {
  return '"' + String(value).replace(/"/g, '""') + '"';
}

async function loadMarkets(queryable = db) {
  const { rows } = await queryable.query(
    `SELECT id,code,name,currency,is_active,lifecycle_status
       FROM markets
      WHERE code=ANY($1::text[])
      ORDER BY code`,
    [TARGET_CODES]
  );
  if (rows.length !== TARGET_CODES.length) {
    throw new Error(`REFUS: CG et CM doivent exister exactement une fois avant reset (trouvé ${rows.length})`);
  }
  return rows;
}

async function marketForeignKeys(queryable = db) {
  const { rows } = await queryable.query(
    `SELECT
       ns.nspname AS schema_name,
       rel.relname AS table_name,
       att.attname AS column_name,
       con.confdeltype AS delete_action
     FROM pg_constraint con
     JOIN pg_class rel ON rel.oid=con.conrelid
     JOIN pg_namespace ns ON ns.oid=rel.relnamespace
     JOIN pg_class ref ON ref.oid=con.confrelid
     JOIN pg_namespace refns ON refns.oid=ref.relnamespace
     JOIN pg_attribute att
       ON att.attrelid=con.conrelid
      AND att.attnum=con.conkey[1]
    WHERE con.contype='f'
      AND ref.relname='markets'
      AND refns.nspname='public'
      AND array_length(con.conkey,1)=1
      AND array_length(con.confkey,1)=1
    ORDER BY ns.nspname, rel.relname, att.attname`
  );
  return rows;
}

async function referenceCounts(queryable, marketIds) {
  const refs = [];
  for (const fk of await marketForeignKeys(queryable)) {
    const schema = quoteIdent(fk.schema_name);
    const table = quoteIdent(fk.table_name);
    const column = quoteIdent(fk.column_name);
    const { rows: [count] } = await queryable.query(
      `SELECT COUNT(*)::int AS count FROM ${schema}.${table} WHERE ${column}=ANY($1::uuid[])`,
      [marketIds]
    );
    if (count.count > 0) {
      refs.push({
        schema: fk.schema_name,
        table: fk.table_name,
        column: fk.column_name,
        count: count.count,
        protected: PROTECTED_TABLES.has(fk.table_name),
      });
    }
  }
  return refs;
}

async function auditState(queryable = db) {
  const markets = await loadMarkets(queryable);
  const marketIds = markets.map(row => row.id);
  const refs = await referenceCounts(queryable, marketIds);
  return {
    markets,
    marketIds,
    refs,
    protected_refs: refs.filter(row => row.protected),
    disposable_refs: refs.filter(row => !row.protected),
  };
}

async function executeReset(before) {
  const client = await db.getClient();
  let locked = false;
  try {
    const { rows: [lock] } = await client.query(
      'SELECT pg_try_advisory_lock(hashtext($1),hashtext($2)) AS locked',
      [LOCK_NAMESPACE, LOCK_KEY]
    );
    if (!lock?.locked) throw new Error('REFUS: full reset CG/CM déjà actif');
    locked = true;
    await client.query('BEGIN');

    const inside = await auditState(client);
    if (inside.protected_refs.length) {
      throw new Error(`REFUS: historique métier protégé présent ${JSON.stringify(inside.protected_refs)}`);
    }

    // Delete every direct non-business reference to these two markets.
    // Repeated passes handle dependencies between staging/configuration tables.
    let previousSignature = null;
    for (let pass = 0; pass < 12; pass += 1) {
      const refs = await referenceCounts(client, inside.marketIds);
      const disposable = refs.filter(row => !row.protected);
      if (!disposable.length) break;
      const signature = JSON.stringify(disposable.map(row => [row.schema,row.table,row.column,row.count]));
      if (signature === previousSignature) {
        throw new Error(`REFUS: références staging non supprimables automatiquement ${signature}`);
      }
      previousSignature = signature;

      let progressed = false;
      for (const ref of disposable) {
        const schema = quoteIdent(ref.schema);
        const table = quoteIdent(ref.table);
        const column = quoteIdent(ref.column);
        try {
          const result = await client.query(
            `DELETE FROM ${schema}.${table} WHERE ${column}=ANY($1::uuid[])`,
            [inside.marketIds]
          );
          if (result.rowCount > 0) progressed = true;
        } catch (error) {
          // Another FK may require a different table to be deleted first.
          if (error && error.code === '23503') continue;
          throw error;
        }
      }
      if (!progressed) {
        const blocked = await referenceCounts(client, inside.marketIds);
        throw new Error(`REFUS: dépendances FK empêchent le reset ${JSON.stringify(blocked)}`);
      }
    }

    const remaining = await referenceCounts(client, inside.marketIds);
    if (remaining.length) {
      throw new Error(`REFUS: références markets restantes ${JSON.stringify(remaining)}`);
    }

    const deleted = await client.query(
      'DELETE FROM markets WHERE id=ANY($1::uuid[])',
      [inside.marketIds]
    );
    if (deleted.rowCount !== TARGET_CODES.length) {
      throw new Error(`REFUS commit: ${deleted.rowCount} marchés supprimés au lieu de ${TARGET_CODES.length}`);
    }

    const { rows: finalRows } = await client.query(
      'SELECT id,code FROM markets WHERE code=ANY($1::text[])',
      [TARGET_CODES]
    );
    if (finalRows.length) {
      throw new Error(`REFUS commit: CG/CM existent encore ${JSON.stringify(finalRows)}`);
    }

    await client.query('COMMIT');
    return {
      before,
      after: {
        markets_remaining: 0,
        codes_remaining: [],
      },
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    if (locked) {
      await client.query(
        'SELECT pg_advisory_unlock(hashtext($1),hashtext($2))',
        [LOCK_NAMESPACE, LOCK_KEY]
      ).catch(() => {});
    }
    client.release();
  }
}

async function main() {
  const mode = modeFromArgv();
  assertRuntime(mode);
  const before = await auditState();
  console.log('[cm-cg-full-reset] AUDIT ' + JSON.stringify({ mode, ...before }, null, 2));
  if (mode === 'dry-run') {
    console.log('[cm-cg-full-reset] DRY_RUN aucun changement écrit');
    return;
  }
  const result = await executeReset(before);
  console.log('[cm-cg-full-reset] EXECUTED ' + JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main()
    .catch(error => {
      console.error('[cm-cg-full-reset] FAILED ' + (error.stack || error.message || error));
      process.exitCode = 1;
    })
    .finally(() => db.pool.end());
}

module.exports = {
  TARGET_CODES,
  ACK,
  PROTECTED_TABLES,
  modeFromArgv,
  assertRuntime,
  marketForeignKeys,
  referenceCounts,
  auditState,
  executeReset,
  main,
};
