#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          cj-real-debit-proof
 * @domain        purchasing
 * @layer         script
 * @criticality   critical
 * @inputs        exact CJ SKU, explicit real destination, hard debit cap, live CJ credentials
 * @outputs       one bounded real order + one payBalanceV2 + billingHistory debit observation
 * @depends       db.js, services/suppliers/connectors/cj-connector.js, services/suppliers/cj-purchasing-contract.js
 * @db-read       products, product_skus
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_SUPPLIER_PAYMENT_FACT.md
 * @impact-areas  purchasing, supplier-integration
 */
'use strict';

const db = require('../db');
const cj = require('../services/suppliers/connectors/cj-connector');
const contract = require('../services/suppliers/cj-purchasing-contract');

const ALLOW_FLAG = 'KOMERCE_ALLOW_CJ_REAL_DEBIT_PROOF';
const PAYMENT_FLAG = 'KOMERCE_ALLOW_CJ_REAL_PAYMENT';
const DEFAULT_PRODUCT_REF = 'KPR-131962';
const ABSOLUTE_MAX_USD = 20;

function req(env, key) {
  const v = String(env[key] || '').trim();
  if (!v) throw new Error(`${key}_REQUIRED`);
  return v;
}

function guard(env = process.env) {
  if (env[ALLOW_FLAG] !== '1') throw new Error(`${ALLOW_FLAG}=1 requis`);
  if (env[PAYMENT_FLAG] !== '1') throw new Error(`${PAYMENT_FLAG}=1 requis`);
  if (env.KOMERCE_CJ_SANDBOX === '1') throw new Error('CJ_REAL_PROOF_SANDBOX_FORBIDDEN');

  const cap = Number(env.KOMERCE_CJ_REAL_MAX_USD);
  if (!Number.isFinite(cap) || cap <= 0 || cap > ABSOLUTE_MAX_USD) {
    throw new Error('CJ_REAL_MAX_USD_INVALID');
  }

  for (const key of [
    'KOMERCE_CJ_REAL_RECIPIENT_NAME',
    'KOMERCE_CJ_REAL_RECIPIENT_PHONE',
    'KOMERCE_CJ_REAL_ADDRESS1',
    'KOMERCE_CJ_REAL_POSTAL_CODE',
    'KOMERCE_CJ_REAL_CITY',
    'KOMERCE_CJ_REAL_PROVINCE',
    'KOMERCE_CJ_REAL_COUNTRY',
    'KOMERCE_CJ_REAL_COUNTRY_CODE',
  ]) req(env, key);

  return cap;
}

function destination(env = process.env) {
  return {
    customer_name: req(env, 'KOMERCE_CJ_REAL_RECIPIENT_NAME'),
    phone: req(env, 'KOMERCE_CJ_REAL_RECIPIENT_PHONE'),
    address1: req(env, 'KOMERCE_CJ_REAL_ADDRESS1'),
    postal_code: req(env, 'KOMERCE_CJ_REAL_POSTAL_CODE'),
    city: req(env, 'KOMERCE_CJ_REAL_CITY'),
    province: req(env, 'KOMERCE_CJ_REAL_PROVINCE'),
    country: req(env, 'KOMERCE_CJ_REAL_COUNTRY'),
    country_code: req(env, 'KOMERCE_CJ_REAL_COUNTRY_CODE').toUpperCase(),
  };
}

async function selectExactSku(productRef) {
  const { rows } = await db.query(`
    SELECT p.product_ref,
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
     ORDER BY ps.stock DESC NULLS LAST, ps.id
     LIMIT 1
  `, [productRef]);
  if (rows.length !== 1) throw new Error('CJ_REAL_EXACT_SKU_NOT_FOUND');
  return rows[0];
}

async function invoke(path, { method='GET', body=null, query=null, accessToken, fetchImpl=fetch } = {}) {
  const url = new URL(`${cj.BASE_URL}${path.replace('/api2.0/v1', '')}`);
  if (query) Object.entries(query).forEach(([k,v]) => url.searchParams.set(k,String(v)));
  const response = await fetchImpl(url, {
    method,
    headers: {
      Accept:'application/json',
      'Content-Type':'application/json',
      'CJ-Access-Token':accessToken,
    },
    ...(body ? {body:JSON.stringify(body)} : {}),
  });
  const text = await response.text();
  let payload;
  try { payload=JSON.parse(text); }
  catch (_) { throw new Error(`CJ_REAL_NON_JSON:${response.status}`); }
  if (!response.ok || payload?.result === false || payload?.success === false) {
    const error=new Error(`CJ_REAL_HTTP_ERROR:${response.status}:${payload?.message || 'unknown'}`);
    error.payload=payload;
    throw error;
  }
  return payload;
}

function cheapestRoute(body) {
  const routes = Array.isArray(body?.data) ? body.data : [];
  return routes
    .map(r => ({
      logisticName: String(r?.logisticName || '').trim(),
      logisticPrice: Number(r?.logisticPrice ?? r?.price ?? NaN),
    }))
    .filter(r => r.logisticName && Number.isFinite(r.logisticPrice) && r.logisticPrice >= 0)
    .sort((a,b) => a.logisticPrice - b.logisticPrice)[0] || null;
}

async function run(env=process.env,deps={}) {
  const cap=guard(env);
  const productRef=String(env.KOMERCE_CJ_REAL_PRODUCT_REF || DEFAULT_PRODUCT_REF).trim();
  const sku=await (deps.selectExactSku || selectExactSku)(productRef);
  const identity=contract.extractIdentity(sku.supplier_order_identity);
  const accessToken=await cj.getAccessToken({env});
  const call=deps.invoke || invoke;
  const dest=destination(env);

  const freightBody=await call(contract.ENDPOINTS.freight_calculate,{
    method:'POST',
    body:{
      startCountryCode:'CN',
      endCountryCode:dest.country_code,
      products:[{quantity:1,vid:identity.vid}],
    },
    accessToken,
  });
  const route=cheapestRoute(freightBody);
  if (!route) throw new Error('CJ_REAL_NO_LOGISTIC_ROUTE');

  const orderNumber=String(env.KOMERCE_CJ_REAL_ORDER_NUMBER || `KOM-REAL-${Date.now()}`).slice(0,50);
  const createPayload=contract.buildCreateOrderV2Payload({
    orderNumber,
    identity:sku.supplier_order_identity,
    quantity:1,
    destination:dest,
    logisticName:route.logisticName,
    fromCountryCode:'CN',
    platform:'Api',
    storeLineItemId:String(sku.product_sku_id),
    remark:'Komerce bounded real debit proof',
    sandbox:false,
  });
  if (Object.prototype.hasOwnProperty.call(createPayload,'isSandbox')) {
    throw new Error('CJ_REAL_SANDBOX_FLAG_FORBIDDEN');
  }

  const created=contract.parseCreateOrderResponse(await call(contract.ENDPOINTS.create_order_v2,{
    method:'POST',
    body:createPayload,
    accessToken,
  }));

  const detailBefore=await call(contract.ENDPOINTS.get_order_detail,{
    method:'GET',
    query:contract.buildOrderDetailQuery(created.external_ref),
    accessToken,
  });
  const facts=contract.verifyOrderDetail({
    created,
    detail:detailBefore,
    expectedOrderNumber:orderNumber,
    expectedVid:identity.vid,
    expectedQuantity:1,
  });

  const productAmount=Number(created.product_amount);
  const postageAmount=Number(created.postage_amount);
  const expectedTotal=productAmount+postageAmount;
  if (![productAmount,postageAmount,expectedTotal].every(Number.isFinite) || expectedTotal <= 0) {
    throw new Error('CJ_REAL_ORDER_AMOUNT_INVALID');
  }
  if (expectedTotal > cap) {
    const error=new Error('CJ_REAL_DEBIT_CAP_EXCEEDED');
    error.amounts={product_amount:productAmount,postage_amount:postageAmount,total:expectedTotal,cap};
    throw error;
  }

  await call(contract.ENDPOINTS.confirm_order,{
    method:'POST',
    body:contract.buildConfirmOrderPayload(created.external_ref),
    accessToken,
  });

  const confirmedDetail=await call(contract.ENDPOINTS.get_order_detail,{
    method:'GET',
    query:contract.buildOrderDetailQuery(created.external_ref),
    accessToken,
  });
  const confirmedFacts=contract.readOrderDetailFacts(confirmedDetail);
  const shipmentOrderId=String(confirmedFacts.shipment_order_id || created.shipment_order_id || '').trim();
  if (!shipmentOrderId) throw new Error('CJ_REAL_SHIPMENT_ORDER_ID_MISSING');

  const payBody=await call(contract.ENDPOINTS.pay_balance_v2,{
    method:'POST',
    body:contract.buildPayBalanceV2Payload(shipmentOrderId),
    accessToken,
  });
  const payment=contract.parsePayBalanceV2Response(payBody);

  const afterPay=await call(contract.ENDPOINTS.get_order_detail,{
    method:'GET',
    query:contract.buildOrderDetailQuery(created.external_ref),
    accessToken,
  });
  const paidFacts=contract.verifyPaidOrderDetail(afterPay,created.external_ref,orderNumber);

  const billingBody=await call(contract.ENDPOINTS.billing_history,{
    method:'POST',
    body:contract.buildBillingHistoryQuery({orderId:created.external_ref}),
    accessToken,
  });

  const evidence=contract.parseBillingHistoryDebitEvidence(billingBody,{
    expectedOrderIds:[created.external_ref],
    expectedAmount:expectedTotal,
  });

  const result={
    proof:'CJ_REAL_DEBIT_BOUNDED',
    sandbox:false,
    product_ref:sku.product_ref,
    product_sku_id:sku.product_sku_id,
    cj_order_id:created.external_ref,
    order_number:orderNumber,
    shipment_order_id:shipmentOrderId,
    logistic_name:route.logisticName,
    product_amount:productAmount,
    postage_amount:postageAmount,
    expected_total:expectedTotal,
    hard_cap_usd:cap,
    prepay_status:facts.status,
    paid_status:paidFacts.status,
    payment_verdict:payment.payment_verdict,
    billing_evidence_verified:evidence.verified,
    billing_evidence:evidence.evidence,
  };
  console.log(`[cj-real-debit-proof] ${JSON.stringify(result)}`);
  return result;
}

if(require.main===module){
  run()
    .catch(error=>{
      console.error(`[cj-real-debit-proof] FAILED: ${error.stack || error}`);
      if(error.amounts) console.error(`[cj-real-debit-proof] amounts=${JSON.stringify(error.amounts)}`);
      if(error.payload) console.error(`[cj-real-debit-proof] provider=${JSON.stringify(error.payload)}`);
      process.exitCode=1;
    })
    .finally(()=>db.pool.end());
}

module.exports={
  ALLOW_FLAG,
  PAYMENT_FLAG,
  DEFAULT_PRODUCT_REF,
  ABSOLUTE_MAX_USD,
  guard,
  destination,
  cheapestRoute,
  selectExactSku,
  invoke,
  run,
};
