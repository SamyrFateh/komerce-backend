/**
 * @komerce-arch
 * @role          durable-refund-evidence-reconciliation
 * @domain        refunds
 * @layer         service
 * @criticality   critical
 * @inputs        intent id, PSP refund reference, provider GET adapter
 * @outputs       durable provider-evidence status (NOT order refunded)
 * @depends       db.js, refund-intent-ledger.js, refund-evidence-verifier.js
 * @used-by       future guarded refund executor (NOT ACTIVATED)
 * @db-read       refund_execution_intents, orders
 * @db-write      refund_execution_intents
 * @db-txn        provider GET before transaction, then order+intent locks, short commit
 * @doctrine      fail_closed_provider_evidence, no_psp_in_transaction, market_isolation
 */
'use strict';

const dbDefault = require('../db');
const { RefundIntentError, euroCents } = require('./refund-intent-ledger');
const { verifyRefundEvidence } = require('./refund-evidence-verifier');

function fail(code, message) { throw new RefundIntentError(code, message); }

// A persisted success is only attributable to a known, identical PSP operation.
// Older/corrupt confirmed rows with no reference need manual reconciliation.
function assertConfirmedReference(ref, expected) {
  if (!ref || ref !== expected) {
    fail('REFUND_CONFIRMED_REFERENCE_UNVERIFIED',
      'Intention confirmée sans référence PSP identique et vérifiable');
  }
}

/**
 * Reconciles the *ledger only*. It does NOT create refunds, release money,
 * change orders.payment_status, or transition orders.status.
 *
 * Provider GET occurs strictly BEFORE BEGIN, to avoid holding row locks
 * across network I/O. Afterwards we lock order -> intent (same order as
 * reserveRefundIntent), and verify the row's immutable fields did not move.
 */
async function reconcileRefundIntent({
  intentId, providerRefundId, stripe, paypal, db = dbDefault,
}) {
  if (!intentId || !providerRefundId) {
    fail('REFUND_RECONCILE_INPUT_INVALID', 'Intent et référence PSP requis');
  }
  const initial = await db.query(
    'SELECT id, order_id, market_id, provider, capture_ref, amount_eur, status, provider_ref ' +
      'FROM refund_execution_intents WHERE id = $1',
    [intentId]
  );
  const snapshot = initial.rows[0];
  if (!snapshot) fail('REFUND_INTENT_UNKNOWN', 'Intention de remboursement introuvable');
  if (!['processing', 'unknown', 'confirmed'].includes(snapshot.status)) {
    fail('REFUND_INTENT_NOT_RECONCILABLE', 'L’intention n’a pas atteint la frontière PSP');
  }
  if (snapshot.provider_ref && snapshot.provider_ref !== providerRefundId) {
    fail('REFUND_PROVIDER_REF_CONFLICT', 'Référence PSP déjà fixée sur cette intention');
  }
  if (snapshot.status === 'confirmed') {
    // Already persisted success: a replay never needs to contact the PSP.
    assertConfirmedReference(snapshot.provider_ref, providerRefundId);
    return { intentId, status: 'confirmed', replayed: true, complete: true };
  }

  // Authenticated provider GET; evidence verifier demands exact capture, amount,
  // currency, refund id and status. Any mismatch throws; no SQL write follows.
  const evidence = await verifyRefundEvidence({
    intent: snapshot, providerRefundId, stripe, paypal,
  });
  const next = evidence.verdict === 'VERIFIED_SUCCESS' ? 'confirmed'
    : evidence.verdict === 'VERIFIED_FAILURE' ? 'failed' : 'unknown';

  const client = await db.connect();
  let tx = false;
  try {
    await client.query('BEGIN');
    tx = true;
    const orderResult = await client.query(
      'SELECT id, market_id FROM orders WHERE id = $1 FOR UPDATE', [snapshot.order_id]
    );
    const order = orderResult.rows[0];
    if (!order || String(order.market_id) !== String(snapshot.market_id)) {
      fail('REFUND_MARKET_MISMATCH', 'Marché commande / intention incohérent');
    }
    const lockedResult = await client.query(
      'SELECT id, order_id, market_id, provider, capture_ref, amount_eur, status, provider_ref ' +
        'FROM refund_execution_intents WHERE id = $1 FOR UPDATE', [intentId]
    );
    const current = lockedResult.rows[0];
    if (!current || String(current.order_id) !== String(snapshot.order_id) ||
        String(current.market_id) !== String(snapshot.market_id) ||
        current.provider !== snapshot.provider ||
        current.capture_ref !== snapshot.capture_ref ||
        euroCents(current.amount_eur) !== euroCents(snapshot.amount_eur)) {
      fail('REFUND_INTENT_CHANGED', 'Intention modifiée pendant le contrôle PSP');
    }
    if (current.provider_ref && current.provider_ref !== providerRefundId) {
      fail('REFUND_PROVIDER_REF_CONFLICT', 'Référence PSP contradictoire');
    }
    if (current.status === 'confirmed') {
      // Concurrent verification won the race; require its own proven reference.
      assertConfirmedReference(current.provider_ref, providerRefundId);
      await client.query('COMMIT'); tx = false;
      return { intentId, status: 'confirmed', replayed: true, complete: true };
    }
    if (!['processing', 'unknown'].includes(current.status)) {
      fail('REFUND_INTENT_NOT_RECONCILABLE', 'État changé avant rapprochement');
    }
    const updates = await client.query(
      'UPDATE refund_execution_intents SET status = $2, ' +
        'provider_ref = COALESCE(provider_ref, $3), ' +
        "confirmed_at = CASE WHEN $2 = 'confirmed' THEN NOW() ELSE confirmed_at END, " +
        'updated_at = NOW() WHERE id = $1 AND status IN ($4, $5) RETURNING id',
      [intentId, next, providerRefundId, 'processing', 'unknown']
    );
    if (updates.rows.length !== 1) {
      fail('REFUND_RECONCILIATION_CONFLICT', 'L’état du remboursement a changé');
    }
    await client.query('COMMIT'); tx = false;
    return { intentId, status: next, replayed: false,
      complete: next === 'confirmed', reason: evidence.reason || null };
  } catch (e) {
    if (tx) await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { reconcileRefundIntent };
