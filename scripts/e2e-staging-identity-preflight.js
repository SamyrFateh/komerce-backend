'use strict';

/**
 * Issue #2914 — staging-only, read-only E2E identity + canonical access check.
 * Checks EXACT test accounts, never unrelated users that happen to share a role.
 * No credentials, hashes, emails, UUIDs, tokens or DB URLs are written to logs.
 */
const db = require('../db');

const PROFILES = Object.freeze([
  {role: 'finance', emailEnv: 'E2E_FINANCE_EMAIL', market: 'KM',
    required: ['dashboard.market.read', 'finance.read']},
  {role: 'sourcing', emailEnv: 'E2E_SOURCING_EMAIL', global: 'sourcing'},
  {role: 'agent_transitaire', emailEnv: 'E2E_AGENT_TRANSITAIRE_EMAIL', market: 'KM',
    required: ['dashboard.market.read', 'logistics.read']},
]);
const BCRYPT_PATTERN = /^\$2[aby]\$\d{2}\$/;

async function inspectAccount(profile) {
  const email = String(process.env[profile.emailEnv] || '').trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return {role: profile.role, status: 'EMAIL_NOT_CONFIGURED'};
  }
  const {rows} = await db.query(
    'SELECT id, role, password_hash FROM users WHERE lower(email)=$1 LIMIT 2', [email]
  );
  if (rows.length !== 1) {
    return {role: profile.role, status: rows.length ? 'DUPLICATE_IDENTITY' : 'IDENTITY_MISSING'};
  }
  const user = rows[0];
  if (user.role !== profile.role || !BCRYPT_PATTERN.test(user.password_hash || '')) {
    return {role: profile.role, status: 'ROLE_OR_HASH_INVALID'};
  }
  if (profile.global === 'sourcing') {
    const {rows: grants} = await db.query(
      'SELECT EXISTS(SELECT 1 FROM sourcing_global_access_grants WHERE user_id=$1 AND revoked_at IS NULL) AS allowed',
      [user.id]
    );
    return {role: profile.role, identity: 'PRESENT', authority: 'sourcing_global_access_grants',
      status: grants[0].allowed ? 'READY_FOR_LOGIN_TEST' : 'GLOBAL_GRANT_MISSING'};
  }
  const {rows: membershipRows} = await db.query(
    `SELECT am.id AS membership_id
       FROM assignment_memberships am
       JOIN market_operating_assignments a ON a.id=am.assignment_id
       JOIN markets m ON m.id=a.market_id
      WHERE am.user_id=$1 AND am.status='ACTIVE' AND a.status='ACTIVE' AND m.code=$2
        AND m.is_active=TRUE AND m.lifecycle_status='ACTIVE'
      LIMIT 1`, [user.id, profile.market]
  );
  if (membershipRows.length !== 1) {
    return {role: profile.role, identity: 'PRESENT', market: profile.market, status: 'MARKET_MEMBERSHIP_MISSING'};
  }
  const {rows: caps} = await db.query(
    `SELECT mc.capability
       FROM membership_capabilities mc
       JOIN assignment_memberships am ON am.id=mc.membership_id
       JOIN assignment_capability_ceiling acc ON acc.assignment_id=am.assignment_id
         AND acc.capability=mc.capability AND acc.revoked_at IS NULL
      WHERE mc.membership_id=$1 AND mc.revoked_at IS NULL`,
    [membershipRows[0].membership_id]
  );
  const active = new Set(caps.map(c => c.capability));
  const missing = profile.required.filter(c => !active.has(c));
  return {role: profile.role, identity: 'PRESENT', market: profile.market,
    status: missing.length ? 'MARKET_CAPABILITIES_MISSING' : 'READY_FOR_LOGIN_TEST',
    missing_capabilities: missing};
}

async function main() {
  if (process.env.KOMERCE_ENV !== 'staging' || process.env.NODE_ENV === 'production' ||
      !process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_ENVIRONMENT_NAME !== 'staging') {
    throw new Error('STAGING_ONLY_GUARD');
  }
  const results = [];
  for (const profile of PROFILES) {
    const result = await inspectAccount(profile);
    results.push(result);
    console.log(JSON.stringify(result));
  }
  const ready = results.every(r => r.status === 'READY_FOR_LOGIN_TEST');
  console.log(JSON.stringify({market: 'KM',
    status: ready ? 'CANONICAL_GRANTS_PRESENT_LOGIN_UNVERIFIED' : 'CANONICAL_GRANTS_INCOMPLETE',
    note: 'Membership and central grants are not proof of interactive login or Chromium certification.'}));
  if (!ready) process.exitCode = 2;
}
main().catch(err => {
  console.error('E2E_PREFLIGHT_FAILED', err.code || err.name || 'UNKNOWN');
  process.exitCode = 1;
}).finally(async () => {
  if (db.pool && typeof db.pool.end === 'function') await db.pool.end();
});
