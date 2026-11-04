#!/usr/bin/env node
'use strict';

/**
 * L10 — activation DJ par le contrôleur canonique uniquement.
 * Lecture seule par défaut. Aucune mutation SQL directe.
 *
 * STAGING_BASE_URL=https://... DATABASE_URL=... EXPECTED_RAILWAY_ENVIRONMENT=...
 * KOMERCE_STAGING_ADMIN_TOKEN=<secret> node scripts/recette/dj-canonical-activation.js
 * Pour activer, ajouter --apply ET KOMERCE_DJ_ACTIVATE=1.
 */
const { confirmTarget } = require('./target-guard');

async function callApi(fetchImpl, base, token, path, init = {}) {
  const res = await fetchImpl(base + path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`CANONICAL_API_DENIED ${res.status} ${body.code || 'UNCLASSIFIED'}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

async function run({ db, fetchImpl = fetch, env = process.env, apply = false, targetGuard = confirmTarget } = {}) {
  if (!db) throw new Error('DATABASE_CLIENT_REQUIRED');
  const target = await targetGuard({ db, fetchImpl, env });
  if (target.confirmed !== true) throw new Error('STAGING_TARGET_NOT_CONFIRMED');

  const base = String(env.STAGING_BASE_URL || '').replace(/\/$/, '');
  const token = String(env.KOMERCE_STAGING_ADMIN_TOKEN || '');
  if (!token) throw new Error('STAGING_ADMIN_TOKEN_REQUIRED');
  const before = await callApi(fetchImpl, base, token, '/api/admin/markets/DJ/control-plane');
  if (before.market?.code !== 'DJ') throw new Error('DJ_MARKET_MISMATCH');
  const readiness = before.readiness || {};
  if (!apply) return { mode: 'read-only', market: 'DJ', status: before.market.lifecycle_status,
    readiness, blockers: [...(readiness.platform?.blockers || []), ...(readiness.operations?.blockers || [])] };
  if (env.KOMERCE_DJ_ACTIVATE !== '1') throw new Error('DJ_ACTIVATION_CONFIRMATION_REQUIRED');
  if (before.market.lifecycle_status === 'ACTIVE' && before.market.is_active) {
    return { mode: 'already-active', market: 'DJ', status: 'ACTIVE' };
  }
  if (before.market.lifecycle_status !== 'PROVISIONING') throw new Error('DJ_LIFECYCLE_UNEXPECTED');
  if (readiness.ready_for_activation !== true) throw new Error('DJ_NOT_READY_FOR_CANONICAL_ACTIVATION');
  // POST traverse authentification admin, garde readiness et writer market-provisioning-service.
  await callApi(fetchImpl, base, token, '/api/admin/markets/DJ/lifecycle', {
    method: 'POST', body: JSON.stringify({ status: 'ACTIVE' }),
  });
  const after = await callApi(fetchImpl, base, token, '/api/admin/markets/DJ/control-plane');
  if (after.market?.lifecycle_status !== 'ACTIVE' || after.market?.is_active !== true)
    throw new Error('DJ_ACTIVATION_POSTCONDITION_FAILED');
  return { mode: 'activated', market: 'DJ', status: 'ACTIVE', readiness: after.readiness };
}

async function main() {
  const db = require('../../db');
  try {
    const result = await run({ db, apply: process.argv.includes('--apply') });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } finally {
    if (db.pool?.end) await db.pool.end();
  }
}

if (require.main === module) main().catch(err => {
  process.stderr.write(`${err.code || err.message}\n`);
  process.exit(1);
});
module.exports = { run, callApi };
