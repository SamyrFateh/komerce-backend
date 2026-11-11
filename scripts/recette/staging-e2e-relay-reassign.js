#!/usr/bin/env node
'use strict';
/**
 * @komerce-arch
 * @role          staging-e2e-relay-reassign
 * @domain        auth-identity
 * @layer         tooling
 * @criticality   high
 * @inputs        DATABASE_URL (staging), STAGING_BASE_URL, E2E_AGENT_RELAIS_EMAIL, RELAY_MODE, RELAY_RUN8 | RELAY_RESTORE_ID
 * @outputs       JSON (statuts + ids relais avant/apres, jamais email ni secret)
 * @depends       scripts/recette/target-guard.js, services/user-mutation-service.js (assignAgentRelais, seul writer canonique)
 * @used-by       .github/workflows/staging-e2e-relay-reassign.yml
 * @db-read       users, relais, markets, market_operating_assignments, assignment_memberships, membership_capabilities
 * @db-write      users.relais_id via assignAgentRelais, owner-approved staging-only relay membership via market-delegation-service
 * @db-txn        une transaction ; dry-run = ROLLBACK
 * @doctrine      e2e_account_only, reversible_relay_assignment, staging_owner_grant_via_canonical_writer_when_missing, cross_market_isolation, staging_only
 * @impact-areas  staging, auth-identity, relais-scope
 * @version       2026-11
 */
const fs = require('fs');
const path = require('path');
const { confirmTarget } = require('./target-guard');
const SAFE_DOMAINS = new Set(['komerce.test', 'recette.komerce.invalid']);
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

function isDedicatedE2E(email) {
  const m = String(email || '').trim().toLowerCase().match(/^([^@\s]+)@([^@\s]+)$/);
  return Boolean(m && SAFE_DOMAINS.has(m[2]) && /(?:e2e|rct1|recette)/.test(m[1]));
}

// mode : dry-run | to-fixture (RELAY_RUN8) | restore (RELAY_RESTORE_ID). Retourne un rapport sans donnée personnelle.
async function reassign({ db, env = process.env, fetchImpl = fetch, apply = false }) {
  if (env.KOMERCE_ENV !== 'staging' || env.KOMERCE_TARGET_ENV !== 'staging') throw new Error('STAGING_ONLY');
  const mode = env.RELAY_MODE || 'dry-run-to-fixture';
  const ownerApproved = env.GITHUB_REPOSITORY === 'SamyrFateh/komerce-backend' && env.GITHUB_ACTOR && env.GITHUB_ACTOR === env.GITHUB_REPOSITORY_OWNER && ['issues', 'workflow_dispatch'].includes(env.GITHUB_EVENT_NAME);
  if (apply && !ownerApproved) throw new Error('OWNER_APPROVAL_REQUIRED');
  const email = env.E2E_AGENT_RELAIS_EMAIL;
  if (!isDedicatedE2E(email)) throw new Error('E2E_ACCOUNT_REQUIRED');
  const target = await confirmTarget({ db, fetchImpl, env });
  if (!target.confirmed) throw new Error('STAGING_FINGERPRINT_NOT_CONFIRMED');
  const client = await db.getClient();
  const report = { mode, apply, writes: 0 };
  try {
    await client.query('BEGIN');
    const { rows: [user] } = await client.query("SELECT id, relais_id, role::text AS role FROM users WHERE lower(email)=lower($1)", [email]);
    if (!user || user.role !== 'agent_relais') throw new Error('E2E_AGENT_RELAIS_NOT_FOUND');
    report.relais_before = user.relais_id;
    let dest;
    if (mode.endsWith('to-fixture')) {
      const run8 = String(env.RELAY_RUN8 || '').toUpperCase();
      if (!/^[A-F0-9]{8}$/.test(run8)) throw new Error('RUN8_REQUIRED');
      const { rows: [r] } = await client.query('SELECT id, market_id FROM relais WHERE name=$1 AND is_active', [`E2E-HUB-V1-${run8}-RELAIS`]);
      if (!r) throw new Error('FIXTURE_RELAY_NOT_FOUND');
      dest = r.id;
      const { rows: [cur] } = await client.query('SELECT market_id FROM relais WHERE id=$1', [user.relais_id]);
      report.same_market = Boolean(cur && cur.market_id === r.market_id);
      if (!report.same_market) {
        // Uniquement la recette multi-market E2E : le compte et le relais cible sont dédiés,
        // les DEUX marchés sont KM/CM/CG et le membership de destination existe déjà.
        // Aucun grant n'est ajouté. Toute autre mutation cross-market reste interdite.
        const { rows: markets } = await client.query(
          'SELECT id, code FROM markets WHERE id = ANY($1::uuid[])',
          [[cur && cur.market_id, r.market_id].filter(Boolean)]
        );
        const codes = new Set(markets.map(x => x.code));
        if (!cur || ![...codes].every(code => ['KM', 'CM', 'CG'].includes(code)) || codes.size !== 2) {
          throw new Error('RELAY_MARKET_MISMATCH');
        }
        const { rows: [granted] } = await client.query(
          `SELECT 1
             FROM market_operating_assignments moa
             JOIN assignment_memberships am ON am.assignment_id=moa.id AND am.status='ACTIVE'
             JOIN membership_capabilities mc ON mc.membership_id=am.id
                  AND mc.capability='execution.parcel.collect' AND mc.revoked_at IS NULL
            WHERE moa.market_id=$1::uuid AND moa.status='ACTIVE' AND am.user_id=$2::uuid
            LIMIT 1`,
          [r.market_id, user.id]
        );
        if (!granted) {
          // Disposable staging: grant only the two canonical relay capabilities
          // using the same service as E2E provisioning, under the existing
          // active market ceiling. Never bypass delegation or cross-market
          // isolation: the grant is recorded by the canonical writer.
          const targetCode = markets.find(m => m.id === r.market_id)?.code;
          const ownerApproved = env.HUB_V1_STAGING_DISPOSABLE_MODE === '1' &&
            env.NODE_ENV === 'test' &&
            env.EXPECTED_RAILWAY_ENVIRONMENT === 'staging' &&
            env.GITHUB_REPOSITORY === 'SamyrFateh/komerce-backend' &&
            env.GITHUB_ACTOR && env.GITHUB_ACTOR === env.GITHUB_REPOSITORY_OWNER &&
            ['issues', 'workflow_dispatch'].includes(env.GITHUB_EVENT_NAME);
          if (!ownerApproved || !['CM', 'CG'].includes(targetCode))
            throw new Error('RELAY_E2E_NO_MARKET_MEMBERSHIP');
          const { rows: [admin] } = await client.query(
            "SELECT id, role::text AS role FROM users WHERE lower(email)=lower($1)",
            [env.E2E_ADMIN_EMAIL]
          );
          if (!admin || admin.role !== 'admin') throw new Error('RELAY_E2E_ADMIN_AUTHORITY_MISSING');
          const { ensureRelayAgentMembership } = require('./staging-e2e-provision');
          await ensureRelayAgentMembership(client,
            { delegation: require('../../services/market-delegation-service') },
            { userId: user.id, marketCode: targetCode, actorId: admin.id });
          report.recette_market_membership_granted = targetCode;
          const { rows: [verified] } = await client.query(
            `SELECT 1 FROM market_operating_assignments moa
               JOIN assignment_memberships am ON am.assignment_id=moa.id AND am.status='ACTIVE'
               JOIN membership_capabilities mc ON mc.membership_id=am.id
                    AND mc.capability='execution.parcel.collect' AND mc.revoked_at IS NULL
              WHERE moa.market_id=$1::uuid AND moa.status='ACTIVE' AND am.user_id=$2::uuid LIMIT 1`,
            [r.market_id, user.id]
          );
          if (!verified) throw new Error('RELAY_E2E_MARKET_MEMBERSHIP_NOT_PROVEN');
        }
        report.recette_cross_market = true;
      }
    } else if (mode === 'to-order') {
      const reference = String(env.RELAY_ORDER_REFERENCE || '').trim().toUpperCase();
      if (reference !== 'KUYIYUK') throw new Error('ORDER_REFERENCE_NOT_ALLOWED');
      const { rows: [order] } = await client.query(
        `SELECT id, market_id, relais_id, simulation_scope, status::text AS status,
                payment_mode::text AS payment_mode, payment_status::text AS payment_status
           FROM orders WHERE reference=$1 LIMIT 1`,
        [reference]
      );
      if (!order || !order.relais_id || order.simulation_scope !== 'G6-BUYER' ||
          order.status !== 'pending' || order.payment_mode !== 'cash_relais' || order.payment_status !== 'pending') {
        throw new Error('TARGET_ORDER_NOT_ELIGIBLE');
      }
      const { rows: [targetRelay] } = await client.query(
        'SELECT id, market_id FROM relais WHERE id=$1::uuid AND is_active=TRUE LIMIT 1',
        [order.relais_id]
      );
      const { rows: [currentRelay] } = await client.query(
        'SELECT market_id FROM relais WHERE id=$1::uuid LIMIT 1',
        [user.relais_id]
      );
      if (!targetRelay || !currentRelay || targetRelay.market_id !== order.market_id ||
          currentRelay.market_id !== order.market_id) throw new Error('RELAY_MARKET_MISMATCH');
      dest = targetRelay.id;
      report.order_reference = reference;
      report.order_id = order.id;
      report.same_market = true;
    } else if (mode === 'restore') {
      if (!UUID.test(String(env.RELAY_RESTORE_ID || ''))) throw new Error('RESTORE_ID_REQUIRED');
      dest = env.RELAY_RESTORE_ID;
    } else throw new Error('MODE_INVALID');
    report.relais_after_target = dest;
    if (apply) {
      const { assignAgentRelais } = require('../../services/user-mutation-service');
      const res = await assignAgentRelais(client, { userId: user.id, relaisId: dest });
      report.status = res.status; report.writes = res.status === 'assigned' ? 1 : 0;
      if (!['assigned', 'already'].includes(res.status)) throw new Error('ASSIGN_REFUSED:' + res.status);
      await client.query('COMMIT');
    } else { report.status = 'DRY_RUN'; await client.query('ROLLBACK'); }
    return report;
  } catch (e) { try { await client.query('ROLLBACK'); } catch (_) { /* fermée */ } throw e; } finally { client.release(); }
}

async function main() {
  const db = require('../../db');
  try {
    const apply = process.env.RELAY_APPLY === '1' && process.env.RELAY_CONFIRMATION === 'REASSIGN-E2E-RELAY';
    const report = await reassign({ db, apply });
    fs.mkdirSync('test-results/relay-reassign', { recursive: true });
    fs.writeFileSync(path.join('test-results/relay-reassign', 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report));
  } finally { if (db.pool && db.pool.end) await db.pool.end(); }
}
if (require.main === module) main().catch((e) => { console.error('REFUS: ' + String(e.message)); process.exitCode = 2; });
module.exports = { reassign, isDedicatedE2E };
