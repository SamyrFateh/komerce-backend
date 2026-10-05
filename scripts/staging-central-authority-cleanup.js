#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          staging-central-authority-cleanup
 * @domain        market-control-plane
 * @layer         tooling
 * @criticality   critical
 * @inputs        DATABASE_URL, KOMERCE_ENV=staging, --dry-run|--execute, KOMERCE_CENTRAL_AUTHORITY_CLEANUP_ACK=KEEP-ADMIN-KOMERCE
 * @outputs       exactly one active central authority holder per canonical domain
 * @depends       db.js, config/market-delegation-capabilities.js
 * @used-by       explicit staging certification cleanup only
 * @db-read       users, dashboard_global_access_grants, catalog_global_access_grants, decision_signal_global_access_grants, pricing_global_access_grants, sourcing_global_access_grants
 * @db-write      dashboard_global_access_grants, catalog_global_access_grants, decision_signal_global_access_grants, pricing_global_access_grants, sourcing_global_access_grants
 * @db-txn        all mutations in one PostgreSQL transaction
 * @doctrine      central_authority_is_explicit_grant, revoke_not_delete_authority_history, staging_only, fail_closed
 * @impact-areas  authorization, market-control-plane, dashboard, catalog, pricing, sourcing, action-center
 * @version       2026-10-v1
 */
'use strict';

const db = require('../db');
const { CENTRAL_AUTHORITY } = require('../config/market-delegation-capabilities');

const KEEPER = Object.freeze({
  id: '51eda5e1-b915-4f08-bba6-ba825ee36001',
  email: 'admin@komerce.km',
  full_name: 'Admin Komerce',
});
const ACK = 'KEEP-ADMIN-KOMERCE';
const LOCK_NAMESPACE = 'komerce';
const LOCK_KEY = 'staging-central-authority-cleanup';

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
    if (String(env.KOMERCE_CENTRAL_AUTHORITY_CLEANUP_ACK || '') !== ACK) {
      throw new Error(`REFUS: KOMERCE_CENTRAL_AUTHORITY_CLEANUP_ACK=${ACK} requis pour --execute`);
    }
  }
}

function authorityTables() {
  return Object.entries(CENTRAL_AUTHORITY).map(([domain, value]) => ({
    domain,
    table: value.table,
  }));
}

async function auditState(queryable = db) {
  const { rows: keeperRows } = await queryable.query(
    'SELECT id,full_name,email,phone,role FROM users WHERE id=$1',
    [KEEPER.id]
  );
  if (keeperRows.length !== 1) throw new Error('REFUS: Admin Komerce canonique introuvable');
  const keeper = keeperRows[0];
  if (keeper.email !== KEEPER.email || keeper.full_name !== KEEPER.full_name || keeper.role !== 'admin') {
    throw new Error(`REFUS: identité keeper inattendue ${JSON.stringify(keeper)}`);
  }

  const domains = [];
  for (const { domain, table } of authorityTables()) {
    const { rows } = await queryable.query(
      `SELECT g.user_id,u.full_name,u.email,u.role,g.granted_at,g.reason
         FROM ${table} g
         JOIN users u ON u.id=g.user_id
        WHERE g.revoked_at IS NULL
        ORDER BY g.granted_at,g.user_id`
    );
    domains.push({
      domain,
      table,
      count: rows.length,
      keeper_active: rows.some(row => String(row.user_id) === KEEPER.id),
      revoke_candidates: rows.filter(row => String(row.user_id) !== KEEPER.id),
    });
  }

  return { keeper, domains };
}

function assertSafeBefore(before) {
  const bad = before.domains.filter(domain => !domain.keeper_active);
  if (bad.length) {
    throw new Error(`REFUS: keeper absent des domaines ${bad.map(d => d.domain).join(',')}`);
  }
}

async function executeCleanup(before) {
  assertSafeBefore(before);
  const client = await db.getClient();
  let locked = false;
  try {
    const { rows: [lock] } = await client.query(
      'SELECT pg_try_advisory_lock(hashtext($1),hashtext($2)) AS locked',
      [LOCK_NAMESPACE, LOCK_KEY]
    );
    if (!lock?.locked) throw new Error('REFUS: cleanup autorité centrale déjà actif');
    locked = true;
    await client.query('BEGIN');

    const inside = await auditState(client);
    assertSafeBefore(inside);

    for (const { table } of authorityTables()) {
      await client.query(
        `UPDATE ${table}
            SET revoked_at=COALESCE(revoked_at,NOW())
          WHERE revoked_at IS NULL
            AND user_id<>$1::uuid`,
        [KEEPER.id]
      );
    }

    const after = await auditState(client);
    const invalid = after.domains.filter(domain =>
      domain.count !== 1
      || !domain.keeper_active
      || domain.revoke_candidates.length !== 0
    );
    if (invalid.length) {
      throw new Error(`REFUS commit: autorité centrale finale invalide ${JSON.stringify(invalid)}`);
    }

    await client.query('COMMIT');
    return { before, after };
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
  console.log('[central-authority-cleanup] AUDIT ' + JSON.stringify({ mode, ...before }, null, 2));
  if (mode === 'dry-run') {
    console.log('[central-authority-cleanup] DRY_RUN aucun changement écrit');
    return;
  }
  const result = await executeCleanup(before);
  console.log('[central-authority-cleanup] EXECUTED ' + JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main()
    .catch(error => {
      console.error('[central-authority-cleanup] FAILED ' + (error.stack || error.message || error));
      process.exitCode = 1;
    })
    .finally(() => db.pool.end());
}

module.exports = {
  KEEPER,
  ACK,
  authorityTables,
  modeFromArgv,
  assertRuntime,
  auditState,
  assertSafeBefore,
  executeCleanup,
  main,
};
