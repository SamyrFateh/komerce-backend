#!/usr/bin/env node
/**
 * @komerce-arch-lite
 * @role          sourcing-shadow-stock-replay-proof
 * @domain        sourcing
 * @layer         tooling
 * @owner         services/sourcing-observation-shadow-service.js
 * @purpose       Prove two synthetic 3->1 stock observations persist and resolve to the SAME canonical Offer and Unit in disposable CI PostgreSQL.
 * @impact-areas  sourcing
 * @version       2026-09
 */
'use strict';

// OFFLINE REPLAY ONLY. Never contacts Allegro, imports to the commercial
// catalog, runs a cron, purchases, or uses production/Railway credentials.
// Numeric test ref is SYNTHETIC and is not the real Golden offer.
const db = require('../db');
const shadow = require('../services/sourcing-observation-shadow-service');
const offerProjection = require('../services/sourcing-canonical-offer-projection');
const unitProjection = require('../services/sourcing-canonical-unit-projection');

const FAKE_OFFER = '7770000001';
const SOURCE_KEY = 'golden-offline-replay-';
const SOURCE_TYPE = 'api';
const SUPPLIER_ID = 'allegro';
const SUPPLIER = 'Allegro Shadow Replay TEST ONLY';
const DATABASE_URL = 'postgresql://komerce:komerce@127.0.0.1:5432/komerce_sourcing_proof';
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function assertIsolated(env) {
  if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_REF !== 'refs/heads/main' ||
      env.KOMERCE_ENV !== 'staging' || env.NODE_ENV !== 'test' ||
      env.KOMERCE_ALLOW_SHADOW_REPLAY_PROOF !== '1' ||
      env.KOMERCE_DISABLE_CRONS !== 'true' ||
      env.DATABASE_URL !== DATABASE_URL ||
      !/^[0-9]{1,24}$/.test(env.GITHUB_RUN_ID || '')) {
    throw new Error('SHADOW_REPLAY_EPHEMERAL_CI_ONLY');
  }
}

function snapshot(stock) {
  if (stock !== 3 && stock !== 1) throw new Error('SHADOW_REPLAY_STOCK_INVALID');
  return {
    schema_version: '2',
    supplier_name: SUPPLIER,
    supplier_product_id: FAKE_OFFER,
    product_name: 'SYNTHETIC OFFLINE STOCK REPLAY - NOT FOR SALE',
    purchase_price: 39.9,
    currency: 'PLN',
    stock_available: stock,
    source_locale: 'pl-PL',
    option_axes: [],
    media: [],
    sellable_units: [{
      supplier_unit_ref: FAKE_OFFER,
      supplier_sku: 'offline-synthetic-' + FAKE_OFFER,
      option_values: {},
      stock_available: stock,
      purchase_price: 39.9,
      currency: 'PLN',
      is_active: true,
      supplier_order_identity: {
        provider: 'allegro', version: 1,
        payload: { environment: 'sandbox', offer_id: FAKE_OFFER },
      },
    }],
    raw_payload: { synthetic_offline_replay: true },
  };
}

function assertResolved(summary, sourceId) {
  if (summary?.status !== 'recorded' || summary.source_id !== sourceId ||
      !summary.capture_id || summary.observations !== 3 ||
      summary.products !== 1 || summary.offers !== 1 || summary.units !== 1 ||
      summary.resolution?.status !== 'resolved' ||
      Number(summary.resolution?.review_required || 0) !== 0 ||
      Number(summary.resolution?.deferred_parent || 0) !== 0) {
    throw new Error('SHADOW_REPLAY_CAPTURE_NOT_FULLY_RESOLVED');
  }
}

function assertStockDelta(projection, grain) {
  const changes = projection?.last_observation_delta?.changes || [];
  if (projection?.authority !== 'shadow_read_only' ||
      projection?.observation_count !== 2 ||
      projection?.current_state?.stock_available !== 1 ||
      projection?.last_observation_delta?.status !== 'CHANGED' ||
      projection?.last_observation_delta?.unknown_fields?.includes('stock_available') ||
      changes.filter(c => c.field === 'stock_available' && c.before === 3 && c.after === 1).length !== 1 ||
      changes.some(c => c.field !== 'stock_available') ||
      (grain === 'unit' && projection?.commandability?.ready_now !== false)) {
    throw new Error('SHADOW_REPLAY_' + grain.toUpperCase() + '_DELTA_NOT_PROVED');
  }
}

async function bindingFor(query, captureId, grain, sourceId) {
  const { rows } = await query(
    `SELECT rb.canonical_entity_id, o.normalized
       FROM sourcing_observations o
       JOIN sourcing_captures c ON c.capture_id = o.capture_id
       JOIN sourcing_resolution_bindings rb ON rb.observation_id = o.observation_id
         AND rb.ended_at IS NULL
      WHERE o.capture_id = $1 AND o.grain::text = $2 AND c.source_id = $3
        AND ($2 <> 'unit' OR o.source_ref = $4)
      ORDER BY o.observation_id`,
    [captureId, grain, sourceId, FAKE_OFFER]);
  if (rows?.length !== 1 || !rows[0]?.canonical_entity_id ||
      rows[0]?.normalized?.stock_available == null) {
    throw new Error('SHADOW_REPLAY_' + grain.toUpperCase() + '_BINDING_MISSING');
  }
  return rows[0];
}

async function main({
  env = process.env,
  record = shadow.recordCatalogImportObservationsShadow,
  query = db.query.bind(db),
  collectOffer = offerProjection.collectCanonicalOfferProjectionById,
  collectUnit = unitProjection.collectCanonicalUnitProjectionById,
  delay = wait,
} = {}) {
  assertIsolated(env);
  const sourceInstanceKey = SOURCE_KEY + env.GITHUB_RUN_ID;
  const sourceId = shadow.buildSourceDescriptor({
    sourceType: SOURCE_TYPE, supplierName: SUPPLIER, supplierId: SUPPLIER_ID,
    sourceInstanceKey,
  }).sourceId;
  const context = products => ({
    sourceType: SOURCE_TYPE, supplierName: SUPPLIER, supplierId: SUPPLIER_ID,
    sourceInstanceKey, products,
  });

  // The only writes are shadow ingestion and resolution within disposable DB.
  const before = await record(context([snapshot(3)]));
  assertResolved(before, sourceId);
  // Ensure chronological order survives timestamps sorted by canonical projection.
  await delay(50);
  const after = await record(context([snapshot(1)]));
  assertResolved(after, sourceId);
  if (before.capture_id === after.capture_id) {
    throw new Error('SHADOW_REPLAY_CAPTURE_ID_REUSED');
  }

  const [firstOffer, secondOffer, firstUnit, secondUnit, source] = await Promise.all([
    bindingFor(query, before.capture_id, 'offer', sourceId),
    bindingFor(query, after.capture_id, 'offer', sourceId),
    bindingFor(query, before.capture_id, 'unit', sourceId),
    bindingFor(query, after.capture_id, 'unit', sourceId),
    query('SELECT autopilot_enabled, status FROM sourcing_sources WHERE source_id=$1', [sourceId]),
  ]);
  if (source.rows?.length !== 1 || source.rows[0].autopilot_enabled !== false ||
      firstOffer.canonical_entity_id !== secondOffer.canonical_entity_id ||
      firstUnit.canonical_entity_id !== secondUnit.canonical_entity_id ||
      firstOffer.normalized.stock_available !== 3 || secondOffer.normalized.stock_available !== 1 ||
      firstUnit.normalized.stock_available !== 3 || secondUnit.normalized.stock_available !== 1) {
    throw new Error('SHADOW_REPLAY_IDENTITY_OR_SOURCE_SWITCH_FAILED');
  }

  const [offer, unit] = await Promise.all([
    collectOffer(firstOffer.canonical_entity_id, query),
    collectUnit(firstUnit.canonical_entity_id, query),
  ]);
  assertStockDelta(offer, 'offer');
  assertStockDelta(unit, 'unit');
  if (unit.canonical_offer_id !== firstOffer.canonical_entity_id) {
    throw new Error('SHADOW_REPLAY_UNIT_PARENT_MISMATCH');
  }

  return {
    proof: 'SYNTHETIC_OFFLINE_SHADOW_3_TO_1_PERSISTED',
    source_id: sourceId,
    observed_before: 3,
    observed_after: 1,
    captures: 2,
    offer_observations: offer.observation_count,
    unit_observations: unit.observation_count,
    offer_identity_stable: true,
    unit_identity_stable: true,
    source_autopilot_enabled: false,
    authority: 'shadow_read_only',
    provider_live_called: false,
    catalog_promoted: false,
    purchasing_invoked: false,
    production_proved: false,
  };
}

if (require.main === module) {
  main()
    .then(result => process.stdout.write(JSON.stringify(result, null, 2) + '\n'))
    .catch(() => {
      // No SQL payload, provider material or raw errors in CI logs.
      process.stderr.write('SHADOW_REPLAY_PROOF_FAILED\n');
      process.exitCode = 1;
    })
    .finally(() => db.pool.end().catch(() => {}));
}

module.exports = { DATABASE_URL, assertIsolated, snapshot, assertResolved, assertStockDelta, main };
