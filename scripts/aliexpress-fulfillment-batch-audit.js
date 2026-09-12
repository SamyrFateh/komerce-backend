#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          aliexpress-fulfillment-batch-audit
 * @domain        purchasing
 * @layer         script
 * @criticality   high
 * @inputs        active AliExpress product_skus, destination country, explicit ship-from country, live supplier APIs
 * @outputs       bounded fulfillment-readiness verdict distribution
 * @depends       db.js, services/suppliers/supplier-fulfillment-readiness.js
 * @db-read       product_skus, sourcing_candidates (via fulfillment adapter)
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_SUPPLIER_ORDER_IDENTITY.md
 * @impact-areas  purchasing, supplier-integration, catalog
 * @version       2026-09-13
 */
'use strict';

const db = require('../db');
const { VERDICT, evaluateSupplierFulfillmentReadiness } = require('../services/suppliers/supplier-fulfillment-readiness');

const AUDIT_FLAG = 'KOMERCE_ALLOW_ALIEXPRESS_FULFILLMENT_AUDIT';
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 25;

function truthy(value) {
  return ['1', 'true', 'yes'].includes(String(value || '').trim().toLowerCase());
}

function runtime(env = process.env) {
  return String(env.KOMERCE_ENV || '').trim().toLowerCase() || 'unknown';
}

function destinationCountry(env = process.env) {
  const code = String(env.KOMERCE_ALIEXPRESS_COUNTRY_CODE || 'KM').trim().toUpperCase();
  if (!/^[A-Z]{2,3}$/.test(code)) throw new Error(`KOMERCE_ALIEXPRESS_COUNTRY_CODE invalide: ${code}`);
  return code;
}

function sendGoodsCountry(env = process.env) {
  const code = String(env.KOMERCE_ALIEXPRESS_SEND_GOODS_COUNTRY_CODE || '').trim().toUpperCase();
  if (!code) throw new Error('KOMERCE_ALIEXPRESS_SEND_GOODS_COUNTRY_CODE requis');
  if (!/^[A-Z]{2,3}$/.test(code)) throw new Error(`KOMERCE_ALIEXPRESS_SEND_GOODS_COUNTRY_CODE invalide: ${code}`);
  return code;
}

function guard(env = process.env) {
  const rt = runtime(env);
  if (rt !== 'staging') throw new Error(`REFUS: audit fulfillment AliExpress réservé à KOMERCE_ENV=staging (actuel=${rt})`);
  if (!truthy(env[AUDIT_FLAG])) throw new Error(`${AUDIT_FLAG}=1 requis`);
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL requis');
  destinationCountry(env);
  sendGoodsCountry(env);
  return rt;
}

function auditLimit(env = process.env) {
  const raw = Number(env.KOMERCE_ALIEXPRESS_FULFILLMENT_AUDIT_LIMIT || DEFAULT_LIMIT);
  if (!Number.isFinite(raw)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.trunc(raw)));
}

function delayMs(env = process.env) {
  const raw = Number(env.KOMERCE_ALIEXPRESS_FULFILLMENT_AUDIT_DELAY_MS || 300);
  if (!Number.isFinite(raw)) return 300;
  return Math.max(0, Math.min(5000, Math.trunc(raw)));
}

async function candidateRows(dbImpl, limit) {
  const { rows } = await dbImpl.query(
    `SELECT product_sku_id, product_id, supplier_sku, supplier_unit_ref
       FROM (
         SELECT ps.id AS product_sku_id,
                ps.product_id,
                ps.supplier_sku,
                ps.supplier_unit_ref,
                ps.stock,
                ps.updated_at,
                ROW_NUMBER() OVER (
                  PARTITION BY ps.product_id
                  ORDER BY ps.stock DESC NULLS LAST, ps.updated_at DESC, ps.id
                ) AS rn
           FROM product_skus ps
          WHERE ps.source = 'SUPPLIER'
            AND ps.is_active = TRUE
            AND ps.supplier_sku IS NOT NULL
            AND ps.supplier_unit_ref IS NOT NULL
            AND ps.supplier_order_identity IS NOT NULL
            AND LOWER(COALESCE(ps.supplier_order_identity->>'provider', '')) = 'aliexpress'
       ) ranked
      WHERE rn = 1
      ORDER BY updated_at DESC, product_sku_id
      LIMIT $1`,
    [limit]
  );
  return rows;
}

function sleep(ms) {
  if (!ms) return Promise.resolve();
  return new Promise(resolve => setTimeout(resolve, ms));
}

function compactVerdict(row, verdict) {
  return {
    product_id: row.product_id,
    product_sku_id: row.product_sku_id,
    supplier_sku: row.supplier_sku,
    supplier_unit_ref: row.supplier_unit_ref,
    ready: Boolean(verdict?.ready),
    status: verdict?.status || VERDICT.PREFLIGHT_FAILED,
    reason: verdict?.reason || null,
    evidence: verdict?.evidence ? {
      supplier_product_id: verdict.evidence.supplier_product_id || null,
      stock_available: verdict.evidence.stock_available ?? null,
      unit_price: verdict.evidence.unit_price ?? null,
      currency: verdict.evidence.currency || null,
      destination_country_code: verdict.evidence.destination_country_code || null,
      freight: verdict.evidence.freight || null,
      place_order_invoked: verdict.evidence.place_order_invoked === true,
      payment_invoked: verdict.evidence.payment_invoked === true,
    } : null,
  };
}

function summarize(items) {
  const counts = {};
  let ready = 0;
  for (const item of items) {
    counts[item.status] = (counts[item.status] || 0) + 1;
    if (item.ready) ready += 1;
  }
  return {
    evaluated: items.length,
    ready,
    ready_rate_pct: items.length ? Number(((ready / items.length) * 100).toFixed(2)) : 0,
    counts,
  };
}

function assertNoSupplierMutation(items) {
  const violation = items.find(item => item.evidence?.place_order_invoked === true || item.evidence?.payment_invoked === true);
  if (violation) throw new Error(`SAFETY VIOLATION: mutation fournisseur détectée pour ${violation.product_sku_id}`);
}

async function run(env = process.env, deps = {}) {
  const rt = guard(env);
  const dbImpl = deps.dbImpl || db;
  const evaluate = deps.evaluate || evaluateSupplierFulfillmentReadiness;
  const wait = deps.sleepImpl || sleep;
  const limit = auditLimit(env);
  const countryCode = destinationCountry(env);
  const sendGoodsCountryCode = sendGoodsCountry(env);
  const pauseMs = delayMs(env);
  const rows = await candidateRows(dbImpl, limit);
  const items = [];

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    let verdict;
    try {
      verdict = await evaluate({
        db: dbImpl,
        productSkuId: row.product_sku_id,
        quantity: 1,
        destination: { country_code: countryCode, send_goods_country_code: sendGoodsCountryCode },
        context: { env },
      });
    } catch (error) {
      verdict = {
        ready: false,
        status: VERDICT.PREFLIGHT_FAILED,
        reason: String(error?.message || error),
        evidence: { product_sku_id: row.product_sku_id },
      };
    }
    const item = compactVerdict(row, verdict);
    items.push(item);
    console.log(`[aliexpress-fulfillment-batch-audit] item=${JSON.stringify(item)}`);
    if (i < rows.length - 1) await wait(pauseMs);
  }

  assertNoSupplierMutation(items);
  const aggregate = summarize(items);
  const out = {
    runtime: rt,
    proof: 'aliexpress-fulfillment-batch-v1',
    destination_country_code: countryCode,
    send_goods_country_code: sendGoodsCountryCode,
    requested_limit: limit,
    selected: rows.length,
    ...aggregate,
    hard_stop: { place_order_invoked: false, payment_invoked: false },
    items,
  };
  console.log(`[aliexpress-fulfillment-batch-audit] summary=${JSON.stringify(out)}`);
  return out;
}

if (require.main === module) {
  run()
    .catch(error => {
      console.error(`[aliexpress-fulfillment-batch-audit] FAILED: ${error.stack || error}`);
      process.exitCode = 1;
    })
    .finally(() => db.pool.end());
}

module.exports = {
  AUDIT_FLAG,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  truthy,
  runtime,
  destinationCountry,
  sendGoodsCountry,
  guard,
  auditLimit,
  delayMs,
  candidateRows,
  compactVerdict,
  summarize,
  assertNoSupplierMutation,
  run,
};
