#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          aliexpress-business-order-golden-proof
 * @domain        purchasing
 * @layer         script
 * @criticality   high
 * @inputs        explicit product_sku_id, managed AliExpress OAuth, explicit proof destination
 * @outputs       one-shot real unpaid AliExpress create + mandatory read-back proof
 * @depends       db.js, canonical-unit-purchasing-gate, execution-adapter-registry
 * @db-read       canonical sourcing/product SKU reads, supplier_oauth_connections
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/ALIEXPRESS_BUSINESS_READINESS.md, docs/doctrine/DOCTRINE_PURCHASING_PROVIDER_GOLDEN_E2E.md
 * @impact-areas  purchasing, supplier-integration, e2e
 */
'use strict';

const db = require('../db');
const readinessProof = require('./aliexpress-readiness-golden-proof');
const { evaluateCanonicalProcurementReadiness } = require('../services/suppliers/canonical-unit-purchasing-gate');
const { EXECUTION_ADAPTER_REGISTRY } = require('../services/suppliers/execution-adapter-registry');

const PROOF_FLAG = 'KOMERCE_ALLOW_ALIEXPRESS_ORDER_PROOF';
const DESTINATION_ENV = 'KOMERCE_ALIEXPRESS_ORDER_PROOF_DESTINATION_JSON';

function truthy(value) {
  return ['1', 'true', 'yes'].includes(String(value || '').trim().toLowerCase());
}

function guard(env = process.env) {
  const runtime = String(env.KOMERCE_ENV || env.NODE_ENV || '').trim().toLowerCase() || 'unknown';
  if (runtime === 'production') throw new Error('REFUS: Golden AliExpress order interdit en production');
  if (!truthy(env[PROOF_FLAG])) throw new Error(`${PROOF_FLAG}=1 requis`);
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL requis');
  if (!env.ALIEXPRESS_APP_KEY || !env.ALIEXPRESS_APP_SECRET || !env.ALIEXPRESS_TOKEN_ENCRYPTION_KEY) {
    throw new Error('ALIEXPRESS_MANAGED_OAUTH_REQUIRED');
  }
  return runtime;
}

function parseDestination(env = process.env, adapter) {
  let value;
  try {
    value = JSON.parse(String(env[DESTINATION_ENV] || ''));
  } catch {
    throw new Error(`${DESTINATION_ENV}_INVALID`);
  }
  if (!value || typeof value !== 'object') throw new Error(`${DESTINATION_ENV}_INVALID`);
  // Validation provider-owned; no address is ever logged by this proof.
  adapter.normalizePlaceOrderAddress(value);
  return value;
}

async function run(argv = process.argv.slice(2), {
  env = process.env,
  query = db.query.bind(db),
  readiness = evaluateCanonicalProcurementReadiness,
  adapters = EXECUTION_ADAPTER_REGISTRY,
} = {}) {
  if (!Array.isArray(argv) || argv.length !== 1) {
    throw new Error('Usage: node scripts/aliexpress-business-order-golden-proof.js PRODUCT_SKU_ID');
  }

  const runtime = guard(env);
  const productSkuId = readinessProof.requireUuid(argv[0]);
  const soldSku = await readinessProof.loadSoldSku(query, productSkuId);
  const adapter = adapters.aliexpress;
  if (!adapter || typeof adapter.buildOrderPayload !== 'function' || typeof adapter.placeOrder !== 'function') {
    throw new Error('ALIEXPRESS_EXECUTION_ADAPTER_INCOMPLETE');
  }
  const destination = parseDestination(env, require('../services/suppliers/aliexpress-purchase-preflight'));

  const verdict = await readiness({
    productSkuId,
    quantity: 1,
    soldIdentity: soldSku.supplier_order_identity,
    query,
    adapters,
    context: {
      env,
      aliexpress_execution_authorized: true,
    },
  });

  const evidence = readinessProof.assertA2(verdict, soldSku);
  if (evidence.auto_order_ready !== true) throw new Error('ALIEXPRESS_AUTO_ORDER_NOT_READY');

  const payload = await adapter.buildOrderPayload({
    items: [{
      identity: verdict.identity,
      supplier_unit_ref: verdict.supplier_unit_ref,
      quantity: 1,
      canonical_unit: verdict.canonical_unit,
    }],
    preflights: [verdict.preflight],
    context: { procurement_destination: destination },
  });

  // Exactly one provider mutation attempt. No retry is allowed because no
  // Komerce-controlled native idempotency key has been proved for placeOrder.
  const execution = await adapter.placeOrder(payload, {
    env,
    aliexpress_execution_authorized: true,
  });

  if (!execution?.supplier_order_id) throw new Error('ALIEXPRESS_ORDER_PROOF_ID_MISSING');
  if (execution.commitment_verdict !== 'created_unpaid') throw new Error('ALIEXPRESS_ORDER_PROOF_NOT_UNPAID');
  if (execution.payment_invoked !== false) throw new Error('ALIEXPRESS_ORDER_PROOF_PAYMENT_MUST_BE_FALSE');
  if (!Array.isArray(execution.readback_orders) || execution.readback_orders.length < 1) {
    throw new Error('ALIEXPRESS_ORDER_PROOF_READBACK_MISSING');
  }

  const report = {
    status: 'PASS',
    proof: 'ALIEXPRESS_BUSINESS_ORDER_CREATE_READBACK',
    runtime,
    provider: 'aliexpress',
    product_sku_id: productSkuId,
    supplier_unit_ref: verdict.supplier_unit_ref,
    supplier_order_id: execution.supplier_order_id,
    supplier_order_ids: execution.supplier_order_ids,
    readback_status: execution.readback_status,
    commitment_verdict: execution.commitment_verdict,
    execution_recovery: execution.execution_recovery,
    mutation: {
      place_order_invoked: true,
      payment_invoked: false,
    },
  };

  console.log(`[aliexpress-business-order-golden-proof] ${JSON.stringify(report)}`);
  return report;
}

if (require.main === module) {
  run()
    .catch((error) => {
      console.error(`[aliexpress-business-order-golden-proof] FAILED: ${error.stack || error}`);
      process.exitCode = 1;
    })
    .finally(() => db.pool.end());
}

module.exports = { PROOF_FLAG, DESTINATION_ENV, truthy, guard, parseDestination, run };
