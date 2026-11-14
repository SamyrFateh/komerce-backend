#!/usr/bin/env node
'use strict';
/**
 * @komerce-arch-lite
 * @role staging-e2e-pickup-secret-fixture
 * @domain logistics
 * @layer tooling
 * @owner backend-core
 * @purpose Emit a genuine canonical pickup secret for ONE fresh paid LOCAL_STOCK staging E2E fixture.
 * @db-read orders, users, markets
 * @db-write-via:pickup-secret-service orders
 * @db-txn same_transaction
 * @impact-areas staging-only, pickup, logistics
 *
 * Not a cash payment simulator. The fixture payment has already been simulated
 * by the canonical Hub certification runner. Never print/archive the secret.
 */
const fs = require('fs');
const db = require('../../db');
const { confirmTarget } = require('./target-guard');
const { ensureSecretGenerated } = require('../../services/pickup-secret-service');
const { normalizeCode, CODE_ALPHABET, CODE_LENGTH } = require('../../services/pickup-code-helpers');

const BASE = 'https://komerce-backend-production.up.railway.app';
const MARKETS = new Set(['KM', 'CM', 'CG']);
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

function checkOwnerAndFixture(env) {
  if (env.GITHUB_REPOSITORY !== 'SamyrFateh/komerce-backend' ||
      !env.GITHUB_ACTOR || env.GITHUB_ACTOR !== env.GITHUB_REPOSITORY_OWNER ||
      !['issues', 'workflow_dispatch'].includes(env.GITHUB_EVENT_NAME)) {
    throw new Error('PICKUP_FIXTURE_OWNER_ONLY');
  }
  if (env.NODE_ENV !== 'test' || env.KOMERCE_ENV !== 'staging' ||
      env.KOMERCE_TARGET_ENV !== 'staging' ||
      env.STAGING_BASE_URL !== BASE ||
      env.E2E_STAGING_BASE_URL !== BASE ||
      env.HUB_V1_STAGING_DISPOSABLE_MODE !== '1' ||
      !/^[a-f0-9]{40}$/i.test(env.E2E_EXPECTED_DEPLOY_SHA || '') ||
      !env.GITHUB_ENV) {
    throw new Error('PICKUP_FIXTURE_TARGET_GUARD');
  }
  const run8 = String(env.HTTP_RUNNER_RUN8 || '').toUpperCase();
  const market = String(env.HTTP_RUNNER_MARKET || '').toUpperCase();
  if (!/^[A-F0-9]{8}$/.test(run8) || !MARKETS.has(market)) {
    throw new Error('PICKUP_FIXTURE_RUN_OR_MARKET_INVALID');
  }
  const suffix = env.PICKUP_FIXTURE_SUFFIX || 'LOCAL';
  if (!['KOM-101', 'LOCAL'].includes(suffix)) {
    throw new Error('PICKUP_FIXTURE_SUFFIX_NOT_ALLOWED');
  }
  return { run8, market, suffix, reference: 'E2E-HUB-V1-' + run8 + '-' + suffix };
}

async function main() {
  const env = process.env;
  const { run8, market, suffix, reference } = checkOwnerAndFixture(env);
  const versionRes = await fetch(BASE + '/health/version');
  if (!versionRes.ok) throw new Error('PICKUP_FIXTURE_HEALTH_UNAVAILABLE');
  const version = await versionRes.json();
  if (String(version.commit || version.sha || '').toLowerCase() !==
      env.E2E_EXPECTED_DEPLOY_SHA.toLowerCase()) {
    throw new Error('PICKUP_FIXTURE_STAGING_SHA_MISMATCH');
  }
  const target = await confirmTarget({ db, env });
  if (!target.confirmed) throw new Error('PICKUP_FIXTURE_DB_FINGERPRINT_MISMATCH');

  const client = await db.getClient();
  let inTransaction = false;
  let code = null;
  try {
    await client.query('BEGIN'); inTransaction = true;
    const { rows } = await client.query(
      'SELECT o.id, o.reference, o.relais_id, o.status::text AS status, ' +
      'o.payment_status::text AS payment_status, o.payment_mode, ' +
      'o.simulation_scope, o.pickup_secret_hash, o.pickup_secret_salt, ' +
      'm.code AS market_code, u.email AS buyer_email ' +
      'FROM orders o JOIN users u ON u.id = o.user_id ' +
      'JOIN markets m ON m.id = o.market_id ' +
      'WHERE o.reference = $1 FOR UPDATE OF o',
      [reference]
    );
    if (rows.length !== 1) throw new Error('PICKUP_FIXTURE_NOT_UNIQUE');
    const order = rows[0];
    if (!UUID.test(String(order.id)) || !UUID.test(String(order.relais_id)) ||
        order.market_code !== market ||
        order.buyer_email?.toLowerCase() !==
          ('e2e-hub-v1-' + run8.toLowerCase() + '@komerce.test') ||
        order.simulation_scope !== 'E2E-HUB-V1' ||
        order.payment_mode !== 'cash_relais' ||
        order.payment_status !== 'paid' ||
        !['ordered', 'confirmed'].includes(order.status) ||
        order.pickup_secret_hash || order.pickup_secret_salt) {
      throw new Error('PICKUP_FIXTURE_OWNERSHIP_PAYMENT_OR_SECRET_INVALID');
    }
    const result = await ensureSecretGenerated({
      orderId: order.id, relaisId: order.relais_id,
      channel: 'cash_relais', dbClient: client
    });
    if (result.alreadyExisted || !result.code) {
      throw new Error('PICKUP_FIXTURE_SECRET_ALREADY_ISSUED');
    }
    code = normalizeCode(result.code);
    if (code.length !== CODE_LENGTH ||
        [...code].some(char => !CODE_ALPHABET.includes(char)) ||
        result.last4 !== code.slice(-4)) {
      throw new Error('PICKUP_FIXTURE_CANONICAL_CODE_INVALID');
    }
    const { rows: check } = await client.query(
      'SELECT pickup_secret_hash, pickup_secret_last4 FROM orders WHERE id=$1',
      [order.id]
    );
    if (check.length !== 1 || !check[0].pickup_secret_hash ||
        check[0].pickup_secret_last4 !== result.last4) {
      throw new Error('PICKUP_FIXTURE_SECRET_WRITE_UNCONFIRMED');
    }
    await client.query('COMMIT'); inTransaction = false;
  } catch (error) {
    if (inTransaction) await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  // The browser runner receives the real generated secret via GitHub's
  // process-local environment file. No log, report or artifact contains it.
  process.stdout.write('::add-mask::' + code + '\n');
  const key = suffix === 'LOCAL' ? 'HUB_PICKUP_CODE_LOCAL' : 'HUB_PICKUP_CODE_IMPORT';
  fs.appendFileSync(env.GITHUB_ENV, key + '=' + code + '\n' +
    (suffix === 'LOCAL' ? 'G3_PICKUP_CODE=' + code + '\n' : ''), { mode: 0o600 });
  console.log(JSON.stringify({
    verdict: 'CANONICAL_PICKUP_SECRET_ISSUED',
    market, run8, suffix, code_issued: true, secret_in_logs: false
  }));
}

if (require.main === module) {
  main().catch(error => {
    console.error('PICKUP_FIXTURE_REFUSED:' + String(error.message).slice(0, 140));
    process.exitCode = 2;
  }).finally(() => db.pool?.end?.());
}
module.exports = { checkOwnerAndFixture };
