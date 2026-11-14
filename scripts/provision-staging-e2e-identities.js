'use strict';
/**
 * Issue #2914: one-shot, staging-only identity provisioning.
 * Required env: KOMERCE_ENV=staging, E2E_FINANCE_EMAIL/PASSWORD,
 * E2E_SOURCING_EMAIL/PASSWORD, E2E_AGENT_TRANSITAIRE_EMAIL/PASSWORD.
 * Provision identity only; delegated grants MUST be performed separately
 * via their canonical owners before Playwright certification.
 * Never prints emails, passwords, hashes or connection strings.
 */
const bcrypt = require('bcryptjs');
const db = require('../db');
const { createAdminUser } = require('../services/user-mutation-service');
const ROLES = ['finance', 'sourcing', 'agent_transitaire'];
async function run() {
  if (process.env.KOMERCE_ENV !== 'staging' ||
      process.env.RAILWAY_ENVIRONMENT_NAME !== 'staging' ||
      process.env.NODE_ENV === 'production' ||
      process.env.E2E_IDENTITY_PROVISION_CONFIRM !== 'STAGING_ONLY') {
    throw new Error('STAGING_ONLY_GUARD');
  }
  for (const role of ROLES) {
    const key = role.toUpperCase();
    const email = (process.env['E2E_' + key + '_EMAIL'] || '').trim().toLowerCase();
    const password = process.env['E2E_' + key + '_PASSWORD'];
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ||
        !password || password.length < 12 || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
      throw new Error('INVALID_CREDENTIAL_CONFIGURATION_' + key);
    }
  }
  for (const role of ROLES) {
    const key = role.toUpperCase();
    const email = process.env['E2E_' + key + '_EMAIL'].trim().toLowerCase();
    const password = process.env['E2E_' + key + '_PASSWORD'];
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const existing = await client.query('SELECT id, role FROM users WHERE email=$1 FOR UPDATE', [email]);
      if (existing.rows.length) {
        if (existing.rows[0].role !== role) throw new Error('ROLE_MISMATCH_' + key);
        console.log(JSON.stringify({role,status:'EXISTS_UNCHANGED'}));
      } else {
        await createAdminUser(client, {
          fullName: 'Chromium E2E ' + role,
          email, role, phone: null, currencyPref: 'KMF',
          passwordHash: await bcrypt.hash(password, 12)
        });
        console.log(JSON.stringify({role,status:'CREATED_GRANTS_PENDING'}));
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally { client.release(); }
  }
}
run().catch(err => {
  console.error('E2E_IDENTITY_PROVISION_FAILED', err.code || (String(err.message).startsWith('INVALID_') || String(err.message).startsWith('ROLE_') || String(err.message).startsWith('STAGING_') ? err.message : 'UNEXPECTED'));
  process.exitCode = 1;
}).finally(async () => {
  if (db.pool && typeof db.pool.end === 'function') await db.pool.end();
});
