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
 * @db-read       users, relais
 * @db-write      users.relais_id (compte E2E agent_relais uniquement) via assignAgentRelais
 * @db-txn        une transaction ; dry-run = ROLLBACK
 * @doctrine      e2e_account_only, reversible, no_rights_widening, staging_only
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
      if (!report.same_market) throw new Error('RELAY_MARKET_MISMATCH');
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
