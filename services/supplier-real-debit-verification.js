/**
 * @komerce-arch
 * @role          supplier-real-debit-verification
 * @domain        purchasing
 * @layer         service
 * @criticality   high
 * @inputs        persisted supplier payment + provider monetary evidence
 * @outputs       deterministic real-debit verification verdict
 * @depends       none
 * @used-by       services/suppliers/cj-billing-history-reconciliation.js, services/suppliers/cj-supplier-payment-runtime.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_SUPPLIER_PAYMENT_FACT.md
 * @impact-areas  purchasing, economic-engine
 * @version       2026-10
 */
'use strict';

function text(value) {
  const v = String(value || '').trim();
  return v || null;
}

function money(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function verifyRealDebitEvidence(payment = {}, evidence = {}) {
  const reasons = [];
  const expected = money(payment.expected_amount);
  const observed = money(evidence.observed_amount);
  const paymentCurrency = text(payment.currency)?.toUpperCase();
  const evidenceCurrency = text(evidence.currency)?.toUpperCase();
  const provider = text(payment.provider)?.toLowerCase();
  const evidenceProvider = text(evidence.provider)?.toLowerCase();
  const paymentRef = text(evidence.payment_ref || payment.payment_ref);
  const proofSource = text(evidence.proof_source);
  const proofRef = text(evidence.proof_ref);

  if (payment.status !== 'succeeded') reasons.push('PAYMENT_NOT_SUCCEEDED');
  if (payment.reconciliation_status !== 'matched') reasons.push('PAYMENT_NOT_RECONCILED');
  if (!expected) reasons.push('EXPECTED_AMOUNT_INVALID');
  if (!observed) reasons.push('OBSERVED_AMOUNT_INVALID');
  if (expected && observed && expected !== observed) reasons.push('AMOUNT_MISMATCH');
  if (!paymentCurrency || !evidenceCurrency || paymentCurrency !== evidenceCurrency) {
    reasons.push('CURRENCY_MISMATCH');
  }
  if (!provider || !evidenceProvider || provider !== evidenceProvider) {
    reasons.push('PROVIDER_MISMATCH');
  }
  if (!paymentRef) reasons.push('PAYMENT_REF_REQUIRED');
  if (!proofSource) reasons.push('PROOF_SOURCE_REQUIRED');
  if (!proofRef) reasons.push('PROOF_REF_REQUIRED');
  if (evidence.sandbox === true) reasons.push('SANDBOX_EVIDENCE_REJECTED');
  if (evidence.simulated === true) reasons.push('SIMULATED_EVIDENCE_REJECTED');
  if (evidence.debit_confirmed !== true) reasons.push('DEBIT_NOT_CONFIRMED');

  return {
    verified: reasons.length === 0,
    reasons,
    normalized: reasons.length ? null : {
      provider,
      payment_ref: paymentRef,
      observed_amount: observed,
      currency: paymentCurrency,
      proof_source: proofSource,
      proof_ref: proofRef,
      debit_confirmed: true,
      sandbox: false,
      simulated: false,
    },
  };
}

module.exports = { verifyRealDebitEvidence };
