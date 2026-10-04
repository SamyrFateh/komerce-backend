#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          cj-p2-confirm-pay-sandbox-proof
 * @domain        purchasing
 * @layer         script
 * @criticality   high
 * @inputs        CJ sandbox credentials, exact CJ product/SOI, sandbox destination
 * @outputs       create -> confirm -> sandbox simulatePay(orderId) -> paid read-back proof
 * @depends       db.js, services/suppliers/connectors/cj-connector.js, services/suppliers/cj-purchasing-contract.js
 * @db-read       products, product_skus
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/external-providers/suppliers/CJ_PURCHASING_CONTRACT.md
 * @impact-areas  purchasing, supplier-integration
 */
'use strict';

const db = require('../db');
const cj = require('../services/suppliers/connectors/cj-connector');
const contract = require('../services/suppliers/cj-purchasing-contract');

const ALLOW_FLAG = 'KOMERCE_ALLOW_CJ_P2_CONFIRM_PAY';
const DEFAULT_PRODUCT_REF = 'KPR-131962';
const FREIGHT_PATH = '/logistic/freightCalculate';
const CJ_MIN_CALL_GAP_MS = 1100;

function guard(env = process.env) {
  const runtime = String(env.KOMERCE_ENV || env.NODE_ENV || '').trim().toLowerCase();
  if (runtime === 'production') throw new Error('REFUS: CJ P2 confirm/pay interdit en production');
  if (env[ALLOW_FLAG] !== '1') throw new Error(`${ALLOW_FLAG}=1 requis`);
  if (env.KOMERCE_CJ_SANDBOX !== '1') throw new Error('KOMERCE_CJ_SANDBOX=1 requis');
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL requis');
}

const DEFAULT_DESTINATION = Object.freeze({
  postal_code: '10001',
  country_code: 'US',
  country: 'United States',
  province: 'New York',
  city: 'New York',
  customer_name: 'Komerce Sandbox',
  address1: '350 5th Ave',
  phone: '2127363100',
});

async function selectExactSku(productRef) {
  const { rows } = await db.query(`
    SELECT p.product_ref,
           ps.id AS product_sku_id,
           ps.supplier_sku,
           ps.supplier_unit_ref,
           ps.supplier_order_identity
      FROM products p
      JOIN product_skus ps ON ps.product_id = p.id
     WHERE p.product_ref = $1
       AND ps.source = 'SUPPLIER'
       AND ps.is_active = TRUE
       AND ps.supplier_order_identity->>'provider' = 'cj'
       AND ps.supplier_unit_ref IS NOT NULL
     ORDER BY ps.stock DESC NULLS LAST, ps.id
     LIMIT 1
  `, [productRef]);
  if (!rows[0]) throw new Error('CJ_P2_EXACT_SKU_NOT_FOUND');
  return rows[0];
}

async function invoke(path, { method = 'GET', body = null, query = null, accessToken, fetchImpl = fetch } = {}) {
  const url = new URL(`${cj.BASE_URL}${path.replace('/api2.0/v1', '')}`);
  if (query) Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  const response = await fetchImpl(url, {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'CJ-Access-Token': accessToken,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); }
  catch (_) { throw new Error(`CJ_P2_NON_JSON_RESPONSE:${response.status}`); }
  if (!response.ok || payload?.result === false) {
    const error = new Error(`CJ_P2_HTTP_ERROR:${response.status}:${payload?.message || 'unknown'}`);
    error.payload = payload;
    throw error;
  }
  return payload;
}

async function resolveLogistic({ call, accessToken, vid, fromCountryCode, destination, preferred }) {
  const quote = await call(FREIGHT_PATH, {
    method: 'POST',
    body: {
      startCountryCode: fromCountryCode,
      endCountryCode: destination.country_code,
      products: [{ quantity: 1, vid }],
    },
    accessToken,
  });
  const routes = Array.isArray(quote?.data) ? quote.data
    .map(route => String(route?.logisticName || '').trim())
    .filter(Boolean) : [];
  if (!routes.length) throw new Error('CJ_P2_NO_LOGISTIC_ROUTE');
  if (preferred && routes.includes(preferred)) return preferred;
  return routes[0];
}

async function run(env = process.env, deps = {}) {
  guard(env);
  const sku = await (deps.selectExactSku || selectExactSku)(
    String(env.KOMERCE_CJ_P2_PRODUCT_REF || DEFAULT_PRODUCT_REF).trim()
  );
  const accessToken = await cj.getAccessToken({ env });
  const rawCall = deps.invoke || invoke;
  const sleep = deps.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  let lastCallAt = 0;
  const call = async (...args) => {
    const waitMs = CJ_MIN_CALL_GAP_MS - (Date.now() - lastCallAt);
    if (waitMs > 0) await sleep(waitMs);
    try {
      return await rawCall(...args);
    } finally {
      lastCallAt = Date.now();
    }
  };
  const orderNumber = String(
    env.KOMERCE_CJ_P2_ORDER_NUMBER || `KOM-P2-${sku.product_sku_id}-${Date.now()}`
  ).slice(0, 200);

  const identity = contract.extractIdentity(sku.supplier_order_identity);
  const fromCountryCode = String(env.KOMERCE_CJ_P2_FROM_COUNTRY_CODE || 'CN').trim();
  const preferredLogistic = String(env.KOMERCE_CJ_P2_LOGISTIC_NAME || '').trim();
  const logisticName = await (deps.resolveLogistic || resolveLogistic)({
    call,
    accessToken,
    vid: identity.vid,
    fromCountryCode,
    destination: DEFAULT_DESTINATION,
    preferred: preferredLogistic || null,
  });

  const createPayload = contract.buildCreateOrderV2Payload({
    orderNumber,
    identity: sku.supplier_order_identity,
    quantity: 1,
    destination: DEFAULT_DESTINATION,
    logisticName,
    fromCountryCode,
    platform: 'Api',
    storeLineItemId: sku.product_sku_id,
    remark: 'Komerce CJ P2 sandbox confirm + simulated balance pay proof',
    sandbox: true,
  });
  if (createPayload.payType !== 3 || createPayload.isSandbox !== 1) {
    throw new Error('CJ_P2_CREATE_GUARD_FAILED');
  }

  const createBody = await call(contract.ENDPOINTS.create_order_v2, {
    method: 'POST', body: createPayload, accessToken,
  });
  const created = contract.parseCreateOrderResponse(createBody);

  const beforeConfirm = await call(contract.ENDPOINTS.get_order_detail, {
    method: 'GET', query: contract.buildOrderDetailQuery(created.external_ref), accessToken,
  });
  contract.verifyOrderDetail({
    created,
    detail: beforeConfirm,
    expectedOrderNumber: orderNumber,
    expectedVid: identity.vid,
    expectedQuantity: 1,
  });

  const confirmBody = await call(contract.ENDPOINTS.confirm_order, {
    method: 'PATCH',
    body: contract.buildConfirmOrderPayload(created.external_ref),
    accessToken,
  });
  const confirmed = contract.parseConfirmOrderResponse(confirmBody, created.external_ref);

  const afterConfirm = await call(contract.ENDPOINTS.get_order_detail, {
    method: 'GET', query: contract.buildOrderDetailQuery(created.external_ref), accessToken,
  });
  const confirmFacts = contract.readOrderDetailFacts(afterConfirm);
  if (String(confirmFacts.status || '').toUpperCase() !== 'UNPAID') {
    throw new Error(`CJ_P2_EXPECTED_UNPAID_AFTER_CONFIRM:${confirmFacts.status || 'UNKNOWN'}`);
  }

  const payBody = await call(contract.ENDPOINTS.sandbox_simulate_pay, {
    method: 'POST',
    body: contract.buildSandboxSimulatePayPayload(created.external_ref),
    accessToken,
  });
  const payment = contract.parseSandboxSimulatePayResponse(payBody);

  const afterPay = await call(contract.ENDPOINTS.get_order_detail, {
    method: 'GET', query: contract.buildOrderDetailQuery(created.external_ref), accessToken,
  });
  const paidFacts = contract.verifyPaidOrderDetail(afterPay, created.external_ref, orderNumber);

  const result = {
    proof: 'CJ_P2_CONFIRM_PAY_SANDBOX',
    sandbox: true,
    real_charge_possible: false,
    order_number: orderNumber,
    cj_order_id: created.external_ref,
    cj_order_id: created.external_ref,
    confirm_status: confirmFacts.status,
    paid_status: paidFacts.status,
    confirmation_verdict: confirmed.confirmation_verdict,
    payment_verdict: payment.payment_verdict,
    payment_mode: 'sandbox_simulate_pay_order_id',
    logistic_name: logisticName,
  };
  console.log(`[cj-p2-confirm-pay-sandbox-proof] ${JSON.stringify(result)}`);
  return result;
}

if (require.main === module) {
  run()
    .catch((error) => {
      console.error(`[cj-p2-confirm-pay-sandbox-proof] FAILED: ${error.stack || error}`);
      if (error.payload) console.error(`[cj-p2-confirm-pay-sandbox-proof] provider=${JSON.stringify(error.payload)}`);
      process.exitCode = 1;
    })
    .finally(() => db.pool.end());
}

module.exports = { ALLOW_FLAG, FREIGHT_PATH, CJ_MIN_CALL_GAP_MS, guard, DEFAULT_DESTINATION, selectExactSku, invoke, resolveLogistic, run };
