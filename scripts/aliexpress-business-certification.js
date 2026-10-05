#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          aliexpress-business-certification
 * @domain        purchasing
 * @layer         script
 * @criticality   high
 * @inputs        isolated staging DB, managed AliExpress OAuth, optional explicit Hub destination
 * @outputs       one business-readiness proof on an exact active AliExpress SKU
 * @depends       db.js, scripts/aliexpress-readiness-golden-proof.js, scripts/aliexpress-business-order-golden-proof.js
 * @db-read       products, product_skus
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/ALIEXPRESS_BUSINESS_READINESS.md, docs/doctrine/DOCTRINE_PURCHASING_PROVIDER_GOLDEN_E2E.md
 * @impact-areas  purchasing, supplier-integration, e2e
 */
'use strict';

const db = require('../db');
const readinessProof = require('./aliexpress-readiness-golden-proof');
const orderProof = require('./aliexpress-business-order-golden-proof');

const PROOF_FLAG = 'KOMERCE_ALLOW_ALIEXPRESS_BUSINESS_CERTIFICATION';
const MODES = Object.freeze(['readiness', 'order']);

function truthy(value) {
  return ['1', 'true', 'yes'].includes(String(value || '').trim().toLowerCase());
}

function parseMode(argv = process.argv.slice(2)) {
  const raw = argv.find(value => String(value).startsWith('--mode='));
  const mode = String(raw ? raw.slice('--mode='.length) : 'readiness').trim().toLowerCase();
  if (!MODES.includes(mode)) throw new Error('ALIEXPRESS_BUSINESS_CERTIFICATION_MODE_INVALID');
  return mode;
}

function guard(env = process.env, mode = 'readiness') {
  const runtime = String(env.KOMERCE_ENV || env.NODE_ENV || '').trim().toLowerCase() || 'unknown';
  if (runtime === 'production') throw new Error('REFUS: certification business AliExpress interdite en production');
  if (!truthy(env[PROOF_FLAG])) throw new Error(`${PROOF_FLAG}=1 requis`);
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL requis');
  if (mode === 'order' && !truthy(env[orderProof.PROOF_FLAG])) {
    throw new Error(`${orderProof.PROOF_FLAG}=1 requis en mode order`);
  }
  return runtime;
}

async function candidateSkus(query) {
  const { rows } = await query(
    `SELECT ps.id, p.product_ref
       FROM product_skus ps
       JOIN products p ON p.id = ps.product_id
      WHERE ps.is_active = TRUE
        AND ps.source = 'SUPPLIER'
        AND ps.supplier_sku IS NOT NULL
        AND ps.supplier_unit_ref IS NOT NULL
        AND ps.supplier_order_identity IS NOT NULL
        AND ps.supplier_order_identity->>'provider' = 'aliexpress'
      ORDER BY p.updated_at DESC NULLS LAST, ps.id
      LIMIT 25`
  );
  return rows || [];
}

async function run(argv = process.argv.slice(2), {
  env = process.env,
  query = db.query.bind(db),
  readinessRun = readinessProof.run,
  orderRun = orderProof.run,
} = {}) {
  const mode = parseMode(argv);
  const runtime = guard(env, mode);
  const candidates = await candidateSkus(query);
  if (!candidates.length) throw new Error('ALIEXPRESS_BUSINESS_CERTIFICATION_NO_ACTIVE_SKU');

  const failures = [];
  for (const candidate of candidates) {
    try {
      const readiness = await readinessRun([candidate.id], {
        env: { ...env, KOMERCE_ALLOW_ALIEXPRESS_READINESS_PROOF: '1' },
        query,
      });

      if (mode === 'readiness') {
        const report = {
          status: 'PASS',
          proof: 'ALIEXPRESS_BUSINESS_CERTIFICATION',
          mode,
          runtime,
          product_ref: candidate.product_ref,
          product_sku_id: candidate.id,
          readiness: {
            provider: readiness.provider,
            supplier_unit_ref: readiness.supplier_unit_ref,
            stock_available: readiness.live?.stock_available ?? null,
            unit_price: readiness.live?.unit_price ?? null,
            currency: readiness.live?.currency ?? null,
            freight: readiness.live?.freight ?? null,
          },
          mutation: { place_order_invoked: false, payment_invoked: false },
        };
        console.log(`[aliexpress-business-certification] ${JSON.stringify(report)}`);
        return report;
      }

      const order = await orderRun([candidate.id], {
        env: { ...env, KOMERCE_ALLOW_ALIEXPRESS_READINESS_PROOF: '1' },
        query,
      });
      const report = {
        status: 'PASS',
        proof: 'ALIEXPRESS_BUSINESS_CERTIFICATION',
        mode,
        runtime,
        product_ref: candidate.product_ref,
        product_sku_id: candidate.id,
        supplier_order_id: order.supplier_order_id,
        commitment_verdict: order.commitment_verdict,
        readback_status: order.readback_status,
        execution_recovery: order.execution_recovery,
        mutation: { place_order_invoked: true, payment_invoked: false },
      };
      console.log(`[aliexpress-business-certification] ${JSON.stringify(report)}`);
      return report;
    } catch (error) {
      failures.push({
        product_ref: candidate.product_ref,
        product_sku_id: candidate.id,
        error: String(error?.message || error).slice(0, 240),
      });
    }
  }

  const error = new Error(`ALIEXPRESS_BUSINESS_CERTIFICATION_NO_PASSING_SKU:${failures.length}`);
  error.failures = failures.slice(0, 8);
  throw error;
}

if (require.main === module) {
  run()
    .catch((error) => {
      console.error(`[aliexpress-business-certification] FAILED: ${error.stack || error}`);
      if (error.failures) console.error(`[aliexpress-business-certification] failures=${JSON.stringify(error.failures)}`);
      process.exitCode = 1;
    })
    .finally(() => db.pool.end());
}

module.exports = { PROOF_FLAG, MODES, truthy, parseMode, guard, candidateSkus, run };
