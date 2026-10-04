#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          cj-p1-create-readback-proof
 * @domain        purchasing
 * @layer         script
 * @criticality   high
 * @inputs        exact CJ product/SOI, sandbox destination, live CJ API credentials
 * @outputs       bounded createOrderV2 + exact getOrderDetail proof
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

const ALLOW_FLAG = 'KOMERCE_ALLOW_CJ_P1_CREATE_READBACK';
const DEFAULT_PRODUCT_REF = 'KPR-131962';

function truthy(v) {
  return ['1', 'true', 'yes'].includes(String(v || '').trim().toLowerCase());
}

function guard(env = process.env) {
  if (!truthy(env[ALLOW_FLAG])) throw new Error(`${ALLOW_FLAG}=1 requis`);
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL requis');
  return true;
}

function parseDestination(env = process.env) {
  const raw = String(env.KOMERCE_CJ_P1_DESTINATION_JSON || '').trim();
  if (!raw) throw new Error('KOMERCE_CJ_P1_DESTINATION_JSON requis');
  let parsed;
  try { parsed = JSON.parse(raw); } catch (_) { throw new Error('KOMERCE_CJ_P1_DESTINATION_JSON invalide'); }
  return parsed;
}

async function selectExactSku(productRef, productSkuId = null) {
  const params = [productRef];
  let skuFilter = '';
  if (productSkuId) {
    params.push(productSkuId);
    skuFilter = 'AND ps.id = $2';
  }
  const { rows } = await db.query(`
    SELECT p.product_ref,
           p.id AS product_id,
           ps.id AS product_sku_id,
           ps.supplier_sku,
           ps.supplier_unit_ref,
           ps.supplier_order_identity,
           ps.stock
      FROM products p
      JOIN product_skus ps ON ps.product_id = p.id
     WHERE p.product_ref = $1
       AND ps.source = 'SUPPLIER'
       AND ps.is_active = TRUE
       AND ps.supplier_order_identity->>'provider' = 'cj'
       AND ps.supplier_unit_ref IS NOT NULL
       ${skuFilter}
     ORDER BY ps.stock DESC NULLS LAST, ps.id
     LIMIT 2
  `, params);

  if (!rows.length) throw new Error('CJ_P1_EXACT_SKU_NOT_FOUND');
  if (productSkuId && rows.length !== 1) throw new Error('CJ_P1_EXACT_SKU_NOT_UNIQUE');
  return rows[0];
}

async function invoke(path, { method = 'GET', body = null, accessToken, query = null, fetchImpl = fetch } = {}) {
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
  try { payload = JSON.parse(text); } catch (_) { throw new Error(`CJ_P1_NON_JSON_RESPONSE:${response.status}`); }
  if (!response.ok || payload?.result === false) {
    const err = new Error(`CJ_P1_HTTP_ERROR:${response.status}:${payload?.message || 'unknown'}`);
    err.payload = payload;
    throw err;
  }
  return payload;
}

function readBackFacts(body) {
  const data = body?.data || {};
  const products = Array.isArray(data.productInfoList) ? data.productInfoList : [];
  return {
    order_id: data.orderId || data.cjOrderId || null,
    order_number: data.orderNumber || data.orderNum || data.platformOrderId || null,
    status: data.orderStatus || null,
    variants: products.flatMap((item) => {
      const direct = item.variantId ? [{ vid: String(item.variantId), quantity: Number(item.quantity) }] : [];
      const subs = Array.isArray(item.subOrderProducts)
        ? item.subOrderProducts.map((sub) => ({ vid: String(sub.variantId || ''), quantity: Number(sub.quantity) }))
        : [];
      return [...direct, ...subs].filter((x) => x.vid);
    }),
  };
}

function verifyReadBack({ created, detail, expectedOrderNumber, expectedVid, expectedQuantity }) {
  const facts = readBackFacts(detail);
  const sameOrder =
    facts.order_id === created.external_ref
    || facts.order_number === expectedOrderNumber
    || created.order_number === expectedOrderNumber;
  const variant = facts.variants.find((v) => v.vid === expectedVid && v.quantity === expectedQuantity);

  if (!sameOrder) throw new Error('CJ_P1_READBACK_ORDER_MISMATCH');
  if (!variant) throw new Error('CJ_P1_READBACK_VARIANT_MISMATCH');
  if (!['CREATED', 'IN_CART', 'UNPAID'].includes(String(facts.status || '').toUpperCase())) {
    throw new Error(`CJ_P1_UNEXPECTED_STATUS:${facts.status || 'UNKNOWN'}`);
  }
  return facts;
}

async function run(env = process.env, deps = {}) {
  guard(env);

  const productRef = String(env.KOMERCE_CJ_P1_PRODUCT_REF || DEFAULT_PRODUCT_REF).trim();
  const exactSku = await (deps.selectExactSku || selectExactSku)(
    productRef,
    String(env.KOMERCE_CJ_P1_PRODUCT_SKU_ID || '').trim() || null
  );
  const identity = exactSku.supplier_order_identity;
  const { vid } = contract.extractIdentity(identity);

  const orderNumber = String(env.KOMERCE_CJ_P1_ORDER_NUMBER || `KOM-P1-${exactSku.product_sku_id}`).slice(0, 50);
  const destination = parseDestination(env);
  const logisticName = String(env.KOMERCE_CJ_P1_LOGISTIC_NAME || '').trim();
  const fromCountryCode = String(env.KOMERCE_CJ_P1_FROM_COUNTRY_CODE || '').trim();

  const createPayload = contract.buildCreateOrderV2Payload({
    orderNumber,
    identity,
    quantity: 1,
    destination,
    logisticName,
    fromCountryCode,
    platform: 'Api',
    storeLineItemId: exactSku.product_sku_id,
    remark: 'Komerce CJ P1 sandbox create/read-back proof — no payment',
    sandbox: true,
  });

  if (createPayload.payType !== 3 || createPayload.isSandbox !== 1) {
    throw new Error('CJ_P1_GUARD_PAYTYPE_OR_SANDBOX');
  }

  const accessToken = await cj.getAccessToken({ env });
  const call = deps.invoke || invoke;

  const createBody = await call(contract.ENDPOINTS.create_order_v2, {
    method: 'POST',
    body: createPayload,
    accessToken,
  });
  const created = contract.parseCreateOrderResponse(createBody);

  const detailBody = await call(contract.ENDPOINTS.get_order_detail, {
    method: 'GET',
    query: contract.buildOrderDetailQuery(created.external_ref),
    accessToken,
  });

  const readback = verifyReadBack({
    created,
    detail: detailBody,
    expectedOrderNumber: orderNumber,
    expectedVid: vid,
    expectedQuantity: 1,
  });

  const result = {
    proof: 'CJ_P1_CREATE_READBACK',
    sandbox: true,
    payment_invoked: false,
    confirmation_invoked: false,
    product_ref: exactSku.product_ref,
    product_sku_id: exactSku.product_sku_id,
    supplier_sku: exactSku.supplier_sku,
    supplier_unit_ref: exactSku.supplier_unit_ref,
    order_number: orderNumber,
    cj_order_id: created.external_ref,
    commitment_verdict: created.commitment_verdict,
    readback_status: readback.status,
    exact_vid_verified: true,
    exact_quantity_verified: true,
  };

  console.log(`[cj-p1-create-readback-proof] ${JSON.stringify(result)}`);
  return result;
}

if (require.main === module) {
  run()
    .catch((error) => {
      console.error(`[cj-p1-create-readback-proof] FAILED: ${error.stack || error}`);
      if (error.payload) console.error(`[cj-p1-create-readback-proof] provider=${JSON.stringify(error.payload)}`);
      process.exitCode = 1;
    })
    .finally(() => db.pool.end());
}

module.exports = {
  ALLOW_FLAG,
  DEFAULT_PRODUCT_REF,
  truthy,
  guard,
  parseDestination,
  selectExactSku,
  invoke,
  readBackFacts,
  verifyReadBack,
  run,
};
