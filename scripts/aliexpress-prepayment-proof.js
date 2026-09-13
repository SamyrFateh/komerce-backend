#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          aliexpress-prepayment-proof
 * @domain        purchasing
 * @layer         script
 * @criticality   high
 * @inputs        promoted AliExpress candidate, live DS API, optional staging logistics address
 * @outputs       product/SKU resolution, live stock/price, freight proof, place-order payload readiness
 * @depends       db.js, services/suppliers/connectors/aliexpress-connected-connector.js, services/suppliers/aliexpress-purchase-preflight.js
 * @db-read       sourcing_candidates, products, product_skus
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/ALIEXPRESS_BUSINESS_READINESS.md, docs/doctrine/DOCTRINE_SUPPLIER_ORDER_IDENTITY.md
 * @impact-areas  purchasing, supplier-integration, catalog
 * @version       2026-09-ae-prepayment-v4
 */
'use strict';

const db = require('../db');
const connected = require('../services/suppliers/connectors/aliexpress-connected-connector');
const preflight = require('../services/suppliers/aliexpress-purchase-preflight');

const PROOF_FLAG = 'KOMERCE_ALLOW_ALIEXPRESS_PREPAYMENT_PROOF';

function truthy(value) {
  return ['1', 'true', 'yes'].includes(String(value || '').trim().toLowerCase());
}

function runtime(env = process.env) {
  return String(env.KOMERCE_ENV || env.NODE_ENV || '').trim().toLowerCase() || 'unknown';
}

function guard(env = process.env) {
  const rt = runtime(env);
  if (rt === 'production') throw new Error('REFUS: preuve pré-paiement AliExpress interdite en production');
  if (!truthy(env[PROOF_FLAG])) throw new Error(`${PROOF_FLAG}=1 requis`);
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL requis');
  return rt;
}

function parseAddress(env = process.env) {
  const raw = String(env.KOMERCE_ALIEXPRESS_PREPAYMENT_ADDRESS_JSON || '').trim();
  if (!raw) return null;
  let parsed;
  try { parsed = JSON.parse(raw); } catch (_) { throw new Error('KOMERCE_ALIEXPRESS_PREPAYMENT_ADDRESS_JSON doit être un JSON valide'); }
  if (!parsed || typeof parsed !== 'object' || !String(parsed.address || '').trim()) {
    throw new Error('Adresse staging AliExpress invalide: address requis');
  }
  return parsed;
}

async function candidateRows() {
  const { rows } = await db.query(`
    SELECT sc.id AS candidate_id,
           sc.product_id,
           sc.supplier_product_id,
           sc.product_name,
           sc.normalized_source_contract,
           ps.id AS product_sku_id,
           ps.supplier_sku,
           ps.stock AS sku_stock
      FROM sourcing_candidates sc
      JOIN products p ON p.id = sc.product_id
      JOIN product_skus ps
        ON ps.product_id = sc.product_id
       AND ps.source = 'SUPPLIER'
       AND ps.is_active = TRUE
       AND ps.supplier_sku IS NOT NULL
     WHERE sc.supplier_name = 'AliExpress'
       AND sc.state = 'imported_to_catalog'
       AND sc.product_id IS NOT NULL
       AND sc.normalized_source_contract IS NOT NULL
       AND COALESCE(sc.scan_result->>'sourcing_decision', '') IN ('TEST', 'PRIORITY')
     ORDER BY sc.updated_at DESC, ps.stock DESC NULLS LAST
     LIMIT 80
  `);
  return rows;
}

function selectSnapshot(rows) {
  const failures = [];
  for (const row of rows) {
    try {
      const resolved = preflight.resolveOrderableUnit(
        row.normalized_source_contract,
        row.supplier_sku,
        1,
        { requireOrderIdentity: false }
      );
      if (!resolved.raw_sku_id) {
        failures.push({
          candidate_id: row.candidate_id,
          supplier_sku: row.supplier_sku,
          error: 'sku_id natif AliExpress absent pour freight.get',
        });
        continue;
      }
      return { row, resolved };
    } catch (error) {
      failures.push({ candidate_id: row.candidate_id, supplier_sku: row.supplier_sku, error: error.message });
    }
  }
  const err = new Error(`Aucun SKU AliExpress promu avec sku_id natif pour la preuve freight.get (${failures.length} essais)`);
  err.failures = failures.slice(0, 8);
  throw err;
}

function priceDeltaPct(snapshot, live) {
  if (!(snapshot > 0) || !(live > 0)) return null;
  return Number((((live - snapshot) / snapshot) * 100).toFixed(2));
}

async function run(env = process.env) {
  const rt = guard(env);
  const rows = await candidateRows();
  const selected = selectSnapshot(rows);
  const { row, resolved: snapshotResolved } = selected;
  const countryCode = String(env.KOMERCE_ALIEXPRESS_COUNTRY_CODE || 'KM').toUpperCase();

  const providerEnv = await connected.managedRuntimeEnv({ env });
  const liveFetch = await connected.fetchProducts({
    env: providerEnv,
    productIds: [row.supplier_product_id],
    countryCode,
  });
  const liveContract = liveFetch.products?.[0];
  if (!liveContract) throw new Error(`AliExpress live n'a pas renvoyé le produit ${row.supplier_product_id}`);
  const liveResolved = preflight.resolveOrderableUnit(
    liveContract,
    row.supplier_sku,
    1,
    { requireOrderIdentity: true }
  );

  let freight;
  try {
    const freightParams = preflight.buildFreightBusinessParams(liveResolved, {
      country_code: countryCode,
      province_code: env.KOMERCE_ALIEXPRESS_PREPAYMENT_PROVINCE_CODE || null,
      city_code: env.KOMERCE_ALIEXPRESS_PREPAYMENT_CITY_CODE || null,
      send_goods_country_code: env.KOMERCE_ALIEXPRESS_SEND_GOODS_COUNTRY_CODE || null,
    });
    const freightPayload = await connected.invokeTop(preflight.METHODS.FREIGHT, freightParams, {
      env: providerEnv,
    });
    freight = {
      method: preflight.METHODS.FREIGHT,
      invoked: true,
      permission: 'call-succeeded',
      summary: preflight.summarizeFreightResponse(freightPayload),
    };
  } catch (error) {
    freight = {
      method: preflight.METHODS.FREIGHT,
      invoked: false,
      permission: 'call-failed',
      error_class: preflight.classifyApiError(error),
      error: String(error.message || error).slice(0, 600),
    };
  }

  const address = parseAddress(env);
  let placeOrderPayloadReady = false;
  if (address) {
    preflight.buildPlaceOrderBusinessParams(liveResolved, address, {
      logistics_service_name: env.KOMERCE_ALIEXPRESS_PREPAYMENT_LOGISTICS_SERVICE || null,
      order_memo: `Komerce staging prepayment proof ${row.product_id}`,
    });
    placeOrderPayloadReady = true;
  }

  const out = {
    runtime: rt,
    proof: 'aliexpress-prepayment-v2',
    candidate: {
      candidate_id: row.candidate_id,
      product_id: row.product_id,
      product_sku_id: row.product_sku_id,
      supplier_product_id: row.supplier_product_id,
      supplier_sku: row.supplier_sku,
      native_sku_id: liveResolved.raw_sku_id,
      sku_attr: liveResolved.sku_attr,
    },
    snapshot: {
      stock: snapshotResolved.stock_available,
      unit_price: snapshotResolved.unit_price,
      currency: snapshotResolved.currency,
    },
    live: {
      stock: liveResolved.stock_available,
      unit_price: liveResolved.unit_price,
      currency: liveResolved.currency,
      price_delta_pct: priceDeltaPct(snapshotResolved.unit_price, liveResolved.unit_price),
      exact_sku_resolved: true,
    },
    freight,
    place_order: {
      method: preflight.METHODS.PLACE_ORDER,
      invoked: false,
      payload_ready: placeOrderPayloadReady,
      address_configured: Boolean(address),
      gate: 'HARD_STOP_BEFORE_SUPPLIER_ORDER',
    },
    order_detail: { method: preflight.METHODS.ORDER_DETAIL, invoked: false },
    tracking: { method: preflight.METHODS.TRACKING, invoked: false },
    payment: {
      invoked: false,
      implemented_by_this_proof: false,
      gate: 'CLOSED',
    },
  };

  console.log(`[aliexpress-prepayment-proof] ${JSON.stringify(out)}`);
  return out;
}

if (require.main === module) {
  run()
    .catch((error) => {
      console.error(`[aliexpress-prepayment-proof] FAILED: ${error.stack || error}`);
      if (error.failures) console.error(`[aliexpress-prepayment-proof] failures=${JSON.stringify(error.failures)}`);
      process.exitCode = 1;
    })
    .finally(() => db.pool.end());
}

module.exports = {
  PROOF_FLAG,
  truthy,
  runtime,
  guard,
  parseAddress,
  selectSnapshot,
  priceDeltaPct,
  run,
};