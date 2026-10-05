#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          cj-p2-grouped-parent-sandbox-proof
 * @domain        purchasing
 * @layer         script
 * @criticality   high
 * @inputs        CJ sandbox credentials, exact CJ product with >=2 supplier VIDs
 * @outputs       multi-line create -> real shipmentOrderId -> parent batch simulatePay proof
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

const ALLOW_FLAG = 'KOMERCE_ALLOW_CJ_P2_GROUPED_PARENT';
const PAYMENT_MODE_SIMULATE = 'simulatePay';
const PAYMENT_MODE_BALANCE_V2 = 'payBalanceV2';
const DEFAULT_PRODUCT_REF = 'KPR-131962';
const DEFAULT_DESTINATION = Object.freeze({
  postal_code: '10001',
  country_code: 'US',
  country: 'United States',
  province: 'New York',
  city: 'New York',
  customer_name: 'Komerce Sandbox Grouped',
  address1: '350 5th Ave',
  phone: '2127363100',
});
const CJ_MIN_CALL_GAP_MS = 1100;

function guard(env = process.env) {
  const runtime = String(env.KOMERCE_ENV || env.NODE_ENV || '').trim().toLowerCase();
  if (runtime === 'production') throw new Error('REFUS: CJ grouped parent proof interdit en production');
  if (env[ALLOW_FLAG] !== '1') throw new Error(`${ALLOW_FLAG}=1 requis`);
  if (env.KOMERCE_CJ_SANDBOX !== '1') throw new Error('KOMERCE_CJ_SANDBOX=1 requis');
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL requis');
}

async function selectTwoExactSkus(productRef) {
  const { rows } = await db.query(`
    SELECT p.product_ref,
           ps.id AS product_sku_id,
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
     ORDER BY ps.stock DESC NULLS LAST, ps.id
     LIMIT 2
  `, [productRef]);
  if (rows.length < 2) throw new Error('CJ_P2_GROUPED_TWO_SKUS_REQUIRED');
  return rows;
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
  catch (_) { throw new Error(`CJ_P2_GROUPED_NON_JSON_RESPONSE:${response.status}`); }
  if (!response.ok || payload?.result === false || payload?.success === false) {
    const error = new Error(
      `CJ_P2_GROUPED_HTTP_ERROR:${response.status}:${payload?.message || 'unknown'}`
    );
    error.payload = payload;
    throw error;
  }
  return payload;
}

async function resolveLogistic({ call, accessToken, vids, fromCountryCode, destination }) {
  const quote = await call(contract.ENDPOINTS.freight_calculate, {
    method: 'POST',
    body: {
      startCountryCode: fromCountryCode,
      endCountryCode: destination.country_code,
      products: vids.map(vid => ({ quantity: 1, vid })),
    },
    accessToken,
  });
  const routes = Array.isArray(quote?.data) ? quote.data
    .map(route => String(route?.logisticName || '').trim())
    .filter(Boolean) : [];
  if (!routes.length) throw new Error('CJ_P2_GROUPED_NO_COMMON_LOGISTIC_ROUTE');
  return routes[0];
}

async function createSandboxSubOrder({
  sku,
  identity,
  index,
  orderNumberBase,
  logisticName,
  fromCountryCode,
  call,
  accessToken,
}) {
  const orderNumber = `${orderNumberBase}-${index + 1}`.slice(0, 200);
  const payload = contract.buildCreateOrderV2Payload({
    orderNumber,
    identity: sku.supplier_order_identity,
    quantity: 1,
    destination: DEFAULT_DESTINATION,
    logisticName,
    fromCountryCode,
    platform: 'Api',
    storeLineItemId: String(sku.product_sku_id),
    remark: 'Komerce CJ grouped parent sandbox proof',
    sandbox: true,
  });

  const createBody = await call(contract.ENDPOINTS.create_order_v2, {
    method: 'POST',
    body: payload,
    accessToken,
  });
  const created = contract.parseCreateOrderResponse(createBody);

  const detailBody = await call(contract.ENDPOINTS.get_order_detail, {
    method: 'GET',
    query: contract.buildOrderDetailQuery(created.external_ref),
    accessToken,
  });
  const facts = contract.verifyOrderDetail({
    created,
    detail: detailBody,
    expectedOrderNumber: orderNumber,
    expectedVid: identity.vid,
    expectedQuantity: 1,
  });
  if (!facts.cj_order_code) {
    const error = new Error('CJ_P2_GROUPED_CJ_ORDER_CODE_MISSING');
    error.readback = facts;
    throw error;
  }
  return { created, facts, orderNumber, cjOrderCode: facts.cj_order_code };
}

async function run(env = process.env, deps = {}) {
  guard(env);
  const skus = await (deps.selectTwoExactSkus || selectTwoExactSkus)(
    String(env.KOMERCE_CJ_P2_GROUPED_PRODUCT_REF || DEFAULT_PRODUCT_REF).trim()
  );
  const identities = skus.map(sku => contract.extractIdentity(sku.supplier_order_identity));
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

  const fromCountryCode = String(
    env.KOMERCE_CJ_P2_GROUPED_FROM_COUNTRY_CODE || 'CN'
  ).trim();
  const logisticName = await resolveLogistic({
    call,
    accessToken,
    vids: identities.map(identity => identity.vid),
    fromCountryCode,
    destination: DEFAULT_DESTINATION,
  });
  const orderNumberBase = String(
    env.KOMERCE_CJ_P2_GROUPED_ORDER_NUMBER || `KOM-P2G-${Date.now()}`
  ).slice(0, 180);

  const subOrders = [];
  for (let index = 0; index < skus.length; index += 1) {
    subOrders.push(await createSandboxSubOrder({
      sku: skus[index],
      identity: identities[index],
      index,
      orderNumberBase,
      logisticName,
      fromCountryCode,
      call,
      accessToken,
    }));
  }

  const cjOrderCodes = subOrders.map(order => order.cjOrderCode);

  const addCartBody = await call(contract.ENDPOINTS.add_cart, {
    method: 'POST',
    body: contract.buildCartPayload(cjOrderCodes),
    accessToken,
  });
  if (addCartBody?.success !== true || Number(addCartBody?.data?.successCount || 0) < 2) {
    const error = new Error('CJ_P2_GROUPED_ADD_CART_REJECTED');
    error.payload = addCartBody;
    throw error;
  }

  const confirmCartBody = await call(contract.ENDPOINTS.add_cart_confirm, {
    method: 'POST',
    body: contract.buildCartPayload(cjOrderCodes),
    accessToken,
  });
  const cartConfirmed = contract.parseAddCartConfirmResponse(confirmCartBody);
  if (cartConfirmed.success_count < subOrders.length || cartConfirmed.intercept_orders.length) {
    const error = new Error('CJ_P2_GROUPED_CART_CONFIRM_INCOMPLETE');
    error.payload = confirmCartBody;
    throw error;
  }

  const parentBody = await call(contract.ENDPOINTS.save_generate_parent_order, {
    method: 'POST',
    body: { shipmentOrderId: cartConfirmed.shipment_order_id },
    accessToken,
  });
  const parent = contract.parseSaveGenerateParentOrderResponse(
    parentBody,
    cartConfirmed.shipment_order_id
  );

  const amountReconciliation = contract.reconcileSandboxParentAmount(parent);

  const paymentMode = String(
    env.KOMERCE_CJ_P2_GROUPED_PAYMENT_MODE || PAYMENT_MODE_SIMULATE
  ).trim();

  let payment;
  if (paymentMode === PAYMENT_MODE_BALANCE_V2) {
    const payBody = await call(contract.ENDPOINTS.pay_balance_v2, {
      method: 'POST',
      body: contract.buildPayBalanceV2Payload(parent.shipment_order_id, parent.pay_id),
      accessToken,
    });
    payment = {
      ...contract.parsePayBalanceV2Response(payBody),
      sandbox: true,
      real_charge_possible: false,
      payment_mode: 'sandbox_payBalanceV2',
    };
  } else if (paymentMode === PAYMENT_MODE_SIMULATE) {
    const payBody = await call(contract.ENDPOINTS.sandbox_simulate_pay, {
      method: 'POST',
      body: contract.buildSandboxSimulatePayParentPayload(parent.shipment_order_id),
      accessToken,
    });
    payment = {
      ...contract.parseSandboxSimulatePayResponse(payBody),
      payment_mode: 'sandbox_simulate_pay_shipment_order_id',
    };
  } else {
    throw new Error('CJ_P2_GROUPED_PAYMENT_MODE_UNSUPPORTED');
  }

  const paidStatuses = [];
  for (const subOrder of subOrders) {
    const afterPay = await call(contract.ENDPOINTS.get_order_detail, {
      method: 'GET',
      query: contract.buildOrderDetailQuery(subOrder.created.external_ref),
      accessToken,
    });
    const paidFacts = contract.verifyPaidOrderDetail(
      afterPay,
      subOrder.created.external_ref,
      subOrder.orderNumber
    );
    paidStatuses.push(paidFacts.status);
  }

  const result = {
    proof: 'CJ_P2_GROUPED_PARENT_SANDBOX',
    sandbox: true,
    real_charge_possible: false,
    sub_order_ids: subOrders.map(order => order.created.external_ref),
    cj_order_codes: cjOrderCodes,
    shipment_order_id: parent.shipment_order_id,
    pay_id: parent.pay_id,
    item_count: identities.length,
    logistic_name: logisticName,
    paid_statuses: paidStatuses,
    cart_submit_success: cartConfirmed.submit_success,
    cart_result: cartConfirmed.result,
    payment_verdict: payment.payment_verdict,
    payment_mode: payment.payment_mode,
    amount_reconciliation: amountReconciliation,
  };
  console.log(`[cj-p2-grouped-parent-sandbox-proof] ${JSON.stringify(result)}`);
  return result;
}

if (require.main === module) {
  run()
    .catch((error) => {
      console.error(`[cj-p2-grouped-parent-sandbox-proof] FAILED: ${error.stack || error}`);
      if (error.payload) {
        console.error(
          `[cj-p2-grouped-parent-sandbox-proof] provider=${JSON.stringify(error.payload)}`
        );
      }
      if (error.readback) {
        console.error(
          `[cj-p2-grouped-parent-sandbox-proof] readback=${JSON.stringify(error.readback)}`
        );
      }
      process.exitCode = 1;
    })
    .finally(() => db.pool.end());
}

module.exports = {
  ALLOW_FLAG,
  PAYMENT_MODE_SIMULATE,
  PAYMENT_MODE_BALANCE_V2,
  CJ_MIN_CALL_GAP_MS,
  DEFAULT_DESTINATION,
  guard,
  selectTwoExactSkus,
  invoke,
  resolveLogistic,
  createSandboxSubOrder,
  run,
};
