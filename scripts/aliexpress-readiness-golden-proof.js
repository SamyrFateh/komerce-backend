#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          aliexpress-readiness-golden-proof
 * @domain        purchasing
 * @layer         script
 * @criticality   high
 * @inputs        explicit product_sku_id, canonical unit, live AliExpress readiness
 * @outputs       Golden A2 readiness report (exact unit, live stock/price/freight, no provider mutation)
 * @depends       db.js, services/suppliers/canonical-unit-purchasing-gate.js, services/suppliers/execution-adapter-registry.js
 * @db-read       delegated canonical sourcing/product SKU reads
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_PURCHASING_PROVIDER_GOLDEN_E2E.md, docs/doctrine/DOCTRINE_CANONICAL_UNIT_PURCHASING.md
 * @impact-areas  purchasing, supplier-integration, e2e
 */
'use strict';

const db = require('../db');
const { evaluateCanonicalProcurementReadiness } = require('../services/suppliers/canonical-unit-purchasing-gate');
const { EXECUTION_ADAPTER_REGISTRY } = require('../services/suppliers/execution-adapter-registry');

const PROOF_FLAG = 'KOMERCE_ALLOW_ALIEXPRESS_READINESS_PROOF';

function truthy(value) {
  return ['1', 'true', 'yes'].includes(String(value || '').trim().toLowerCase());
}

function guard(env = process.env) {
  const runtime = String(env.KOMERCE_ENV || env.NODE_ENV || '').trim().toLowerCase() || 'unknown';
  if (runtime === 'production') throw new Error('REFUS: Golden A2 AliExpress interdit en production');
  if (!truthy(env[PROOF_FLAG])) throw new Error(`${PROOF_FLAG}=1 requis`);
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL requis');
  return runtime;
}

function requireUuid(value, name = 'product_sku_id') {
  const id = String(value || '').trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) {
    throw new Error(`${name.toUpperCase()}_INVALID`);
  }
  return id;
}

async function loadSoldSku(query, productSkuId) {
  const { rows } = await query(
    `SELECT id, product_id, supplier_sku, supplier_unit_ref, supplier_order_identity
       FROM product_skus
      WHERE id = $1
        AND is_active = TRUE
      LIMIT 2`,
    [productSkuId]
  );
  if (rows.length !== 1) throw new Error(`ALIEXPRESS_READINESS_SKU_NOT_EXACT_${rows.length}`);
  const row = rows[0];
  if (!row.supplier_order_identity || row.supplier_order_identity.provider !== 'aliexpress') {
    throw new Error('ALIEXPRESS_READINESS_PROVIDER_MISMATCH');
  }
  if (!row.supplier_sku || !row.supplier_unit_ref) {
    throw new Error('ALIEXPRESS_READINESS_IDENTITY_INCOMPLETE');
  }
  return row;
}

function assertA2(verdict, soldSku) {
  if (!verdict || verdict.ready !== true || verdict.status !== 'FULFILLMENT_READY') {
    throw new Error(`ALIEXPRESS_READINESS_NOT_READY:${verdict?.status || 'UNKNOWN'}:${verdict?.reason || 'UNKNOWN'}`);
  }
  if (verdict.provider !== 'aliexpress') throw new Error('ALIEXPRESS_READINESS_PROVIDER_DIVERGED');
  if (!verdict.preflight?.ready) throw new Error('ALIEXPRESS_READINESS_REMOTE_PREFLIGHT_MISSING');
  if (verdict.place_order_invoked !== false) throw new Error('ALIEXPRESS_READINESS_PLACE_ORDER_MUST_BE_FALSE');

  const evidence = verdict.preflight.evidence || {};
  if (evidence.provider !== 'aliexpress') throw new Error('ALIEXPRESS_READINESS_EVIDENCE_PROVIDER_MISMATCH');
  if (evidence.exact_unit_resolved !== true) throw new Error('ALIEXPRESS_READINESS_EXACT_UNIT_NOT_PROVEN');
  if (!(Number(evidence.stock_available) >= 1)) throw new Error('ALIEXPRESS_READINESS_LIVE_STOCK_INVALID');
  if (!(Number(evidence.unit_price) > 0)) throw new Error('ALIEXPRESS_READINESS_LIVE_PRICE_INVALID');
  if (!String(evidence.currency || '').trim()) throw new Error('ALIEXPRESS_READINESS_LIVE_CURRENCY_MISSING');
  if (!String(evidence.supplier_origin_country_code || '').trim()) throw new Error('ALIEXPRESS_READINESS_ORIGIN_MISSING');
  if (!String(evidence.destination_country_code || '').trim()) throw new Error('ALIEXPRESS_READINESS_DESTINATION_MISSING');
  if (evidence.freight_available !== true) throw new Error('ALIEXPRESS_READINESS_FREIGHT_NOT_PROVEN');
  if (evidence.payment_invoked !== false) throw new Error('ALIEXPRESS_READINESS_PAYMENT_MUST_BE_FALSE');
  if (evidence.place_order_invoked !== false) throw new Error('ALIEXPRESS_READINESS_EVIDENCE_PLACE_ORDER_MUST_BE_FALSE');
  if (verdict.supplier_unit_ref !== soldSku.supplier_unit_ref) throw new Error('ALIEXPRESS_READINESS_UNIT_REF_MISMATCH');

  return evidence;
}

async function run(argv = process.argv.slice(2), {
  env = process.env,
  query = db.query.bind(db),
  readiness = evaluateCanonicalProcurementReadiness,
  adapters = EXECUTION_ADAPTER_REGISTRY,
} = {}) {
  if (!Array.isArray(argv) || argv.length !== 1) {
    throw new Error('Usage: node scripts/aliexpress-readiness-golden-proof.js PRODUCT_SKU_ID');
  }
  const runtime = guard(env);
  const productSkuId = requireUuid(argv[0]);
  const soldSku = await loadSoldSku(query, productSkuId);

  const verdict = await readiness({
    productSkuId,
    quantity: 1,
    soldIdentity: soldSku.supplier_order_identity,
    query,
    adapters,
    context: { env },
  });

  const evidence = assertA2(verdict, soldSku);
  const report = {
    status: 'PASS',
    proof: 'GOLDEN_E2E_A2_ALIEXPRESS_READINESS',
    runtime,
    product_sku_id: productSkuId,
    product_id: soldSku.product_id,
    supplier_sku: soldSku.supplier_sku,
    supplier_unit_ref: soldSku.supplier_unit_ref,
    provider: verdict.provider,
    canonical_unit_id: verdict.canonical_unit_id,
    canonical_money: verdict.money,
    live: {
      stock_available: evidence.stock_available,
      unit_price: evidence.unit_price,
      currency: evidence.currency,
      supplier_origin_country_code: evidence.supplier_origin_country_code,
      destination_country_code: evidence.destination_country_code,
      freight_available: true,
    },
    mutation: {
      place_order_invoked: false,
      payment_invoked: false,
    },
  };

  console.log(`[aliexpress-readiness-golden-proof] ${JSON.stringify(report)}`);
  return report;
}

if (require.main === module) {
  run()
    .catch((error) => {
      console.error(`[aliexpress-readiness-golden-proof] FAILED: ${error.stack || error}`);
      process.exitCode = 1;
    })
    .finally(() => db.pool.end());
}

module.exports = { PROOF_FLAG, truthy, guard, requireUuid, loadSoldSku, assertA2, run };
