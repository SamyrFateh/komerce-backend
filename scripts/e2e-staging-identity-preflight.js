'use strict';

/**
 * Issue #2914 — staging-only, read-only identity preflight.
 * Usage: KOMERCE_ENV=staging node scripts/e2e-staging-identity-preflight.js
 * Never print credentials, hashes, email addresses, tokens or DB connection strings.
 * Exit nonzero until all three role identities are present with bcrypt hashes.
 */
const db = require('../db');

async function main() {
  if (process.env.KOMERCE_ENV !== 'staging' || process.env.NODE_ENV === 'production') {
    throw new Error('STAGING_ONLY: requires KOMERCE_ENV=staging and non-production NODE_ENV');
  }
  const roles = ['finance', 'sourcing', 'agent_transitaire'];
  const result = await db.query(
    `SELECT role, COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE password_hash ~ '^\\$2[aby]\\$[0-9]{2}\\$')::int AS bcrypt_count
       FROM users WHERE role = ANY($1::text[]) GROUP BY role`,
    [roles]
  );
  const byRole = new Map(result.rows.map(r => [r.role, r]));
  let ready = true;
  for (const role of roles) {
    const row = byRole.get(role);
    const exists = !!row && row.total > 0;
    const hasHash = !!row && row.bcrypt_count > 0;
    const ok = exists && hasHash;
    ready = ready && ok;
    console.log(JSON.stringify({role, identity_present: exists, bcrypt_hash_present: hasHash, status: ok ? 'PRESENT_UNVERIFIED' : 'MISSING'}));
  }
  console.log(JSON.stringify({status: ready ? 'IDENTITIES_PRESENT_AUTH_UNVERIFIED' : 'MISSING_STAGING_TEST_IDENTITY', note: 'Role and hash presence are not proof of login, grants, or cross-market isolation.'}));
  if (!ready) process.exitCode = 2;
}
main().catch(err => {
  console.error('IDENTITY_PREFLIGHT_FAILED', err.code || err.name || 'UNKNOWN');
  process.exitCode = 1;
}).finally(async () => {
  if (db.pool && typeof db.pool.end === 'function') await db.pool.end();
});
