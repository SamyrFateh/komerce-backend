#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          cj-real-debit-canonical-proof
 * @domain        purchasing
 * @layer         script
 * @criticality   critical
 * @inputs        persisted CJ supplier payment id + explicit operator authorization
 * @outputs       canonical real debit proof persisted in Komerce
 * @depends       db.js, services/suppliers/cj-supplier-payment-runtime.js
 * @db-read       supplier_execution_payments, supplier_execution_payment_proofs
 * @db-write      through cj-supplier-payment-runtime only
 * @db-txn        none_across_provider_call
 * @doctrine      docs/doctrine/DOCTRINE_SUPPLIER_PAYMENT_FACT.md
 * @impact-areas  purchasing, supplier-integration, audit
 */
'use strict';

const db = require('../db');
const { closeCjSupplierPayment } = require('../services/suppliers/cj-supplier-payment-runtime');

const ALLOW_FLAG = 'KOMERCE_ALLOW_CJ_REAL_DEBIT_PROOF';
const PAYMENT_FLAG = 'KOMERCE_ALLOW_CJ_REAL_PAYMENT';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseArgs(argv = process.argv) {
  const out = { paymentId: null };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--payment') out.paymentId = String(argv[++i] || '').trim();
  }
  return out;
}

function guard(env = process.env, paymentId) {
  if (env[ALLOW_FLAG] !== '1') throw new Error(ALLOW_FLAG + '=1 requis');
  if (env[PAYMENT_FLAG] !== '1') throw new Error(PAYMENT_FLAG + '=1 requis');
  if (env.KOMERCE_CJ_SANDBOX === '1') throw new Error('CJ_REAL_PROOF_SANDBOX_FORBIDDEN');
  if (!UUID_RE.test(String(paymentId || ''))) throw new Error('CJ_REAL_SUPPLIER_PAYMENT_ID_INVALID');
  return paymentId;
}

async function readCanonicalProof(q, paymentId) {
  const { rows } = await q.query(`
    SELECT p.id,
           p.purchase_order_id,
           p.provider,
           p.status,
           p.reconciliation_status,
           p.real_debit_verified,
           p.expected_amount::text AS expected_amount,
           p.observed_amount::text AS observed_amount,
           p.currency,
           p.payment_ref,
           pr.proof_source,
           pr.proof_ref,
           pr.observed_amount::text AS proof_observed_amount,
           pr.currency AS proof_currency,
           pr.debit_confirmed,
           pr.sandbox,
           pr.simulated,
           pr.occurred_at
      FROM supplier_execution_payments p
      LEFT JOIN LATERAL (
        SELECT *
          FROM supplier_execution_payment_proofs
         WHERE supplier_payment_id = p.id
           AND provider = 'cj'
           AND proof_source = 'cj_wallet_billing_history'
         ORDER BY created_at DESC, id DESC
         LIMIT 1
      ) pr ON TRUE
     WHERE p.id = $1
       AND p.provider = 'cj'
  `, [paymentId]);
  return rows[0] || null;
}

function assertCanonicalClosure(row) {
  if (!row) throw new Error('CJ_REAL_CANONICAL_PAYMENT_NOT_FOUND');
  if (row.status !== 'succeeded') throw new Error('CJ_REAL_CANONICAL_STATUS_NOT_SUCCEEDED');
  if (row.reconciliation_status !== 'matched') throw new Error('CJ_REAL_CANONICAL_RECONCILIATION_NOT_MATCHED');
  if (row.real_debit_verified !== true) throw new Error('CJ_REAL_CANONICAL_DEBIT_NOT_VERIFIED');
  if (row.proof_source !== 'cj_wallet_billing_history') throw new Error('CJ_REAL_CANONICAL_PROOF_SOURCE_MISSING');
  if (!row.proof_ref) throw new Error('CJ_REAL_CANONICAL_PROOF_REF_MISSING');
  if (row.debit_confirmed !== true) throw new Error('CJ_REAL_CANONICAL_DEBIT_CONFIRMATION_MISSING');
  if (row.sandbox === true || row.simulated === true) throw new Error('CJ_REAL_CANONICAL_PROOF_NOT_REAL');
  if (String(row.expected_amount) !== String(row.observed_amount)) throw new Error('CJ_REAL_CANONICAL_PAYMENT_AMOUNT_MISMATCH');
  if (String(row.expected_amount) !== String(row.proof_observed_amount)) throw new Error('CJ_REAL_CANONICAL_PROOF_AMOUNT_MISMATCH');
  if (String(row.currency) !== String(row.proof_currency)) throw new Error('CJ_REAL_CANONICAL_PROOF_CURRENCY_MISMATCH');

  return Object.freeze({
    supplier_payment_id: row.id,
    purchase_order_id: row.purchase_order_id,
    provider: row.provider,
    status: row.status,
    reconciliation_status: row.reconciliation_status,
    real_debit_verified: true,
    expected_amount: row.expected_amount,
    observed_amount: row.observed_amount,
    currency: row.currency,
    payment_ref: row.payment_ref || null,
    proof_source: row.proof_source,
    proof_ref: row.proof_ref,
    occurred_at: row.occurred_at || null,
  });
}

async function run(env = process.env, deps = {}) {
  const args = deps.args || parseArgs(deps.argv || process.argv);
  const paymentId = guard(env, args.paymentId);
  const q = deps.db || db;
  const close = deps.closeCjSupplierPayment || closeCjSupplierPayment;

  const before = await readCanonicalProof(q, paymentId);
  if (!before) throw new Error('CJ_REAL_CANONICAL_PAYMENT_NOT_FOUND');

  const runtimeResult = await close(q, {
    supplierPaymentId: paymentId,
    context: {
      env,
      operator_authorized: true,
      ...(deps.context || {}),
    },
  });

  const after = await readCanonicalProof(q, paymentId);
  const proof = assertCanonicalClosure(after);

  const result = Object.freeze({
    proof: 'CJ_REAL_DEBIT_CANONICAL',
    invoked: runtimeResult?.invoked === true,
    already_verified: runtimeResult?.already_verified === true,
    closed: true,
    ...proof,
  });

  console.log('[cj-real-debit-canonical-proof] ' + JSON.stringify(result));
  return result;
}

if (require.main === module) {
  run()
    .catch(error => {
      console.error('[cj-real-debit-canonical-proof] FAILED: ' + (error.stack || error));
      process.exitCode = 1;
    })
    .finally(() => db.pool.end());
}

module.exports = {
  ALLOW_FLAG,
  PAYMENT_FLAG,
  UUID_RE,
  parseArgs,
  guard,
  readCanonicalProof,
  assertCanonicalClosure,
  run,
};
