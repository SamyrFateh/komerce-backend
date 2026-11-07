#!/usr/bin/env node
'use strict';
/**
 * @komerce-arch
 * @role          staging-market-operator-isolation
 * @domain        market-delegation
 * @layer         tooling
 * @criticality   high
 * @inputs        exact staging DB fingerprint and origin, owner-issued run ID, E2E admin email
 * @outputs       scoped operator HTTP read/write isolation matrix; redacted JSON evidence
 * @depends       user-mutation-service, market-delegation-service, market-operator-provisioning, market-scope-projector
 * @db-read       users, markets, assignments, memberships, capabilities
 * @db-write-via:user-mutation-service users
 * @db-write-via:market-delegation-service assignment_memberships, membership_capabilities, market_delegation_audit
 * @db-write-via:market-scope-projector operator_market_scopes
 * @db-write-via:staging-e2e-provision e2e_test_accounts (canonical marker writer)
 * @db-txn        owned
 * @doctrine      staging_only, one_market_per_actor, no_customer_data_mutation, fail_closed, no_secrets_in_report
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CODES = Object.freeze(['KM', 'CM', 'CG']);
const BASE = 'https://komerce-backend-production.up.railway.app';

function assertAllowed(env) {
  if (env.KOMERCE_ENV !== 'staging' || env.NODE_ENV === 'production') throw new Error('STAGING_ONLY');
  if (env.EXPECTED_RAILWAY_ENVIRONMENT !== 'staging') throw new Error('STAGING_ENVIRONMENT_PIN_REQUIRED');
  if (String(env.STAGING_BASE_URL || '').replace(/\/$/, '') !== BASE) throw new Error('STAGING_HOST_MISMATCH');
  if (!env.DATABASE_URL || !env.KOMERCE_STAGING_RESET_DB_PIN) throw new Error('STAGING_DATABASE_PIN_REQUIRED');
  const pin = require('./staging-e2e-provision').assertProvisionAllowed;
  // The canonical guard verifies host:port/database and excludes production.
  pin('dry-run', env);
  const run = String(env.ISOLATION_RUN_ID || '');
  if (!/^[1-9][0-9]{7,15}$/.test(run)) throw new Error('OWNER_RUN_ID_REQUIRED');
  if (env.ISOLATION_CONFIRMATION !== 'CERTIFY-ISOLATED-MARKET-OPERATORS') throw new Error('EXACT_CONFIRMATION_REQUIRED');
  if (!env.E2E_ADMIN_EMAIL) throw new Error('ADMIN_IDENTITY_REQUIRED');
  return run;
}
function accountsForRun(run) {
  return ['CM', 'CG'].map(code => ({
    code, email: `recette-isolation-${code.toLowerCase()}-${run}@komerce.test`,
    name: `E2E Isolation ${code} (${run})`,
  }));
}
function responseStatus(value) {
  return Number(value?.status);
}
async function authorizeActors(db, run, deps) {
  const accounts = accountsForRun(run);
  const { rows: [admin] } = await db.query(
    "SELECT id FROM users WHERE lower(email)=lower($1) AND role='admin' LIMIT 1",
    [deps.adminEmail.toLowerCase()]
  );
  if (!admin) throw new Error('ADMIN_ACTOR_MISSING');
  const client = await db.getClient();
  const credentials = [];
  let committed = false;
  try {
    await client.query('BEGIN');
    // Never change credentials or permissions on an existing identity.
    for (const acct of accounts) {
      const { rows: existing } = await client.query(
        'SELECT id FROM users WHERE lower(email)=lower($1) LIMIT 1 FOR UPDATE', [acct.email]
      );
      if (existing.length) throw new Error('ISOLATION_IDENTITY_ALREADY_EXISTS');
      const password = 'Isolate9-' + crypto.randomBytes(36).toString('base64url');
      const { rows: [user] } = await deps.userWriter.createAdminUser(client, {
        fullName: acct.name, email: acct.email, role: 'market_operator', currencyPref: 'XAF',
        passwordHash: await deps.bcrypt.hash(password, 12),
      });
      const marked = await deps.markE2eTestAccount(client, { userId: user.id, actorId: admin.id });
      if (marked !== 'marked') throw new Error('E2E_MARKER_FAILED');
      const assignment = await deps.delegation.resolveActiveAssignmentByMarketCode(client, acct.code);
      if (assignment.lifecycle_status !== 'ACTIVE' || assignment.assignment_status !== 'ACTIVE') {
        throw new Error('MARKET_NOT_ACTIVE_' + acct.code);
      }
      const managerCaps = await deps.operators.targetCapabilitiesForScope(
        client, { assignmentId: assignment.assignment_id, scope: 'manager' }
      );
      const caps = [...new Set([...managerCaps, 'operations.read', 'execution.parcel.ship'])];
      const { rows: activeCeiling } = await client.query(
        'SELECT capability, limit_amount FROM assignment_capability_ceiling WHERE assignment_id=$1::uuid AND revoked_at IS NULL',
        [assignment.assignment_id]
      );
      const allowed = new Set(activeCeiling.map(x => x.capability));
      if (!caps.every(c => allowed.has(c))) throw new Error('TARGET_CEILING_MISSING_' + acct.code);
      const capabilityLimits = Object.fromEntries(activeCeiling.filter(x => x.limit_amount != null && caps.includes(x.capability))
        .map(x => [x.capability, Number(x.limit_amount)]));
      const membership = await deps.delegation.addMembership(client, {
        assignmentId: assignment.assignment_id, userId: user.id, actorUserId: admin.id,
        capabilities: caps, capabilityLimits, actorIsCentral: true,
        correlationId: 'e2e-market-isolation-' + run,
      });
      await deps.projector.projectAssignment(client, assignment.assignment_id);
      const { rows: memberships } = await client.query(
        `SELECT m.code FROM assignment_memberships am
           JOIN market_operating_assignments a ON a.id=am.assignment_id AND a.status='ACTIVE'
           JOIN markets m ON m.id=a.market_id
           WHERE am.user_id=$1::uuid AND am.status='ACTIVE' ORDER BY m.code`, [user.id]
      );
      if (memberships.length !== 1 || memberships[0].code !== acct.code) throw new Error('SCOPE_LEAK_' + acct.code);
      if (!membership.id) throw new Error('MEMBERSHIP_MISSING_' + acct.code);
      credentials.push({ code: acct.code, email: acct.email, password });
    }
    await client.query('COMMIT');
    committed = true;
    return credentials;
  } finally {
    if (!committed) try { await client.query('ROLLBACK'); } catch (_) { /* preserve original failure */ }
    client.release();
  }
}
async function exerciseHttp(credentials, fetchImpl = fetch) {
  const actors = {};
  for (const c of credentials) {
    const res = await fetchImpl(BASE + '/api/auth/login', {
      method: 'POST', headers: { origin: BASE, 'content-type': 'application/json' },
      body: JSON.stringify({ email: c.email, password: c.password }),
    });
    const json = await res.json().catch(() => ({}));
    const cookie = (res.headers.get('set-cookie') || '').split(';')[0];
    if (res.status !== 200 || json.user?.role !== 'market_operator' || !cookie) {
      throw new Error('MARKET_OPERATOR_LOGIN_FAILED_' + c.code);
    }
    actors[c.code] = { cookie };
  }
  const matrix = {};
  for (const owner of ['CM', 'CG']) {
    matrix[owner] = {};
    for (const target of CODES) {
      const root = `/api/admin/workspaces/operations/market/${target}`;
      const headers = { origin: BASE, cookie: actors[owner].cookie, 'content-type': 'application/json' };
      const get = await fetchImpl(BASE + root, { method: 'GET', headers });
      // This reference never exists. Allowed execution reaches a 4xx business refusal;
      // forbidden cross-market action must be stopped at the authorization middleware (403).
      const post = await fetchImpl(BASE + root + '/parcels/ISOLATION-PROBE-NONEXISTENT/ship', {
        method: 'POST', headers, body: JSON.stringify({ reason: 'scanner_unavailable' }),
      });
      const trace = await fetchImpl(BASE + root + '/supply/trace', { method: 'GET', headers });
      matrix[owner][target] = { read: responseStatus(get), write_probe: responseStatus(post), trace_read: responseStatus(trace) };
    }
  }
  const details = [];
  for (const owner of ['CM', 'CG']) {
    for (const target of CODES) {
      const e = matrix[owner][target];
      if (target !== owner && (e.read !== 403 || e.write_probe !== 403 || e.trace_read !== 403)) {
        details.push(owner + '->' + target + ':CROSS_MARKET_NOT_403');
      }
      if (target === owner && (e.read !== 200 || e.trace_read !== 200 ||
          e.write_probe < 400 || e.write_probe === 403 || e.write_probe >= 500)) {
        details.push(owner + '->' + target + ':OWN_MARKET_NOT_ALLOWED_OR_PROBE_UNEXPECTED');
      }
    }
  }
  return { matrix, checks: 18, failures: details, verdict: details.length ? 'MARKET_OPERATOR_ISOLATION_FAIL' : 'MARKET_OPERATOR_ISOLATION_PASS' };
}
async function run({ env = process.env, db, fetchImpl = fetch, deps, confirmTarget } = {}) {
  const runId = assertAllowed(env);
  const executor = db || require('../../db');
  const targetFn = confirmTarget || require('./target-guard').confirmTarget;
  const target = await targetFn({ db: executor, env });
  if (target?.confirmed !== true) throw new Error('TARGET_NOT_CONFIRMED');
  const libraries = deps || {
    bcrypt: require('bcryptjs'),
    userWriter: require('../../services/user-mutation-service'),
    delegation: require('../../services/market-delegation-service'),
    operators: require('../../services/market-operator-provisioning'),
    projector: require('../../services/market-scope-projector'),
    markE2eTestAccount: require('./staging-e2e-provision').markE2eTestAccount,
  };
  // The admin identity is used only as the canonical audit actor, not a bypass.
  const credentials = await authorizeActors(executor, runId, { ...libraries, adminEmail: env.E2E_ADMIN_EMAIL });
  const matrix = await exerciseHttp(credentials, fetchImpl);
  return {
    schema: 'market-operator-cross-isolation/1', staging: true, run_id: runId,
    actors: ['CM', 'CG'], markets_tested: CODES,
    identities: 'new distinct market_operator E2E accounts; each one active membership only',
    probes: 'GET workspace; GET trace; POST ship on guaranteed nonexistent ref',
    ...matrix,
    limits: ['Only staging E2E accounts created', 'Each account has scoped execution.parcel.ship for a harmless negative probe', 'No permanent partner pricing or real payment'],
  };
}
async function main() {
  const db = require('../../db');
  try {
    const report = await run({ db });
    const dir = 'test-results/market-operator-isolation';
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report));
    if (report.verdict !== 'MARKET_OPERATOR_ISOLATION_PASS') process.exitCode = 1;
  } finally {
    if (db.pool && db.pool.end) await db.pool.end();
  }
}
if (require.main === module) main().catch(e => { console.error('REFUS: ' + String(e.code || e.message).slice(0,180)); process.exitCode = 2; });
module.exports = { assertAllowed, accountsForRun, exerciseHttp, run };
