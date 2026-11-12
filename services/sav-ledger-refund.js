/**
 * @komerce-arch
 * @role          sav-ledger-refund
 * @domain        refunds
 * @layer         service
 * @criticality   critical
 * @inputs        locked_return_decision, original_capture, compensation_amount
 * @outputs       reserved_intent, verified_refund_status
 * @depends       services/refund-intent-ledger.js, services/refund-intent-reconciliation.js, services/refund-service.js, services/item-refund-psp-orchestrator.js, services/fx-authority.js, services/paypal-client.js, services/documents/refund-receipt.js
 * @used-by       services/relay-return-compensation-service.js
 * @db-read       refund_execution_intents
 * @db-write      refund_execution_intents
 * @db-txn        reserve_in_caller_transaction_then_claim_and_reconcile_outside
 * @doctrine      refund_to_payer, no_duplicate_refund, no_psp_in_sql_transaction
 * @impact-areas  orders, refunds, finance
 * @version       2026-11
 */
'use strict';

const { reserveRefundIntentInTransaction, claimRefundIntent, euroCents } = require('./refund-intent-ledger');
const { reconcileRefundIntent } = require('./refund-intent-reconciliation');
const { assertSandbox } = require('./item-refund-psp-orchestrator');
const { prorate } = require('./fx-authority');

function guard(env, provider) {
  assertSandbox(env);
  if ((provider === 'stripe' && !String(env.STRIPE_SECRET_KEY || '').startsWith('sk_test_'))
      || (provider === 'paypal' && env.PAYPAL_ENV !== 'sandbox')) {
    const error = new Error('Un compte PSP sandbox est requis pour la compensation SAV.');
    error.code = 'COMPENSATION_PSP_SANDBOX_REQUIRED';
    error.status = 403;
    throw error;
  }
}

async function reserve({ client, dossier, currency, value, actor, env }) {
  const provider = { stripe_eur: 'stripe', paypal_eur: 'paypal' }[dossier.payment_mode];
  const captureRef = provider === 'stripe' ? dossier.stripe_payment_id : dossier.paypal_capture_id;
  if (!provider || !captureRef) {
    const error = new Error('La commande ne dispose pas d’une capture Stripe ou PayPal remboursable.');
    error.code = 'COMPENSATION_CAPTURE_REQUIRED';
    error.status = 409;
    throw error;
  }
  guard(env, provider);
  if (Number(dossier.wallet_applied_kmf) > 0 || !(Number(dossier.total_eur) > 0)) {
    const error = new Error('Le remboursement PSP requiert un montant encaissé distinct et vérifiable.');
    error.code = 'COMPENSATION_CAPTURE_AMOUNT_UNVERIFIED';
    error.status = 409;
    throw error;
  }
  const snap = typeof dossier.fx_snapshot === 'string' ? JSON.parse(dossier.fx_snapshot) : dossier.fx_snapshot;
  const marketTotal = currency === 'KMF' ? dossier.total_kmf : snap.market.amount;
  const amountEur = prorate(String(value), String(dossier.total_eur), String(marketTotal), 2).toFixed(2);
  const amountKmf = prorate(String(value), String(dossier.total_kmf), String(marketTotal), 2);
  const intent = await reserveRefundIntentInTransaction(client, {
    orderId: dossier.order_id, operationKey: `sav:${dossier.id}`,
    provider, captureRef, amountEur, initiatedBy: actor.id,
  });
  return { ...intent, amountKmf };
}

async function execute({ compensation, db, env, stripe, paypal, replayed }) {
  const id = compensation.refund_intent_id;
  const { rows: [intent] } = await db.query(
    'SELECT id, status, provider, provider_ref, amount_eur FROM refund_execution_intents WHERE id = $1', [id]);
  if (!intent) throw new Error('Intention de remboursement SAV introuvable.');
  let status = intent.status;
  let providerRef = intent.provider_ref;
  if (status === 'reserved' || (status === 'unknown' && providerRef)) {
    guard(env, intent.provider);
    const stripeAdapter = intent.provider === 'stripe' ? stripe || require('stripe')(env.STRIPE_SECRET_KEY) : null;
    const paypalAdapter = intent.provider === 'paypal' ? paypal || require('./paypal-client') : null;
    if (status === 'reserved') {
      let claimed;
      try {
        claimed = await claimRefundIntent({ intentId: id, db });
      } catch (error) {
        if (error.code !== 'REFUND_INTENT_NOT_CLAIMABLE') throw error;
        return { compensation, replayed: true, refund_status: 'processing' };
      }
      try {
        const result = intent.provider === 'stripe'
          ? await stripeAdapter.refunds.create({
            payment_intent: claimed.capture_ref,
            amount: Number(euroCents(claimed.amount_eur)),
            reason: 'requested_by_customer',
            metadata: { komerce: 'true', sav_return_id: compensation.request_id },
          }, { idempotencyKey: claimed.providerRequestKey })
          : await paypalAdapter.refundCapture(claimed.capture_ref, {
            amountEur: Number(claimed.amount_eur),
            reason: compensation.reason,
            providerRequestKey: claimed.providerRequestKey,
          });
        providerRef = result?.id ?? null;
      } catch (_) {
        providerRef = null;
      }
      // A POST may have succeeded despite a timeout. Persist the uncertainty
      // before any GET, so no replay can issue another POST.
      await db.query(
        "UPDATE refund_execution_intents SET status = 'unknown', provider_ref = COALESCE(provider_ref, $2), updated_at = NOW() WHERE id = $1 AND status = 'processing'",
        [id, providerRef]);
      status = 'unknown';
    }
    if (providerRef) {
      try {
        const verdict = await reconcileRefundIntent({
          intentId: id, providerRefundId: providerRef, db, stripe: stripeAdapter, paypal: paypalAdapter,
        });
        status = verdict.status;
      } catch (_) {
        status = 'unknown';
      }
    }
  }
  if (status === 'confirmed') {
    const refundId = await db.withTransaction(client => require('./refund-service').recordExternalRefund(client, {
      orderId: compensation.order_id, amountKmf: compensation.refund_amount_kmf,
      amountEur: intent.amount_eur, refundType: `sav:${compensation.request_id}`,
      method: intent.provider, externalRefundId: intent.provider === 'stripe' ? providerRef : null,
      reason: compensation.reason, initiatedBy: compensation.decided_by, conflictOn: 'order_refund_type',
    }));
    if (refundId) await require('./documents/refund-receipt').issue(refundId, { issuedBy: compensation.decided_by });
  }
  return { compensation, replayed, refund_status: status };
}

module.exports = { reserve, execute };
