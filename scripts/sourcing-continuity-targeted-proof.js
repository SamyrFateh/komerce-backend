#!/usr/bin/env node
/**
 * @komerce-arch-lite
 * @role          sourcing-continuity-targeted-proof
 * @domain        sourcing
 * @layer         tooling
 * @owner         services/sourcing-source-autopilot.js
 * @purpose       One-product read-only proof of an exact supplier refresh while the one source switch is ON.
 * @impact-areas  sourcing, supplier-integration, catalog
 * @version       2026-09
 */
'use strict';

const db = require('../db');
const dispatch = require('../services/sourcing-import-dispatch');
const { observationDelta } = require('../services/sourcing-canonical-commercial-projection-core');

const ALLOW_FLAG = 'KOMERCE_ALLOW_SOURCE_CONTINUITY_PROOF';
const OFFER_FACTS = Object.freeze([
  'purchase_price', 'currency', 'stock_available', 'availability', 'min_order_qty', 'supplier_delay_days',
]);
const UNIT_FACTS = Object.freeze([
  'purchase_price', 'currency', 'stock_available', 'availability', 'is_active',
]);

function parseArgs(argv = process.argv.slice(2)) {
  const parsed = { supplier: null, productId: null, execute: false };
  for (const arg of argv) {
    if (arg.startsWith('--supplier=')) parsed.supplier = arg.slice('--supplier='.length).toLowerCase();
    else if (arg.startsWith('--product-id=')) parsed.productId = arg.slice('--product-id='.length);
    else if (arg === '--execute') parsed.execute = true;
    else throw new Error('CONTINUITY_PROOF_UNKNOWN_ARGUMENT');
  }
  if (!parsed.supplier || !/^[a-z0-9_-]{2,30}$/.test(parsed.supplier)) throw new Error('CONTINUITY_PROOF_SUPPLIER_REQUIRED');
  if (!parsed.productId || !/^[a-zA-Z0-9_|:.-]{1,160}$/.test(parsed.productId)) throw new Error('CONTINUITY_PROOF_EXACT_PRODUCT_ID_REQUIRED');
  return parsed;
}

function assertExecutionAllowed(options, env) {
  if (!options.execute) return;
  // No production reads to the supplier, no DB writes in any environment.
  if (String(env.KOMERCE_ENV || '').toLowerCase() !== 'staging') throw new Error('CONTINUITY_PROOF_STAGING_ONLY');
  if (String(env[ALLOW_FLAG] || '') !== '1') throw new Error('CONTINUITY_PROOF_EXPLICIT_APPROVAL_REQUIRED');
}

function exactUnitRef(unit) {
  const ref = unit?.supplier_unit_ref || unit?.supplier_sku;
  return ref == null || String(ref).trim() === '' ? null : String(ref);
}

function uniqueUnits(units) {
  const refs = new Map();
  for (const unit of units || []) {
    const ref = exactUnitRef(unit);
    if (!ref || refs.has(ref)) return { valid: false, refs: new Map() };
    refs.set(ref, unit);
  }
  return { valid: true, refs };
}

function factDelta(before, after, fields, { sourceRef, unitRef = null } = {}) {
  const rows = [
    { source_id: sourceRef, principal_ref: null, observation_id: 'before', observed_at: '1', normalized: before },
    { source_id: sourceRef, principal_ref: null, observation_id: 'after', observed_at: '2', normalized: after },
  ];
  const result = observationDelta(rows, fields);
  return { unit_ref: unitRef, ...result };
}

function compareExactProduct(before, after, sourceRef) {
  if (String(before?.supplier_product_id || '') !== String(after?.supplier_product_id || '')) {
    return { status: 'UNKNOWN', reason: 'PRODUCT_IDENTITY_MISMATCH', offer: null, units: [] };
  }
  const offer = factDelta(before, after, OFFER_FACTS, { sourceRef });
  const oldUnits = uniqueUnits(before.sellable_units);
  const newUnits = uniqueUnits(after.sellable_units);
  if (!oldUnits.valid || !newUnits.valid) {
    return { status: 'UNKNOWN', reason: 'UNIT_IDENTITIES_AMBIGUOUS', offer, units: [] };
  }
  const units = [];
  for (const [ref, oldUnit] of oldUnits.refs) {
    const currentUnit = newUnits.refs.get(ref);
    if (!currentUnit) {
      units.push({ unit_ref: ref, status: 'UNKNOWN', reason: 'UNIT_NOT_IN_TARGETED_RESPONSE_NOT_REMOVAL', changes: [] });
    } else {
      units.push(factDelta(oldUnit, currentUnit, UNIT_FACTS, { sourceRef, unitRef: ref }));
    }
  }
  for (const ref of newUnits.refs.keys()) {
    if (!oldUnits.refs.has(ref)) units.push({ unit_ref: ref, status: 'FIRST_OBSERVATION', changes: [] });
  }
  const statuses = [offer.status, ...units.map(unit => unit.status)];
  return {
    status: statuses.includes('UNKNOWN') ? 'UNKNOWN' : statuses.includes('CHANGED') ? 'CHANGED'
      : statuses.includes('FIRST_OBSERVATION') ? 'FIRST_OBSERVATION' : 'UNCHANGED',
    offer,
    units,
    // Absence from a single targeted API response NEVER proves removal.
    removal_confirmed: false,
  };
}

async function run(argv = process.argv.slice(2), env = process.env, dependencies = {}) {
  const options = parseArgs(argv);
  assertExecutionAllowed(options, env);
  const query = dependencies.query || db.query.bind(db);
  const dispatchToConnector = dependencies.dispatchToConnector || dispatch.dispatchToConnector;
  const connectors = dependencies.connectors || dispatch.CONNECTORS.api;
  const entry = connectors[options.supplier];
  if (!entry || !entry.module || typeof entry.module.fetchProducts !== 'function') {
    throw new Error('CONTINUITY_PROOF_PROVIDER_EXACT_READ_UNAVAILABLE');
  }
  const sourceRef = 'api:' + options.supplier;
  const { rows: sourceRows } = await query(
    'SELECT source_id, status, autopilot_enabled FROM sourcing_sources WHERE source_id = $1',
    [sourceRef]
  );
  const source = sourceRows?.[0];
  if (!source || source.status !== 'active' || source.autopilot_enabled !== true) {
    return { status: 'SKIPPED', reason: 'SOURCING_SWITCH_OFF', source_ref: sourceRef, writes: false };
  }
  const { rows: candidates } = await query(
    `SELECT supplier_product_id, normalized_source_contract, updated_at
       FROM sourcing_candidates
      WHERE supplier_name = $1 AND supplier_product_id = $2
        AND normalized_source_contract IS NOT NULL AND state <> 'archived'
      ORDER BY updated_at DESC LIMIT 1`,
    [entry.supplierName, options.productId]
  );
  const candidate = candidates?.[0];
  if (!candidate || !candidate.normalized_source_contract) {
    return { status: 'UNKNOWN', reason: 'NO_EXACT_BASELINE', source_ref: sourceRef, writes: false };
  }
  // Dry-run never invokes an external API, and OFF never invokes discovery or refresh.
  if (!options.execute) {
    return { status: 'READY_FOR_TARGETED_READ', source_ref: sourceRef,
      supplier_product_id: options.productId, writes: false, supplier_api_called: false };
  }
  if (!entry.active) throw new Error('CONTINUITY_PROOF_CONNECTOR_INACTIVE');
  let fetched;
  try {
    fetched = await dispatchToConnector({
      source_type: 'api', supplier_id: options.supplier,
      product_ids: [options.productId],
    });
  } catch (error) {
    // A supplier timeout, 404 or API error is NOT evidence that the product
    // was withdrawn. Native error interpretation requires a proved contract.
    return {
      status: 'UNKNOWN', reason: 'SUPPLIER_EXACT_READ_FAILED',
      source_ref: sourceRef, supplier_product_id: options.productId,
      supplier_error_code: String(error?.code || 'UNKNOWN').slice(0, 80),
      writes: false, supplier_api_called: true, removal_confirmed: false,
    };
  }
  const products = fetched?.products || [];
  if (products.length !== 1 || (fetched?.invalid || []).length) {
    return { status: 'UNKNOWN', reason: 'INCOMPLETE_EXACT_RESPONSE', source_ref: sourceRef,
      writes: false, supplier_api_called: true, removal_confirmed: false };
  }
  const latest = products[0];
  if (String(latest.supplier_product_id || '') !== options.productId) {
    return { status: 'UNKNOWN', reason: 'EXACT_READ_MISMATCH', source_ref: sourceRef,
      writes: false, supplier_api_called: true, removal_confirmed: false };
  }
  // Recheck the one business switch after the network call. Do not interpret
  // results for a source turned OFF during the request.
  const { rows: stillOn } = await query(
    'SELECT status, autopilot_enabled FROM sourcing_sources WHERE source_id = $1',
    [sourceRef]
  );
  if (stillOn?.[0]?.status !== 'active' || stillOn?.[0]?.autopilot_enabled !== true) {
    return { status: 'SKIPPED', reason: 'SOURCING_SWITCH_TURNED_OFF', source_ref: sourceRef,
      writes: false, supplier_api_called: true };
  }
  return { ...compareExactProduct(candidate.normalized_source_contract, latest, sourceRef),
    source_ref: sourceRef, supplier_product_id: options.productId,
    baseline_observed_at: candidate.updated_at || null, checked_at: new Date().toISOString(),
    writes: false, supplier_api_called: true, catalog_mutated: false, purchasing_invoked: false };
}

if (require.main === module) {
  run().then((result) => process.stdout.write(JSON.stringify(result, null, 2) + '\n'))
    .catch((err) => { process.stderr.write(String(err.code || err.message || err) + '\n'); process.exitCode = 1; })
    .finally(async () => db.pool.end().catch(() => {}));
}

module.exports = { parseArgs, assertExecutionAllowed, compareExactProduct, run };
