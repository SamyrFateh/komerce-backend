#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          cm-cg-market-reprovision-reset
 * @domain        market
 * @layer         tooling
 * @criticality   critical
 * @inputs        DATABASE_URL, KOMERCE_ENV=staging, --dry-run|--execute, KOMERCE_MARKET_RESET_ACK=CG,CM
 * @outputs       CG/CM historical identity preserved, legacy operational config retired, lifecycle PROVISIONING
 * @depends       db.js
 * @used-by       explicit final Market Control Plane certification only
 * @db-read       markets, orders, relais, mobile_money_transactions, market_operating_assignments, assignment_memberships, membership_capabilities, assignment_capability_ceiling, operator_market_scopes, market_payment_providers, market_cash_control_policies
 * @db-write      markets, relais, market_operating_assignments, assignment_memberships, membership_capabilities, assignment_capability_ceiling, operator_market_scopes, market_payment_providers
 * @db-txn        all mutations in one PostgreSQL transaction
 * @doctrine      preserve_market_identity_and_history, revoke_not_delete_authority_history, staging_only, fail_closed
 * @impact-areas  market, market-delegation, payments, logistics
 * @version       2026-10-v1
 */
'use strict';

const db = require('../db');

const TARGET_CODES = Object.freeze(['CG', 'CM']);
const ACK = 'CG,CM';
const LOCK_NAMESPACE = 'komerce';
const LOCK_KEY = 'cm-cg-market-reprovision-reset';

function modeFromArgv(argv = process.argv.slice(2)) {
  const execute = argv.includes('--execute');
  const dryRun = argv.includes('--dry-run');
  if (execute && dryRun) throw new Error('Choisir soit --dry-run soit --execute');
  return execute ? 'execute' : 'dry-run';
}

function assertRuntime(mode, env = process.env) {
  if (String(env.KOMERCE_ENV || '').trim().toLowerCase() !== 'staging') {
    throw new Error('REFUS: KOMERCE_ENV=staging requis');
  }
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL requis');
  if (mode === 'execute' && String(env.KOMERCE_MARKET_RESET_ACK || '') !== ACK) {
    throw new Error(`REFUS: KOMERCE_MARKET_RESET_ACK=${ACK} requis pour --execute`);
  }
}

async function auditState(queryable = db) {
  const { rows: markets } = await queryable.query(
    `SELECT id,code,name,currency,is_active,lifecycle_status,storefront_texts
       FROM markets
      WHERE code = ANY($1::text[])
      ORDER BY code`,
    [TARGET_CODES]
  );
  if (markets.length !== TARGET_CODES.length) {
    throw new Error(`REFUS: CG et CM doivent exister exactement une fois (trouvé ${markets.length})`);
  }
  const marketIds = markets.map(m => m.id);
  const { rows: [counts] } = await queryable.query(
    `SELECT
      (SELECT COUNT(*)::int FROM orders WHERE market_id = ANY($1::uuid[])) AS orders_history,
      (SELECT COUNT(*)::int FROM mobile_money_transactions WHERE market_id = ANY($1::uuid[])) AS mobile_money_history,
      (SELECT COUNT(*)::int FROM relais WHERE market_id = ANY($1::uuid[])) AS relais_total,
      (SELECT COUNT(*)::int FROM relais WHERE market_id = ANY($1::uuid[]) AND is_active=TRUE) AS relais_active,
      (SELECT COUNT(*)::int FROM market_operating_assignments WHERE market_id = ANY($1::uuid[])) AS assignments_total,
      (SELECT COUNT(*)::int FROM market_operating_assignments WHERE market_id = ANY($1::uuid[]) AND status='ACTIVE') AS assignments_active,
      (SELECT COUNT(*)::int FROM market_payment_providers WHERE market_id = ANY($1::uuid[])) AS payment_providers,
      (SELECT COUNT(*)::int FROM operator_market_scopes WHERE market_id = ANY($1::uuid[]) AND revoked_at IS NULL) AS active_projected_scopes,
      (SELECT COUNT(*)::int FROM market_cash_control_policies WHERE market_id = ANY($1::uuid[])) AS cash_policies`,
    [marketIds]
  );
  return { markets, marketIds, counts };
}

async function executeReset(before) {
  const client = await db.getClient();
  let locked = false;
  try {
    const { rows: [lock] } = await client.query(
      'SELECT pg_try_advisory_lock(hashtext($1),hashtext($2)) AS locked',
      [LOCK_NAMESPACE, LOCK_KEY]
    );
    if (!lock?.locked) throw new Error('REFUS: reset CG/CM déjà actif');
    locked = true;
    await client.query('BEGIN');

    const inside = await auditState(client);
    if (JSON.stringify(inside.marketIds.slice().sort()) !== JSON.stringify(before.marketIds.slice().sort())) {
      throw new Error('REFUS transaction: Market IDs CG/CM ont changé depuis audit');
    }

    await client.query(
      `UPDATE operator_market_scopes
          SET revoked_at=COALESCE(revoked_at,NOW())
        WHERE market_id=ANY($1::uuid[]) AND revoked_at IS NULL`,
      [inside.marketIds]
    );

    await client.query(
      `UPDATE membership_capabilities mc
          SET revoked_at=COALESCE(mc.revoked_at,NOW())
        WHERE mc.revoked_at IS NULL
          AND mc.membership_id IN (
            SELECT am.id
              FROM assignment_memberships am
              JOIN market_operating_assignments a ON a.id=am.assignment_id
             WHERE a.market_id=ANY($1::uuid[])
          )`,
      [inside.marketIds]
    );

    await client.query(
      `UPDATE assignment_memberships am
          SET status='REVOKED',
              revoked_at=COALESCE(am.revoked_at,NOW())
        WHERE am.status='ACTIVE'
          AND am.assignment_id IN (
            SELECT id FROM market_operating_assignments WHERE market_id=ANY($1::uuid[])
          )`,
      [inside.marketIds]
    );

    await client.query(
      `UPDATE assignment_capability_ceiling acc
          SET revoked_at=COALESCE(acc.revoked_at,NOW())
        WHERE acc.revoked_at IS NULL
          AND acc.assignment_id IN (
            SELECT id FROM market_operating_assignments WHERE market_id=ANY($1::uuid[])
          )`,
      [inside.marketIds]
    );

    await client.query(
      `UPDATE market_operating_assignments
          SET status='ENDED',
              effective_until=COALESCE(effective_until,NOW()),
              updated_at=NOW()
        WHERE market_id=ANY($1::uuid[]) AND status<>'ENDED'`,
      [inside.marketIds]
    );

    await client.query(
      `UPDATE relais
          SET is_active=FALSE
        WHERE market_id=ANY($1::uuid[]) AND is_active=TRUE`,
      [inside.marketIds]
    );

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

    const after = await auditState(client);
    const invalid = after.markets.some(m => m.lifecycle_status !== 'PROVISIONING' || m.is_active)
      || after.counts.assignments_active !== 0
      || after.counts.relais_active !== 0
      || after.counts.payment_providers !== 0
      || after.counts.active_projected_scopes !== 0;

    if (invalid) {
      throw new Error(`REFUS commit: état final invalide ${JSON.stringify(after)}`);
    }
    if (after.counts.orders_history !== before.counts.orders_history
        || after.counts.mobile_money_history !== before.counts.mobile_money_history) {
      throw new Error('REFUS commit: historique orders/mobile-money modifié');
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
  console.log('[cm-cg-reset] AUDIT ' + JSON.stringify({ mode, ...before }, null, 2));
  if (mode === 'dry-run') {
    console.log('[cm-cg-reset] DRY_RUN aucun changement écrit');
    return;
  }
  const result = await executeReset(before);
  console.log('[cm-cg-reset] EXECUTED ' + JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main()
    .catch(error => {
      console.error('[cm-cg-reset] FAILED ' + (error.stack || error.message || error));
      process.exitCode = 1;
    })
    .finally(() => db.pool.end());
}

module.exports = {
  TARGET_CODES,
  ACK,
  modeFromArgv,
  assertRuntime,
  auditState,
  executeReset,
  main,
};
