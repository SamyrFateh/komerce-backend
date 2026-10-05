/**
 * @komerce-arch
 * @role          supplier-payment-proof-persistence
 * @domain        purchasing
 * @layer         service
 * @criticality   high
 * @inputs        verified provider monetary evidence
 * @outputs       durable supplier payment proof reference
 * @depends       none
 * @used-by       future supplier payment reconciliation runtime
 * @db-read       supplier_execution_payment_proofs
 * @db-write      supplier_execution_payment_proofs, supplier_execution_payments, supplier_execution_events
 * @db-txn        caller_owned_transaction
 * @doctrine      docs/doctrine/DOCTRINE_SUPPLIER_PAYMENT_FACT.md
 * @impact-areas  purchasing, economic-engine
 * @version       2026-10
 */
'use strict';

function text(value) {
  const v = String(value || '').trim();
  return v || null;
}

async function persistSupplierPaymentProof(client, {
  supplierPaymentId,
  provider,
  proofSource,
  proofRef,
  providerOrderId = null,
  paymentRef = null,
  observedAmount,
  currency,
  debitConfirmed,
  sandbox = false,
  simulated = false,
  occurredAt = null,
  providerFacts = {},
} = {}) {
  const paymentId = text(supplierPaymentId);
  const p = text(provider)?.toLowerCase();
  const source = text(proofSource);
  const ref = text(proofRef);
  const ccy = text(currency)?.toUpperCase();
  const amount = Number(observedAmount);

  if (!paymentId) throw new Error('SUPPLIER_PAYMENT_ID_REQUIRED');
  if (!p) throw new Error('SUPPLIER_PAYMENT_PROOF_PROVIDER_REQUIRED');
  if (!source) throw new Error('SUPPLIER_PAYMENT_PROOF_SOURCE_REQUIRED');
  if (!ref) throw new Error('SUPPLIER_PAYMENT_PROOF_REF_REQUIRED');
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('SUPPLIER_PAYMENT_PROOF_AMOUNT_INVALID');
  if (!ccy || !/^[A-Z]{3}$/.test(ccy)) throw new Error('SUPPLIER_PAYMENT_PROOF_CURRENCY_INVALID');

  const { rows: inserted } = await client.query(`
    INSERT INTO supplier_execution_payment_proofs
      (supplier_payment_id, provider, proof_source, proof_ref,
       provider_order_id, payment_ref, observed_amount, currency,
       debit_confirmed, sandbox, simulated, occurred_at, provider_facts)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)
    ON CONFLICT (provider, proof_source, proof_ref) DO NOTHING
    RETURNING *
  `, [
    paymentId, p, source, ref,
    text(providerOrderId), text(paymentRef), amount, ccy,
    debitConfirmed === true, sandbox === true, simulated === true,
    occurredAt || null, JSON.stringify(providerFacts || {}),
  ]);

  let row = inserted[0];
  if (!row) {
    const { rows } = await client.query(`
      SELECT *
        FROM supplier_execution_payment_proofs
       WHERE provider = $1 AND proof_source = $2 AND proof_ref = $3
       FOR UPDATE
    `, [p, source, ref]);
    row = rows[0];
    if (!row) throw new Error('SUPPLIER_PAYMENT_PROOF_NOT_FOUND_AFTER_CONFLICT');
    if (String(row.supplier_payment_id) !== paymentId) {
      throw new Error('SUPPLIER_PAYMENT_PROOF_REBIND_REFUSED');
    }
  }

  if (debitConfirmed === true && sandbox !== true && simulated !== true) {
    const { rows: promoted } = await client.query(`
      UPDATE supplier_execution_payments
         SET real_debit_verified = true,
             observed_amount = COALESCE(observed_amount, $1),
             payment_ref = COALESCE(payment_ref, $2),
             updated_at = NOW()
       WHERE id = $3
         AND status = 'succeeded'
         AND reconciliation_status = 'matched'
         AND expected_amount = $1
         AND currency = $4
       RETURNING id
    `, [amount, text(paymentRef), paymentId, ccy]);

    if (promoted.length !== 1) {
      throw new Error('SUPPLIER_PAYMENT_PROOF_PROMOTION_REFUSED');
    }

    await client.query(`
      INSERT INTO supplier_execution_events
        (purchase_order_id, provider, supplier_execution_order_id,
         supplier_execution_group_id, operation, outcome, facts)
      SELECT purchase_order_id, provider, supplier_execution_order_id,
             supplier_execution_group_id, 'provider_payment_debit_proof',
             'observed',
             $2::jsonb
        FROM supplier_execution_payments
       WHERE id = $1
    `, [
      paymentId,
      JSON.stringify({
        proof_source: source,
        proof_ref: ref,
        observed_amount: amount,
        currency: ccy,
        debit_confirmed: true,
      }),
    ]);
  }

  return row;
}

module.exports = { persistSupplierPaymentProof };
