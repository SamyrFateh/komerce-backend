#!/usr/bin/env node
'use strict';
/**
 * @komerce-arch-lite
 * @role g6e-local-pickup-code
 * @domain logistics
 * @layer tooling
 * @owner backend-core
 * @purpose Émet le code de retrait canonique de la commande G3 LOCAL préparée, sur PG16 jetable uniquement (G3_PICKUP_CODE dans GITHUB_ENV).
 * @db-read orders
 * @db-write-via:pickup-secret-service orders
 * @db-txn same_transaction
 * @impact-areas pickup, logistics, test-only
 */
const fs = require('fs');
const db = require('../../db');
const runner = require('./hub-v1-certification-runner');
const { ensureSecretGenerated } = require('../../services/pickup-secret-service');
const { normalizeCode } = require('../../services/pickup-code-helpers');

async function main() {
  runner.assertEphemeralTarget(process.env.DATABASE_URL, []);
  if (process.env.NODE_ENV !== 'test' || process.env.KOMERCE_ENV !== 'test' || !process.env.GITHUB_ENV ||
      !/^[A-F0-9]{8}$/.test(String(process.env.HTTP_RUNNER_RUN8 || ''))) throw Error('G6E_LOCAL_PICKUP_CODE_REFUSED');
  const ref = runner.orderRef(process.env.HTTP_RUNNER_RUN8, 'LOCAL');
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const { rows: [o] } = await client.query(
      "SELECT id, relais_id FROM orders WHERE reference=$1 AND simulation_scope='E2E-HUB-V1' AND pickup_secret_hash IS NULL FOR UPDATE", [ref]);
    if (!o) throw Error('G6E_LOCAL_ORDER_NOT_FOUND_OR_ALREADY_ISSUED');
    const r = await ensureSecretGenerated({ orderId: o.id, relaisId: o.relais_id, channel: 'cash_relais', dbClient: client });
    await client.query('COMMIT');
    fs.appendFileSync(process.env.GITHUB_ENV, 'G3_PICKUP_CODE=' + normalizeCode(r.code) + '\n', { mode: 0o600 });
    console.log(JSON.stringify({ verdict: 'LOCAL_PICKUP_CODE_ISSUED', secret_in_logs: false }));
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
}
main().catch(e => { console.error(String(e.message).slice(0, 160)); process.exitCode = 2; }).finally(() => db.pool?.end?.());
