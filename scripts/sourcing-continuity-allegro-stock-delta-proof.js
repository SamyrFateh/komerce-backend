#!/usr/bin/env node
/**
 * @komerce-arch-lite
 * @role          allegro-continuity-live-stock-delta-proof
 * @domain        sourcing
 * @layer         tooling
 * @owner         scripts/sourcing-continuity-targeted-proof.js
 * @purpose       One controlled seller-UI stock change (3 -> 1) on a dedicated Sandbox test offer; read-only supplier client.
 * @impact-areas  sourcing, supplier-integration
 * @version       2026-09
 */
'use strict';

const db = require('../db');
const dispatch = require('../services/sourcing-import-dispatch');
const { run } = require('./sourcing-continuity-targeted-proof');
const { assertIsolatedContext, exactOne, summarize } = require('./sourcing-continuity-allegro-isolated-proof');

const SOURCE = 'api:allegro';
const GOLDEN_PURCHASING_OFFER_ID = '7782182471';
const EXPECTED_STOCK = 3;
const TARGET_STOCK = 1;
const MAX_RECHECKS = 4;
const RECHECK_INTERVAL_MS = 45000;
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Never emit provider bodies, OAuth tokens, SQL errors or raw exception text.
// A stable phase and an allowlisted reason identify the failing contract.
const SAFE_STAGES = new Set([
  'INPUTS', 'CONNECTOR', 'SOURCE_FIXTURE', 'SWITCH_OFF', 'ENABLE_SOURCE',
  'BASELINE_PROVIDER_READ', 'BASELINE_CONTRACT', 'BASELINE_FIXTURE',
  'MANUAL_CHANGE_WAIT', 'SECOND_PROVIDER_READ', 'DELTA_VALIDATION',
]);
const SAFE_ERRORS = new Set([
  'PROOF_EXACT_ALLEGRO_ID_REQUIRED', 'PROOF_ISOLATED_STAGING_REQUIRED',
  'PROOF_EPHEMERAL_DB_REQUIRED', 'PROOF_DEDICATED_SANDBOX_CREDENTIALS_REQUIRED',
  'PROOF_EXACT_PROVIDER_RESPONSE_UNKNOWN', 'PROOF_ALLEGRO_SANDBOX_IDENTITY_UNPROVEN',
  'STOCK_PROOF_EXACT_TEST_OFFER_AND_ACK_REQUIRED',
  'STOCK_PROOF_PURCHASING_GOLDEN_OFFER_PROTECTED',
  'STOCK_PROOF_ALLEGRO_CONNECTOR_INACTIVE', 'STOCK_PROOF_NONEXACT_FETCH_REFUSED',
  'STOCK_PROOF_SOURCE_OFF_FAILED', 'STOCK_PROOF_BASELINE_NOT_ACTIVE_THREE',
  'STOCK_PROOF_EXACT_READ_UNKNOWN_OR_SWITCH_OFF',
  'STOCK_PROOF_UNEXPECTED_CHANGE_OR_PRICE_DRIFT',
  'STOCK_PROOF_CHANGE_NOT_OBSERVED',
  'ALLEGRO_TRANSPORT_UNAVAILABLE', 'ALLEGRO_REFRESH_TOKEN_REQUIRED',
  'ALLEGRO_REFRESH_TOKEN_UNREADABLE', 'ALLEGRO_INVALID_TOKEN_RESPONSE',
  'ALLEGRO_INVALID_JSON',
]);
function safeStockProofDiagnostic(error) {
  const stage = SAFE_STAGES.has(error?.stockProofStage) ? error.stockProofStage : 'UNKNOWN';
  const raw = typeof error?.message === 'string' ? error.message : '';
  let code = SAFE_ERRORS.has(raw) ? raw : 'PROVIDER_OR_RUNTIME_UNKNOWN';
  // Do not print the provider diagnostic suffix: it can contain raw account
  // details or request context. HTTP 400 alone does NOT prove an OAuth error.
  const http = /^ALLEGRO_HTTP_(400|401|403|404|408|409|422|429|500|502|503|504)(?:$|[^0-9])/.exec(raw);
  if (http) code = 'ALLEGRO_HTTP_' + http[1];
  return 'STOCK_PROOF_FAILURE_STAGE_' + stage + '_REASON_' + code;
}

function assertStockProofArgs(argv, env) {
  if (argv.length !== 2 || !argv[0].startsWith('--offer-id=') ||
      argv[1] !== '--test-only-offer-confirmed') {
    throw new Error('STOCK_PROOF_EXACT_TEST_OFFER_AND_ACK_REQUIRED');
  }
  const offerId = assertIsolatedContext(env, argv[0].slice('--offer-id='.length));
  if (offerId === GOLDEN_PURCHASING_OFFER_ID) {
    throw new Error('STOCK_PROOF_PURCHASING_GOLDEN_OFFER_PROTECTED');
  }
  return offerId;
}

function stockTransitionProved(delta, offerId) {
  if (delta?.status !== 'CHANGED' || delta?.offer?.status !== 'CHANGED' ||
      delta?.units?.length !== 1 || String(delta.units[0].unit_ref) !== offerId ||
      delta.units[0].status !== 'CHANGED' || delta.removal_confirmed !== false ||
      delta.supplier_api_called !== true || delta.writes !== false ||
      delta.catalog_mutated !== false || delta.purchasing_invoked !== false) return false;
  const stockMoved = changes => (changes || []).some(fact =>
    fact.field === 'stock_available' &&
    fact.before === EXPECTED_STOCK && fact.after === TARGET_STOCK
  );
  const priceUnchanged = changes => !(changes || []).some(fact =>
    fact.field === 'purchase_price' || fact.field === 'currency'
  );
  return stockMoved(delta.offer.changes) && stockMoved(delta.units[0].changes) &&
    priceUnchanged(delta.offer.changes) && priceUnchanged(delta.units[0].changes) &&
    !(delta.offer.unknown_fields || []).includes('stock_available') &&
    !(delta.units[0].unknown_fields || []).includes('stock_available');
}

async function main({ argv = process.argv.slice(2), env = process.env,
  query = db.query.bind(db), dispatchToConnector = dispatch.dispatchToConnector,
  probe = run, delay = sleep, log = console.log } = {}) {
  let stage = 'INPUTS';
  try {
  const offerId = assertStockProofArgs(argv, env);
  stage = 'CONNECTOR';
  const connector = dispatch.CONNECTORS.api.allegro;
  if (!connector?.active) throw new Error('STOCK_PROOF_ALLEGRO_CONNECTOR_INACTIVE');

  // The only writes below are fixtures in the throwaway 127.0.0.1 CI DB.
  stage = 'SOURCE_FIXTURE';
  await query(`INSERT INTO sourcing_sources
      (source_id,adapter_type,acquisition,continuity,status,autopilot_enabled)
      VALUES ($1,'allegro','pull','recurring','active',false)`, [SOURCE]);
  const proofArgs = ['--supplier=allegro', '--product-id=' + offerId, '--execute'];
  let supplierCalls = 0;
  const exactRead = async (body) => {
    if (body?.source_type !== 'api' || body?.supplier_id !== 'allegro' ||
        JSON.stringify(body?.product_ids) !== JSON.stringify([offerId])) {
      throw new Error('STOCK_PROOF_NONEXACT_FETCH_REFUSED');
    }
    supplierCalls++;
    return dispatchToConnector(body);
  };
  stage = 'SWITCH_OFF';
  const off = await probe(proofArgs, env, { query, dispatchToConnector: exactRead });
  if (off?.status !== 'SKIPPED' || off.reason !== 'SOURCING_SWITCH_OFF' ||
      supplierCalls !== 0) throw new Error('STOCK_PROOF_SOURCE_OFF_FAILED');

  stage = 'ENABLE_SOURCE';
  await query('UPDATE sourcing_sources SET autopilot_enabled=true WHERE source_id=$1', [SOURCE]);
  stage = 'BASELINE_PROVIDER_READ';
  const firstRead = await exactRead({
    source_type: 'api', supplier_id: 'allegro', product_ids: [offerId],
  });
  stage = 'BASELINE_CONTRACT';
  const before = exactOne(firstRead, offerId);
  if (before.stock_available !== EXPECTED_STOCK ||
      before.sellable_units[0].stock_available !== EXPECTED_STOCK ||
      before.sellable_units[0].is_active !== true) {
    throw new Error('STOCK_PROOF_BASELINE_NOT_ACTIVE_THREE');
  }
  stage = 'BASELINE_FIXTURE';
  await query(`INSERT INTO sourcing_candidates
      (supplier_name,supplier_product_id,product_name,purchase_price,currency,
       state,normalized_source_contract)
      VALUES ($1,$2,$3,$4,$5,'raw_imported',$6::jsonb)`,
    ['Allegro Sandbox', offerId, before.product_name, before.purchase_price,
      before.currency, JSON.stringify(before)]);

  stage = 'MANUAL_CHANGE_WAIT';
  log('READY_FOR_MANUAL_SANDBOX_TEST_OFFER_STOCK_CHANGE: baseline 3 observed. ' +
    'Set ONLY this dedicated TEST offer to stock 1 in Allegro seller UI now. ' +
    'Four exact reads will occur at 45-second intervals; no supplier writes are performed by Komerce.');
  for (let i = 0; i < MAX_RECHECKS; i++) {
    await delay(RECHECK_INTERVAL_MS);
    stage = 'SECOND_PROVIDER_READ';
    const delta = await probe(proofArgs, env, { query, dispatchToConnector: exactRead });
    stage = 'DELTA_VALIDATION';
    if (delta?.status === 'UNKNOWN' || delta?.status === 'SKIPPED' ||
        delta?.status === 'FIRST_OBSERVATION') {
      throw new Error('STOCK_PROOF_EXACT_READ_UNKNOWN_OR_SWITCH_OFF');
    }
    if (stockTransitionProved(delta, offerId)) {
      return {
        ...summarize(delta, offerId),
        live_stock_delta_proved: true,
        stock_three_to_one_proved: true,
        stock_three_to_zero_proved: false,
        expected_before: EXPECTED_STOCK,
        observed_after: TARGET_STOCK,
        provider_exact_reads: supplierCalls,
        seller_change_performed_by_operator: true,
        note: 'Real 3-to-1 stock decrease observed in Allegro Sandbox for a separately attested test offer. ' +
          'This is NOT a zero-stock or stockout proof and does not demonstrate the production cron, public catalog propagation or purchasing preflight.',
      };
    }
    if (delta?.status === 'CHANGED') throw new Error('STOCK_PROOF_UNEXPECTED_CHANGE_OR_PRICE_DRIFT');
    log('STOCK_PROOF_WAITING_FOR_EXACT_TEST_OFFER_CHANGE: ' + (i + 1) + '/' + MAX_RECHECKS);
  }
  throw new Error('STOCK_PROOF_CHANGE_NOT_OBSERVED');
  } catch (error) {
    if (error && typeof error === 'object') error.stockProofStage = stage;
    throw error;
  }
}

if (require.main === module) {
  main().then(result => process.stdout.write(JSON.stringify(result, null, 2) + '\n'))
    .catch(error => {
      process.stderr.write(safeStockProofDiagnostic(error) + '\n');
      process.exitCode = 1;
    }).finally(() => db.pool.end().catch(() => {}));
}

module.exports = { assertStockProofArgs, stockTransitionProved, safeStockProofDiagnostic, main };
