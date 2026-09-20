#!/usr/bin/env node
/**
 * @komerce-arch-lite
 * @role          sourcing-continuity-allegro-isolated-proof
 * @domain        sourcing
 * @layer         tooling
 * @owner         scripts/sourcing-continuity-targeted-proof.js
 * @purpose       One-off, real Allegro Sandbox exact-read proof on an ephemeral CI database only.
 * @impact-areas  sourcing, supplier-integration
 * @version       2026-09
 */
'use strict';

const db = require('../db');
const dispatch = require('../services/sourcing-import-dispatch');
const { run } = require('./sourcing-continuity-targeted-proof');
const { buildNormalizedSourceContractSnapshot } = require('../services/suppliers/normalized-product');

const SOURCE = 'api:allegro';
const SUPPLIER = 'Allegro Sandbox';
const SAFE_FIELDS = new Set(['stock_available', 'purchase_price', 'currency', 'is_active', 'availability']);

function assertIsolatedContext(env, offerId) {
  if (!/^[0-9]{1,30}$/.test(String(offerId || ''))) throw new Error('PROOF_EXACT_ALLEGRO_ID_REQUIRED');
  if (env.GITHUB_ACTIONS !== 'true' || env.KOMERCE_ENV !== 'staging' ||
      env.NODE_ENV !== 'test' || env.KOMERCE_ALLOW_SOURCE_CONTINUITY_PROOF !== '1' ||
      env.KOMERCE_ALLOW_ALLEGRO_SANDBOX !== '1') throw new Error('PROOF_ISOLATED_STAGING_REQUIRED');
  let url;
  try { url = new URL(env.DATABASE_URL); } catch { throw new Error('PROOF_EPHEMERAL_DB_REQUIRED'); }
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) ||
      url.pathname !== '/komerce_sourcing_proof' || !['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('PROOF_EPHEMERAL_DB_REQUIRED');
  }
  for (const name of ['ALLEGRO_SANDBOX_CLIENT_ID', 'ALLEGRO_SANDBOX_CLIENT_SECRET',
    'ALLEGRO_SANDBOX_REFRESH_TOKEN', 'ALLEGRO_SANDBOX_TOKEN_ENCRYPTION_KEY',
    'ALLEGRO_SANDBOX_USER_AGENT']) {
    if (!String(env[name] || '').trim()) throw new Error('PROOF_DEDICATED_SANDBOX_CREDENTIALS_REQUIRED');
  }
  return String(offerId);
}

function exactOne(result, offerId) {
  if (!result || !Array.isArray(result.products) || result.products.length !== 1 ||
      result.invalid?.length || String(result.products[0].supplier_product_id) !== offerId ||
      result.products[0].schema_version !== '2') {
    throw new Error('PROOF_EXACT_PROVIDER_RESPONSE_UNKNOWN');
  }
  const snapshot = buildNormalizedSourceContractSnapshot(result.products[0]);
  if (!snapshot || !Array.isArray(snapshot.sellable_units) || snapshot.sellable_units.length !== 1 ||
      String(snapshot.sellable_units[0].supplier_unit_ref) !== offerId ||
      snapshot.sellable_units[0].supplier_order_identity?.provider !== 'allegro' ||
      snapshot.sellable_units[0].supplier_order_identity?.payload?.environment !== 'sandbox') {
    throw new Error('PROOF_ALLEGRO_SANDBOX_IDENTITY_UNPROVEN');
  }
  return snapshot;
}

function summarize(result, offerId) {
  const sanitize = (delta) => ({
    status: delta?.status || 'UNKNOWN',
    changed_facts: (delta?.changes || []).filter(c => SAFE_FIELDS.has(c.field))
      .map(c => ({ field: c.field, before: c.before, after: c.after })),
    unknown_fields: (delta?.unknown_fields || []).filter(f => SAFE_FIELDS.has(f)),
    unreported_fields: (delta?.unreported_fields || []).filter(f => SAFE_FIELDS.has(f)),
  });
  const unit = (result.units || []).find(u => String(u.unit_ref) === offerId);
  return {
    provider: 'allegro', environment: 'sandbox', exact_offer_id: offerId,
    source_switch_off_proved: true, baseline_exact_read: true, second_exact_read: true,
    comparison: result.status, offer: sanitize(result.offer), unit: sanitize(unit),
    stock_three_to_zero_proved: (unit?.changes || []).some(c =>
      c.field === 'stock_available' && c.before === 3 && c.after === 0),
    removal_confirmed: false, catalog_mutated: false, purchasing_invoked: false,
    note: 'Two real read-only seller-offer checks; this does not prove a supplier stock reservation or public catalog propagation.',
  };
}

async function main({ argv = process.argv.slice(2), env = process.env,
  query = db.query.bind(db), dispatchToConnector = dispatch.dispatchToConnector, probe = run } = {}) {
  if (argv.length !== 1 || !argv[0].startsWith('--offer-id=')) {
    throw new Error('PROOF_SINGLE_OFFER_ID_REQUIRED');
  }
  const offerId = assertIsolatedContext(env, argv[0].slice('--offer-id='.length));
  const connector = dispatch.CONNECTORS.api.allegro;
  if (!connector?.active) throw new Error('PROOF_ALLEGRO_CONNECTOR_NOT_READY');

  // All source/candidate writes below seed only this disposable, local CI
  // database. Neither a live Komerce database nor its credentials are used.
  await query(`INSERT INTO sourcing_sources
    (source_id,adapter_type,acquisition,continuity,status,autopilot_enabled)
    VALUES ($1,'allegro','pull','recurring','active',false)`, [SOURCE]);
  const proofArgs = ['--supplier=allegro', '--product-id=' + offerId, '--execute'];
  let providerCalls = 0;
  const exactRead = async (body) => {
    if (body?.source_type !== 'api' || body?.supplier_id !== 'allegro' ||
        JSON.stringify(body?.product_ids) !== JSON.stringify([offerId])) {
      throw new Error('PROOF_BROAD_OR_NONEXACT_FETCH_REFUSED');
    }
    providerCalls += 1;
    return dispatchToConnector(body);
  };
  const off = await probe(proofArgs, env, { query, dispatchToConnector: exactRead });
  if (off?.status !== 'SKIPPED' || off.reason !== 'SOURCING_SWITCH_OFF' || providerCalls !== 0) {
    throw new Error('PROOF_SOURCE_OFF_NOT_ENFORCED');
  }

  // Turn ON exactly one synthetic source in the disposable test DB only.
  await query('UPDATE sourcing_sources SET autopilot_enabled=true WHERE source_id=$1', [SOURCE]);
  const before = exactOne(await exactRead({
    source_type: 'api', supplier_id: 'allegro', product_ids: [offerId],
  }), offerId);
  await query(`INSERT INTO sourcing_candidates
      (supplier_name,supplier_product_id,product_name,purchase_price,currency,
       state,normalized_source_contract)
      VALUES ($1,$2,$3,$4,$5,'raw_imported',$6::jsonb)`,
    [SUPPLIER, offerId, before.product_name, before.purchase_price,
      before.currency, JSON.stringify(before)]);
  const result = await probe(proofArgs, env, { query, dispatchToConnector: exactRead });
  if (providerCalls !== 2 || result?.supplier_api_called !== true ||
      result?.writes !== false || result?.catalog_mutated !== false ||
      !['CHANGED','UNCHANGED','UNKNOWN','FIRST_OBSERVATION'].includes(result.status)) {
    throw new Error('PROOF_SECOND_EXACT_READ_UNVERIFIED');
  }
  return summarize(result, offerId);
}

if (require.main === module) {
  main().then(result => {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    if (!['CHANGED', 'UNCHANGED'].includes(result.comparison)) process.exitCode = 2;
  }).catch(error => {
    // Never print provider error messages, OAuth payloads or raw supplier JSON.
    const allowed = new Set([
      'PROOF_EXACT_ALLEGRO_ID_REQUIRED', 'PROOF_ISOLATED_STAGING_REQUIRED',
      'PROOF_EPHEMERAL_DB_REQUIRED', 'PROOF_DEDICATED_SANDBOX_CREDENTIALS_REQUIRED',
      'PROOF_SINGLE_OFFER_ID_REQUIRED', 'PROOF_ALLEGRO_CONNECTOR_NOT_READY',
      'PROOF_EXACT_PROVIDER_RESPONSE_UNKNOWN', 'PROOF_ALLEGRO_SANDBOX_IDENTITY_UNPROVEN',
      'PROOF_SOURCE_OFF_NOT_ENFORCED', 'PROOF_BROAD_OR_NONEXACT_FETCH_REFUSED',
      'PROOF_SECOND_EXACT_READ_UNVERIFIED',
    ]);
    process.stderr.write((allowed.has(error?.message) ? error.message : 'PROOF_PROVIDER_OR_RUNTIME_FAILED') + '\n');
    process.exitCode = 1;
  }).finally(() => db.pool.end().catch(() => {}));
}

module.exports = { assertIsolatedContext, exactOne, summarize, main };
