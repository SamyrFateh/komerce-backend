#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          cm-cg-clean-manager-reset
 * @domain        market
 * @layer         tooling
 * @criticality   critical
 * @inputs        DATABASE_URL, KOMERCE_ENV=staging, --dry-run|--execute, KOMERCE_MARKET_CLEAN_RESET_ACK=CG,CM
 * @outputs       CG/CM markets preserved in PROVISIONING, legacy delegation removed, two historical manager users deleted when unreferenced elsewhere
 * @depends       db.js
 * @used-by       explicit CG/CM clean reprovision certification only
 * @db-read       markets, users, orders, mobile_money_transactions, market_settlements, market_operating_assignments, assignment_memberships, operator_market_scopes, market_delegation_audit, market_team_invitations, market_cash_control_policies, assignment_capability_ceiling, membership_capabilities
 * @db-write      users, markets, market_operating_assignments, assignment_memberships, assignment_capability_ceiling, membership_capabilities, operator_market_scopes, market_delegation_audit, market_team_invitations, market_cash_control_policies, market_payment_providers
 * @db-txn        all mutations in one PostgreSQL transaction
 * @doctrine      preserve_market_identity, staging_only, delete_only_known_legacy_managers, fail_closed_on_external_reference
 * @impact-areas  market, market-delegation, authorization
 * @version       2026-10-v1
 */
'use strict';

const db = require('../db');

const TARGET_CODES = Object.freeze(['CG', 'CM']);
const TARGET_USERS = Object.freeze([
  Object.freeze({
    id: 'a85a778e-72c7-43fd-9963-678920ee34e8',
    email: 'jeanfrancois@komerce.co',
    full_name: 'Jean-Français Koyamba',
  }),
  Object.freeze({
    id: '417ebd74-7c1a-4698-ba4c-a81f55842567',
    email: 'antoine@komerce.co',
    full_name: 'Pagbe Baleba',
  }),
]);
const ACK = 'CG,CM';
const LOCK_NAMESPACE = 'komerce';
const LOCK_KEY = 'cm-cg-clean-manager-reset';

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
    if (String(env.KOMERCE_MARKET_CLEAN_RESET_ACK || '') !== ACK) {
      throw new Error(`REFUS: KOMERCE_MARKET_CLEAN_RESET_ACK=${ACK} requis pour --execute`);
    }
  }
}

async function auditState(queryable = db) {
  const { rows: markets } = await queryable.query(
    `SELECT id,code,name,currency,is_active,lifecycle_status
       FROM markets
      WHERE code = ANY($1::text[])
      ORDER BY code`,
    [TARGET_CODES]
  );
  if (markets.length !== TARGET_CODES.length) {
    throw new Error(`REFUS: CG et CM doivent exister exactement une fois (trouvé ${markets.length})`);
  }

  const marketIds = markets.map(row => row.id);
  const targetUserIds = TARGET_USERS.map(row => row.id);

  const { rows: users } = await queryable.query(
    `SELECT id,email,full_name,role
       FROM users
      WHERE id = ANY($1::uuid[])
      ORDER BY id`,
    [targetUserIds]
  );

  for (const target of TARGET_USERS) {
    const user = users.find(row => String(row.id) === target.id);
    if (!user) throw new Error(`REFUS: user historique introuvable ${target.id}`);
    if (String(user.email || '').toLowerCase() !== target.email || user.full_name !== target.full_name) {
      throw new Error(`REFUS: identité inattendue pour ${target.id}: ${JSON.stringify(user)}`);
    }
  }

  const { rows: [counts] } = await queryable.query(
    `SELECT
      (SELECT COUNT(*)::int FROM orders WHERE market_id = ANY($1::uuid[])) AS orders_history,
      (SELECT COUNT(*)::int FROM mobile_money_transactions WHERE market_id = ANY($1::uuid[])) AS mobile_money_history,
      (SELECT COUNT(*)::int FROM market_settlements WHERE market_id = ANY($1::uuid[])) AS settlements_history,
      (SELECT COUNT(*)::int FROM market_operating_assignments WHERE market_id = ANY($1::uuid[])) AS assignments_total,
      (SELECT COUNT(*)::int FROM assignment_memberships am
        JOIN market_operating_assignments a ON a.id=am.assignment_id
       WHERE a.market_id = ANY($1::uuid[])) AS memberships_total,
      (SELECT COUNT(*)::int FROM operator_market_scopes WHERE market_id = ANY($1::uuid[])) AS scopes_total,
      (SELECT COUNT(*)::int FROM market_delegation_audit WHERE market_id = ANY($1::uuid[])) AS delegation_audit_total,
      (SELECT COUNT(*)::int FROM market_cash_control_policies WHERE market_id = ANY($1::uuid[])) AS cash_policies,
      (SELECT COUNT(*)::int FROM market_payment_providers WHERE market_id = ANY($1::uuid[])) AS payment_providers,
      (SELECT COUNT(*)::int
         FROM assignment_memberships am
         JOIN market_operating_assignments a ON a.id=am.assignment_id
        WHERE am.user_id = ANY($2::uuid[])
          AND a.market_id <> ALL($1::uuid[])) AS external_memberships,
      (SELECT COUNT(*)::int
         FROM operator_market_scopes
        WHERE user_id = ANY($2::uuid[])
          AND market_id <> ALL($1::uuid[])) AS external_scopes`,
    [marketIds, targetUserIds]
  );

  return { markets, marketIds, users, targetUserIds, counts };
}

async function remainingUserReferences(queryable, userIds) {
  const { rows: fkColumns } = await queryable.query(
    `SELECT
       ns.nspname AS schema_name,
       rel.relname AS table_name,
       att.attname AS column_name
     FROM pg_constraint con
     JOIN pg_class rel ON rel.oid=con.conrelid
     JOIN pg_namespace ns ON ns.oid=rel.relnamespace
     JOIN pg_class ref ON ref.oid=con.confrelid
     JOIN pg_attribute att
       ON att.attrelid=con.conrelid
      AND att.attnum=con.conkey[1]
    WHERE con.contype='f'
      AND ref.relname='users'
      AND array_length(con.conkey,1)=1
      AND array_length(con.confkey,1)=1
    ORDER BY ns.nspname, rel.relname, att.attname`
  );

  const refs = [];
  for (const fk of fkColumns) {
    const schema = '"' + String(fk.schema_name).replace(/"/g, '""') + '"';
    const table = '"' + String(fk.table_name).replace(/"/g, '""') + '"';
    const column = '"' + String(fk.column_name).replace(/"/g, '""') + '"';
    const { rows: [row] } = await queryable.query(
      `SELECT COUNT(*)::int AS count FROM ${schema}.${table} WHERE ${column}=ANY($1::uuid[])`,
      [userIds]
    );
    if (row.count > 0) {
      refs.push({ schema: fk.schema_name, table: fk.table_name, column: fk.column_name, count: row.count });
    }
  }
  return refs;
}

async function executeReset(before) {
  const client = await db.getClient();
  let locked = false;
  try {
    const { rows: [lock] } = await client.query(
      'SELECT pg_try_advisory_lock(hashtext($1),hashtext($2)) AS locked',
      [LOCK_NAMESPACE, LOCK_KEY]
    );
    if (!lock?.locked) throw new Error('REFUS: clean reset CG/CM déjà actif');
    locked = true;
    await client.query('BEGIN');

    const inside = await auditState(client);
    if (inside.counts.orders_history !== 0
        || inside.counts.mobile_money_history !== 0
        || inside.counts.settlements_history !== 0) {
      throw new Error(`REFUS: historique business présent ${JSON.stringify(inside.counts)}`);
    }
    if (inside.counts.external_memberships !== 0 || inside.counts.external_scopes !== 0) {
      throw new Error(`REFUS: manager encore utilisé hors CG/CM ${JSON.stringify(inside.counts)}`);
    }

    const { rows: assignments } = await client.query(
      'SELECT id FROM market_operating_assignments WHERE market_id=ANY($1::uuid[])',
      [inside.marketIds]
    );
    const assignmentIds = assignments.map(row => row.id);

    const { rows: memberships } = await client.query(
      'SELECT id FROM assignment_memberships WHERE assignment_id=ANY($1::uuid[])',
      [assignmentIds]
    );
    const membershipIds = memberships.map(row => row.id);

    await client.query(
      'DELETE FROM market_delegation_audit WHERE market_id=ANY($1::uuid[]) OR actor_user_id=ANY($2::uuid[])',
      [inside.marketIds, inside.targetUserIds]
    );
    await client.query(
      'DELETE FROM operator_market_scopes WHERE market_id=ANY($1::uuid[])',
      [inside.marketIds]
    );
    await client.query(
      'DELETE FROM market_cash_control_policies WHERE market_id=ANY($1::uuid[])',
      [inside.marketIds]
    );
    if (assignmentIds.length) {
      await client.query(
        'DELETE FROM market_team_invitations WHERE assignment_id=ANY($1::uuid[])',
        [assignmentIds]
      );
    }
    if (membershipIds.length) {
      await client.query(
        'DELETE FROM membership_capabilities WHERE membership_id=ANY($1::uuid[])',
        [membershipIds]
      );
    }
    if (assignmentIds.length) {
      await client.query(
        'DELETE FROM assignment_memberships WHERE assignment_id=ANY($1::uuid[])',
        [assignmentIds]
      );
      await client.query(
        'DELETE FROM assignment_capability_ceiling WHERE assignment_id=ANY($1::uuid[])',
        [assignmentIds]
      );
      await client.query(
        'DELETE FROM market_operating_assignments WHERE id=ANY($1::uuid[])',
        [assignmentIds]
      );
    }
    await client.query(
      'DELETE FROM market_payment_providers WHERE market_id=ANY($1::uuid[])',
      [inside.marketIds]
    );
    await client.query(
      `UPDATE markets
          SET lifecycle_status='PROVISIONING',
              is_active=FALSE,
              storefront_texts='{}'::jsonb
        WHERE id=ANY($1::uuid[])`,
      [inside.marketIds]
    );

    const refs = await remainingUserReferences(client, inside.targetUserIds);
    if (refs.length) {
      throw new Error(`REFUS: références users restantes après purge CG/CM ${JSON.stringify(refs)}`);
    }

    await client.query(
      'DELETE FROM users WHERE id=ANY($1::uuid[])',
      [inside.targetUserIds]
    );

    const { rows: [after] } = await client.query(
      `SELECT
        (SELECT COUNT(*)::int FROM market_operating_assignments WHERE market_id=ANY($1::uuid[])) AS assignments_total,
        (SELECT COUNT(*)::int FROM assignment_memberships am
          JOIN market_operating_assignments a ON a.id=am.assignment_id
         WHERE a.market_id=ANY($1::uuid[])) AS memberships_total,
        (SELECT COUNT(*)::int FROM operator_market_scopes WHERE market_id=ANY($1::uuid[])) AS scopes_total,
        (SELECT COUNT(*)::int FROM market_delegation_audit WHERE market_id=ANY($1::uuid[])) AS delegation_audit_total,
        (SELECT COUNT(*)::int FROM users WHERE id=ANY($2::uuid[])) AS legacy_users_remaining`,
      [inside.marketIds, inside.targetUserIds]
    );

    const { rows: finalMarkets } = await client.query(
      `SELECT id,code,is_active,lifecycle_status
         FROM markets
        WHERE id=ANY($1::uuid[])
        ORDER BY code`,
      [inside.marketIds]
    );

    if (after.assignments_total !== 0
        || after.memberships_total !== 0
        || after.scopes_total !== 0
        || after.delegation_audit_total !== 0
        || after.legacy_users_remaining !== 0
        || finalMarkets.some(row => row.is_active || row.lifecycle_status !== 'PROVISIONING')) {
      throw new Error(`REFUS commit: état final invalide ${JSON.stringify({ after, finalMarkets })}`);
    }

    await client.query('COMMIT');
    return { before, after, finalMarkets };
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
  console.log('[cm-cg-clean-reset] AUDIT ' + JSON.stringify({ mode, ...before }, null, 2));
  if (mode === 'dry-run') {
    console.log('[cm-cg-clean-reset] DRY_RUN aucun changement écrit');
    return;
  }
  const result = await executeReset(before);
  console.log('[cm-cg-clean-reset] EXECUTED ' + JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main()
    .catch(error => {
      console.error('[cm-cg-clean-reset] FAILED ' + (error.stack || error.message || error));
      process.exitCode = 1;
    })
    .finally(() => db.pool.end());
}

module.exports = {
  TARGET_CODES,
  TARGET_USERS,
  ACK,
  modeFromArgv,
  assertRuntime,
  auditState,
  remainingUserReferences,
  executeReset,
  main,
};
