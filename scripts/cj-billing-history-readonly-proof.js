#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          cj-billing-history-readonly-proof
 * @domain        purchasing
 * @layer         script
 * @criticality   high
 * @inputs        existing CJ sandbox order ids, proof access token
 * @outputs       sanitized billingHistory observations only
 * @depends       services/suppliers/connectors/cj-connector.js, services/suppliers/cj-purchasing-contract.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_SUPPLIER_PAYMENT_FACT.md
 * @impact-areas  purchasing, supplier-integration
 */
'use strict';

const cj = require('../services/suppliers/connectors/cj-connector');
const contract = require('../services/suppliers/cj-purchasing-contract');

const ALLOW_FLAG = 'KOMERCE_ALLOW_CJ_BILLING_HISTORY_READ';
const DEFAULT_ORDER_IDS = [
  'SD2610050652020648900',
  'SD2610050652080659300',
];

function guard(env = process.env) {
  const runtime = String(env.KOMERCE_ENV || env.NODE_ENV || '').trim().toLowerCase();
  if (runtime === 'production') throw new Error('REFUS: billingHistory sandbox proof interdit en production');
  if (env[ALLOW_FLAG] !== '1') throw new Error(`${ALLOW_FLAG}=1 requis`);
  if (env.KOMERCE_CJ_SANDBOX !== '1') throw new Error('KOMERCE_CJ_SANDBOX=1 requis');
}

function sanitizeRow(row = {}) {
  return {
    id: row.id == null ? null : String(row.id),
    cj_order_id: row.cjOrderId == null ? null : String(row.cjOrderId),
    type_desc: row.typeDesc == null ? null : String(row.typeDesc),
    payment_type_desc: row.paymentTypeDesc == null ? null : String(row.paymentTypeDesc),
    status: row.status == null ? null : String(row.status),
    cope_money: Number.isFinite(Number(row.copeMoney)) ? Number(row.copeMoney) : null,
    amount: row.amount == null ? null : String(row.amount),
    after_transaction_money: Number.isFinite(Number(row.afterTransactionMoney))
      ? Number(row.afterTransactionMoney)
      : null,
    create_date: row.createDate == null ? null : String(row.createDate),
  };
}

async function invoke(path, { body, accessToken, fetchImpl = fetch } = {}) {
  const url = new URL(`${cj.BASE_URL}${path.replace('/api2.0/v1', '')}`);
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'CJ-Access-Token': accessToken,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); }
  catch (_) { throw new Error(`CJ_BILLING_HISTORY_NON_JSON:${response.status}`); }
  if (!response.ok || payload?.result === false) {
    const error = new Error(
      `CJ_BILLING_HISTORY_HTTP_ERROR:${response.status}:${payload?.message || 'unknown'}`
    );
    error.payload = payload;
    throw error;
  }
  return payload;
}

async function run(env = process.env, deps = {}) {
  guard(env);
  const accessToken = await cj.getAccessToken({ env });
  const orderIds = String(env.KOMERCE_CJ_BILLING_ORDER_IDS || DEFAULT_ORDER_IDS.join(','))
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);
  if (!orderIds.length) throw new Error('CJ_BILLING_ORDER_IDS_REQUIRED');

  const call = deps.invoke || invoke;
  const observations = [];
  for (const orderId of orderIds) {
    const body = await call(contract.ENDPOINTS.billing_history, {
      body: contract.buildBillingHistoryQuery({ orderId }),
      accessToken,
    });
    const rows = Array.isArray(body?.data?.list) ? body.data.list : [];
    observations.push({
      order_id: orderId,
      row_count: rows.length,
      rows: rows.map(sanitizeRow),
    });
  }

  const matchingRows = observations.flatMap(x => x.rows).filter(row =>
    orderIds.includes(row.cj_order_id)
    && row.type_desc === 'Order Payment'
    && row.payment_type_desc === 'Balance'
    && row.status === '1'
  );

  const result = {
    proof: 'CJ_BILLING_HISTORY_READONLY_SANDBOX',
    sandbox: true,
    read_only: true,
    real_debit_verified: false,
    order_ids: orderIds,
    matching_row_count: matchingRows.length,
    observations,
  };
  console.log(`[cj-billing-history-readonly-proof] ${JSON.stringify(result)}`);
  return result;
}

if (require.main === module) {
  run().catch(error => {
    console.error(`[cj-billing-history-readonly-proof] FAILED: ${error.stack || error}`);
    if (error.payload) {
      console.error(`[cj-billing-history-readonly-proof] provider=${JSON.stringify(error.payload)}`);
    }
    process.exitCode = 1;
  });
}

module.exports = {
  ALLOW_FLAG,
  DEFAULT_ORDER_IDS,
  guard,
  sanitizeRow,
  invoke,
  run,
};
