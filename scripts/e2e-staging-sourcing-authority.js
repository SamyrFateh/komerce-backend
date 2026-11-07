#!/usr/bin/env node
'use strict';

/**
 * Issue #2914: temporary sourcing global authority for one staging E2E identity.
 * --dry-run (default): read only. --grant: one precisely scoped grant.
 * --revoke: revoke ONLY a grant created by this script, preserving history.
 * A live canonical central keeper must authorize the operation; never infer
 * central authority from user.role. Never print passwords, emails or user IDs.
 *
 * This is a staging certification bridge: NOT a production grant API.
 * Revoke immediately after Chromium's sourcing authorization checks.
 */
const db = require('../db');
const ACK = 'TEMPORARY_E2E_ONLY';
const REASON = 'staging_e2e_2914_temporary_sourcing';
const KEEPER = Object.freeze({
  id: '51eda5e1-b915-4f08-bba6-ba825ee36001',
  email: 'admin@komerce.km',
});

function modeFrom(argv) {
  const modes = ['--dry-run', '--grant', '--revoke'].filter(flag => argv.includes(flag));
  if (modes.length > 1) throw new Error('MODE_CONFLICT');
  return modes[0] || '--dry-run';
}
function guard(mode, env) {
  if (env.KOMERCE_ENV !== 'staging' || env.RAILWAY_ENVIRONMENT_NAME !== 'staging' ||
      env.NODE_ENV === 'production') throw new Error('STAGING_ONLY_GUARD');
  const email = String(env.E2E_SOURCING_EMAIL || '').trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('SOURCING_IDENTITY_ENV_REQUIRED');
  if (mode !== '--dry-run' && env.E2E_SOURCING_GLOBAL_AUTH_ACK !== ACK) {
    throw new Error('EXPLICIT_TEMPORARY_GRANT_ACK_REQUIRED');
  }
  return email;
}
async function inspect(executor, email) {
  const {rows: accounts} = await executor.query(
    `SELECT id, role, password_hash FROM users WHERE lower(email)=$1 LIMIT 2`, [email]
  );
  if (accounts.length !== 1 || accounts[0].role !== 'sourcing' ||
      !/^\$2[aby]\$\d{2}\$/.test(accounts[0].password_hash || '')) {
    throw new Error('EXACT_SOURCING_IDENTITY_NOT_READY');
  }
  const {rows: keepers} = await executor.query(
    `SELECT u.id FROM users u
       JOIN sourcing_global_access_grants g ON g.user_id=u.id AND g.revoked_at IS NULL
      WHERE u.id=$1 AND u.email=$2 AND u.role='admin' LIMIT 1`,
    [KEEPER.id, KEEPER.email]
  );
  if (keepers.length !== 1) throw new Error('CANONICAL_CENTRAL_KEEPER_NOT_AUTHORIZED');
  const {rows: grants} = await executor.query(
    `SELECT reason, revoked_at, granted_by
       FROM sourcing_global_access_grants WHERE user_id=$1`,
    [accounts[0].id]
  );
  return {userId: accounts[0].id, grant: grants[0] || null};
}
async function run(mode = modeFrom(process.argv.slice(2)), env = process.env) {
  const email = guard(mode, env);
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    // Prevent two concurrent provisioning runs for the same test domain.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [REASON]);
    const before = await inspect(client, email);
    let result = 'UNCHANGED';
    if (mode === '--grant') {
      if (!before.grant) {
        await client.query(
          `INSERT INTO sourcing_global_access_grants(user_id, granted_by, reason)
             VALUES ($1,$2,$3)`,
          [before.userId, KEEPER.id, REASON]
        );
        result = 'TEMPORARY_GRANT_CREATED';
      } else if (before.grant.revoked_at) {
        throw new Error('PREVIOUSLY_REVOKED_GRANT_REFUSE_AUTO_REACTIVATION');
      } else {
        result = 'ACTIVE_GRANT_ALREADY_PRESENT';
      }
    } else if (mode === '--revoke') {
      if (!before.grant || before.grant.revoked_at) {
        result = 'NO_ACTIVE_GRANT';
      } else if (before.grant.reason !== REASON || String(before.grant.granted_by) !== KEEPER.id) {
        throw new Error('REFUSE_TO_REVOKE_NON_E2E_GRANT');
      } else {
        await client.query(
          `UPDATE sourcing_global_access_grants SET revoked_at=NOW()
            WHERE user_id=$1 AND revoked_at IS NULL AND reason=$2 AND granted_by=$3`,
          [before.userId, REASON, KEEPER.id]
        );
        result = 'TEMPORARY_GRANT_REVOKED';
      }
    } else {
      result = before.grant && !before.grant.revoked_at ? 'ACTIVE_GRANT_PRESENT' : 'GLOBAL_GRANT_MISSING';
    }
    const after = await inspect(client, email);
    if (mode === '--grant' && (!after.grant || after.grant.revoked_at)) {
      throw new Error('GRANT_VERIFICATION_FAILED');
    }
    if (mode === '--revoke' && after.grant && !after.grant.revoked_at) {
      throw new Error('REVOCATION_VERIFICATION_FAILED');
    }
    await client.query(mode === '--dry-run' ? 'ROLLBACK' : 'COMMIT');
    console.log(JSON.stringify({role: 'sourcing', mode, status: result, authority: 'sourcing_global_access_grants'}));
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
if (require.main === module) {
  run().catch(error => {
    console.error('E2E_SOURCING_AUTH_FAILED', error.message || error.code || 'UNKNOWN');
    process.exitCode = 1;
  }).finally(() => db.pool.end());
}
module.exports = {ACK, REASON, modeFrom, guard, run};
