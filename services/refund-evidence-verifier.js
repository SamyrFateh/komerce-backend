/**
 * @komerce-arch
 * @role          external-refund-evidence-verifier
 * @domain        refunds
 * @layer         service
 * @criticality   critical
 * @inputs        persisted refund intent, providerRefundId, trusted provider GET adapter
 * @outputs       explicit provider evidence verdict (NO ledger/order write)
 * @depends       refund-intent-ledger.js, services/paypal-client.js
 * @used-by       future refund settlement (NOT ACTIVATED)
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      financial_evidence_must_match_capture_amount_currency
 */
'use strict';

const { euroCents, RefundIntentError } = require('./refund-intent-ledger');

/**
 * A provider GET can be inconclusive: do not mistake network failures, omitted
 * capture relationships, or a pending PSP status for confirmed financial effect.
 * This verifier deliberately DOES NOT mutate refunds, orders or intentions.
 */
function unknown(reason) {
  return { verdict: 'UNKNOWN', reason, verified: false };
}

function assertEvidence(condition, code, message) {
  if (!condition) throw new RefundIntentError(code, message);
}

function amountMatches(amount, requested) {
  try { return euroCents(amount) === euroCents(requested); }
  catch { return false; }
}

function validateIntent(intent) {
  assertEvidence(intent && ['stripe', 'paypal'].includes(intent.provider) &&
    typeof intent.capture_ref === 'string' && intent.capture_ref.length > 0 &&
    typeof intent.id === 'string' && intent.id.length > 0,
  'REFUND_EVIDENCE_INPUT_INVALID', 'Intention complète et PSP connus requis');
  euroCents(intent.amount_eur);
}

async function verifyRefundEvidence({ intent, providerRefundId, stripe, paypal }) {
  validateIntent(intent);
  assertEvidence(typeof providerRefundId === 'string' && providerRefundId.length > 0,
    'REFUND_PROVIDER_REF_REQUIRED', 'ID du remboursement PSP requis');

  let evidence;
  try {
    if (intent.provider === 'stripe') {
      assertEvidence(stripe?.refunds?.retrieve instanceof Function,
        'REFUND_PROVIDER_ADAPTER_MISSING', 'Client Stripe lecture manquant');
      evidence = await stripe.refunds.retrieve(providerRefundId);
    } else {
      assertEvidence(paypal?.getRefund instanceof Function,
        'REFUND_PROVIDER_ADAPTER_MISSING', 'Client PayPal lecture manquant');
      evidence = await paypal.getRefund(providerRefundId);
    }
  } catch (err) {
    if (err.code === 'REFUND_PROVIDER_ADAPTER_MISSING') throw err;
    return unknown('PROVIDER_LOOKUP_UNAVAILABLE');
  }

  if (!evidence || evidence.id !== providerRefundId) {
    return unknown('PROVIDER_REFERENCE_UNVERIFIABLE');
  }

  const capture = intent.provider === 'stripe'
    ? evidence.payment_intent
    : evidence.supplementary_data?.related_ids?.capture_id;
  if (!capture) return unknown('PROVIDER_CAPTURE_LINK_UNVERIFIABLE');

  assertEvidence(String(capture) === intent.capture_ref,
    'REFUND_EVIDENCE_CAPTURE_MISMATCH', 'Capture retournée par le PSP différente');

  if (intent.provider === 'stripe') {
    assertEvidence(evidence.currency === 'eur' && Number.isSafeInteger(evidence.amount) &&
      BigInt(evidence.amount) === euroCents(intent.amount_eur),
    'REFUND_EVIDENCE_AMOUNT_MISMATCH', 'Montant/devise Stripe incompatibles');
  } else {
    assertEvidence(evidence.amount?.currency_code === 'EUR' &&
      amountMatches(evidence.amount?.value, intent.amount_eur),
    'REFUND_EVIDENCE_AMOUNT_MISMATCH', 'Montant/devise PayPal incompatibles');
  }

  const normalized = String(evidence.status || '').toUpperCase();
  const confirmed = intent.provider === 'stripe'
    ? normalized === 'SUCCEEDED' : normalized === 'COMPLETED';
  const failed = ['FAILED', 'CANCELED', 'CANCELLED', 'DENIED'].includes(normalized);
  const pending = ['PENDING', 'PROCESSING'].includes(normalized);

  if (confirmed) {
    return { verdict: 'VERIFIED_SUCCESS', verified: true,
      provider: intent.provider, providerRefundId };
  }
  if (failed) {
    return { verdict: 'VERIFIED_FAILURE', verified: true,
      provider: intent.provider, providerRefundId };
  }
  if (pending) return unknown('PROVIDER_REFUND_PENDING');
  return unknown('PROVIDER_STATUS_UNRECOGNIZED');
}

module.exports = { verifyRefundEvidence };
