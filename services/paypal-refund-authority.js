/**
 * @komerce-arch
 * @role          durable-paypal-admin-refund-authority
 * @domain        refunds
 * @layer         service
 * @criticality   critical
 * @inputs        order_id, admin, explicit idempotency key, original capture, provider evidence
 * @outputs       durable intent, verified refunds row, partial/full settlement
 * @depends       db.js, services/refund-intent-ledger.js, services/refund-intent-reconciliation.js, services/refund-service.js, services/payment-service.js, services/order-status-machine.js, services/documents/refund-receipt.js, utils/alerts.js
 * @used-by       services/payment-paypal.js
 * @db-read       orders, refund_execution_intents, refunds
 * @db-write      refund_execution_intents, refunds, orders, order_status_history
 * @db-txn        reserve_commit_then_claim_commit_then_provider_post_then_verified_settlement_commit
 * @doctrine      no_psp_in_sql_transaction, durable_intent, no_duplicate_refund, fail_closed_on_unknown, refunds_to_original_payer
 * @impact-areas  payments, orders, refunds, documents, finance
 * @version       2026-11
 */
'use strict';

const { reserveRefundIntent, claimRefundIntent, euroCents, euroString, RefundIntentError } = require('./refund-intent-ledger');
const { reconcileRefundIntent } = require('./refund-intent-reconciliation');
const { recordExternalRefund } = require('./refund-service');
const { markRefunded } = require('./payment-service');
const { appendOrderHistoryNote, transitionOrderStatus } = require('./order-status-machine');
const receipt = require('./documents/refund-receipt');
const { createAlert } = require('../utils/alerts');
const log = require('../utils/logger').child({ module: 'paypal-refund-authority' });

function fail(code, message, status = 409) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  throw error;
}

function assertGate({ actor, env, requestKey }) {
  if (!actor || actor.role !== 'admin' || !actor.id) fail('REFUND_ADMIN_REQUIRED', 'Administrateur requis', 403);
  // Activation explicitement fermée : ce lot ne peut PAS déclencher de PSP réel.
  if (env.KOMERCE_ENV !== 'staging' || env.PAYPAL_ENV !== 'sandbox' ||
      env.FINANCE_DURABLE_REFUNDS_ENABLED !== '1') {
    fail('REFUND_PSP_NOT_CERTIFIED', 'Remboursements PayPal durables non activés en sandbox', 403);
  }
  if (typeof requestKey !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(requestKey)) {
    fail('REFUND_IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key explicite requis (8–100 caractères)', 400);
  }
  return 'paypal:admin:' + requestKey;
}

function pending(intentId, status) {
  return { status: 202, body: { success: false, intent_id: intentId,
    refund_status: status, requires_reconciliation: true } };
}

async function alertUnknown({ db, orderId, intentId, providerRef }) {
  try {
    await createAlert(db, {
      type: 'refund_psp_reconciliation_required',
      entityType: 'order', entityId: orderId, severity: 'high',
      title: 'Remboursement PayPal à rapprocher',
      description: `intent=${intentId} provider_ref=${providerRef || 'unknown'}; aucune relance PSP automatique`,
    });
  } catch (error) {
    log.error({ error, orderId, intentId }, '[FINANCE] alerte de rapprochement non émise : SQL intent unknown conservé');
  }
}

async function markUnknown({ db, intentId, providerRef }) {
  const result = await db.query(
    "UPDATE refund_execution_intents SET status = 'unknown', provider_ref = COALESCE(provider_ref,$2), updated_at=NOW() WHERE id=$1 AND status='processing' RETURNING id",
    [intentId, providerRef || null]
  );
  if (result.rowCount !== 1 && result.rows?.length !== 1) {
    fail('REFUND_INTENT_UNKNOWN_PERSIST_FAILED', 'État PSP incertain non persisté');
  }
}

/**
 * This settlement is idempotent and ONLY follows a provider GET that confirmed
 * capture, amount, EUR currency, refund ID and COMPLETED. There is no PSP I/O
 * inside the order/refund transaction.
 */
async function settleConfirmed({ db, orderId, intentId, actor }) {
  const client = await db.connect();
  let active = false;
  let refundId;
  let fullyRefunded = false;
  let replayed = false;
  let providerRef;
  try {
    await client.query('BEGIN');
    active = true;
    const { rows: [row] } = await client.query(
      `SELECT o.id AS order_id, o.reference, o.status AS order_status, o.total_kmf, o.total_eur,
              i.id AS intent_id, i.status AS intent_status, i.provider, i.provider_ref, i.amount_eur
         FROM orders o JOIN refund_execution_intents i ON i.order_id = o.id
        WHERE o.id=$1 AND i.id=$2 FOR UPDATE OF o,i`,
      [orderId, intentId]
    );
    if (!row || row.intent_status !== 'confirmed' || row.provider !== 'paypal' || !row.provider_ref) {
      fail('REFUND_NOT_PROVIDER_VERIFIED', 'Preuve PayPal vérifiée obligatoire avant journal comptable');
    }
    providerRef = row.provider_ref;
    const whole = euroCents(row.total_eur);
    const amount = euroCents(row.amount_eur);
    const kmf = BigInt(Math.round(Number(row.total_kmf)));
    if (!Number.isFinite(Number(row.total_kmf)) || kmf < 0n || amount > whole) {
      fail('REFUND_SNAPSHOT_INVALID', 'Montant monétaire figé incohérent');
    }
    const amountKmf = Number((kmf * amount + whole / 2n) / whole);
    const refundType = 'paypal_admin:' + intentId;
    const { rows: [previous] } = await client.query(
      'SELECT id, amount_kmf, amount_eur, refund_method, status FROM refunds WHERE order_id=$1 AND refund_type=$2 FOR UPDATE',
      [orderId, refundType]
    );
    if (previous) {
      if (previous.status !== 'completed' || previous.refund_method !== 'paypal' ||
          Number(previous.amount_kmf) !== amountKmf || euroCents(previous.amount_eur) !== amount) {
        fail('REFUND_SETTLEMENT_REPLAY_CONFLICT', 'Écriture financière antérieure incohérente');
      }
      refundId = previous.id;
      replayed = true;
    } else {
      refundId = await recordExternalRefund(client, {
        orderId, amountKmf, amountEur: Number(row.amount_eur),
        refundType, method: 'paypal', externalRefundId: providerRef,
        reason: 'PayPal remboursement administrateur confirmé',
        initiatedBy: actor.id, conflictOn: 'order_refund_type',
      });
      if (!refundId) fail('REFUND_SETTLEMENT_UNWRITTEN', 'Journal de remboursement absent');
      const { rows: [sum] } = await client.query(
        "SELECT COALESCE(SUM(amount_eur),0)::text AS refunded_eur FROM refunds WHERE order_id=$1 AND status='completed'",
        [orderId]
      );
      const sumCents = euroCents(sum?.refunded_eur ?? '0', true);
      if (sumCents > whole) fail('REFUND_SETTLEMENT_OVER_CAPTURE', 'Remboursements supérieurs au capturé');
      fullyRefunded = sumCents === whole;
      if (fullyRefunded) {
        const updated = await markRefunded(orderId, { client });
        if (!updated.changed) fail('REFUND_PAYMENT_STATUS_CONFLICT', 'Statut de paiement non clôturable');
        const result = await transitionOrderStatus({
          orderId, newStatus: 'refunded',
          actor: { id: actor.id, role: 'admin' }, source: 'refund_external',
          note: `PayPal vérifié, remboursement intégral ${providerRef}`, dbClient: client,
        });
        if (!result.success) fail('REFUND_ORDER_TRANSITION_FAILED', result.error || 'Transition impossible');
      } else {
        // A partial refund is NOT a refunded order or a refunded payment.
        await appendOrderHistoryNote(client, orderId, row.order_status,
          `Remboursement PayPal partiel vérifié ${providerRef}`, actor.id);
      }
    }
    await client.query('COMMIT');
    active = false;
  } catch (error) {
    if (active) await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  try {
    await receipt.issue(refundId, { issuedBy: actor.id });
  } catch (error) {
    log.warn({ error, refundId }, '[FINANCE] reçu différé à la réconciliation documentaire');
  }
  return { status: 200, body: { success: true, intent_id: intentId,
    refund_id: providerRef, refund_status: 'confirmed', partial: !fullyRefunded,
    replayed } };
}

async function finalizeByReadback({ db, paypal, orderId, intentId, providerRefundId, actor }) {
  let result;
  try {
    result = await reconcileRefundIntent({
      intentId, providerRefundId, paypal, db,
    });
  } catch (error) {
    log.error({ error, intentId }, '[FINANCE] preuve PayPal non rapprochée');
    await alertUnknown({ db, orderId, intentId, providerRef: providerRefundId });
    return pending(intentId, 'unknown');
  }
  if (result.status === 'confirmed') return settleConfirmed({ db, orderId, intentId, actor });
  if (result.status === 'failed') return { status: 409, body: {
    success: false, intent_id: intentId, refund_status: 'failed', verified: true } };
  await alertUnknown({ db, orderId, intentId, providerRef: providerRefundId });
  return pending(intentId, 'unknown');
}

async function refundPaypalOrder({
  orderId, amountEur, reason, adminUser, paypal, db,
  requestKey, env = process.env,
}) {
  const operationKey = assertGate({ actor: adminUser, env, requestKey });
  if (!orderId) fail('REFUND_ORDER_REQUIRED', 'Commande requise', 400);
  const { rows: [order] } = await db.query('SELECT * FROM orders WHERE id=$1', [orderId]);
  if (!order) return { status: 404, body: { error: 'Commande introuvable' } };
  if (order.payment_mode !== 'paypal_eur' || !order.paypal_capture_id) {
    fail('REFUND_PAYPAL_CAPTURE_REQUIRED', 'Capture PayPal de cette commande requise');
  }
  const requested = amountEur === undefined || amountEur === null ? order.total_eur : amountEur;
  let cents;
  try { cents = euroCents(requested); } catch (error) {
    return { status: 400, body: { error: 'amountEur invalide', code: error.code } };
  }
  if (cents > euroCents(order.total_eur)) {
    return { status: 400, body: { error: 'Montant refund supérieur au total commande' } };
  }
  const intent = await reserveRefundIntent({ db, orderId, operationKey,
    provider: 'paypal', captureRef: order.paypal_capture_id,
    amountEur: euroString(cents), initiatedBy: adminUser.id });
  if (intent.status === 'confirmed') {
    return settleConfirmed({ db, orderId, intentId: intent.intentId, actor: adminUser });
  }
  if (intent.status !== 'reserved') return pending(intent.intentId, intent.status);
  let claimed;
  try {
    claimed = await claimRefundIntent({ db, intentId: intent.intentId });
  } catch (error) {
    if (error.code === 'REFUND_INTENT_NOT_CLAIMABLE' || error.code === 'REFUND_INTENT_CLAIM_CONFLICT') {
      return pending(intent.intentId, 'processing');
    }
    throw error;
  }
  let providerRef = null;
  try {
    const result = await paypal.refundCapture(claimed.capture_ref, {
      amountEur: Number(claimed.amount_eur),
      reason: String(reason || 'admin_refund').slice(0,255),
      providerRequestKey: claimed.providerRequestKey,
    });
    providerRef = result?.id || null;
  } catch (error) {
    log.warn({ error, intentId: intent.intentId }, '[FINANCE] réponse POST PayPal incertaine; aucune relance');
  }
  // Persist uncertainty BEFORE provider GET or any local settlement. Even when
  // the PSP returned a reference, that is not yet verified success.
  await markUnknown({ db, intentId: intent.intentId, providerRef });
  if (!providerRef) {
    await alertUnknown({ db, orderId, intentId: intent.intentId, providerRef });
    return pending(intent.intentId, 'unknown');
  }
  return finalizeByReadback({ db, paypal, orderId, intentId: intent.intentId,
    providerRefundId: providerRef, actor: adminUser });
}

/** Administrative provider GET only. Does NOT call refundCapture again. */
async function reconcilePaypalRefund({
  orderId, requestKey, providerRefundId, adminUser, paypal, db, env = process.env,
}) {
  const operationKey = assertGate({ actor: adminUser, env, requestKey });
  if (typeof providerRefundId !== 'string' || !/^[A-Za-z0-9_-]{3,127}$/.test(providerRefundId)) {
    fail('REFUND_PROVIDER_REF_INVALID', 'Référence remboursement PayPal requise', 400);
  }
  const { rows: [intent] } = await db.query(
    "SELECT id, status, provider_ref FROM refund_execution_intents WHERE order_id=$1 AND provider='paypal' AND operation_key=$2",
    [orderId, operationKey]
  );
  if (!intent) return { status: 404, body: { error: 'Intention introuvable' } };
  if (intent.provider_ref && intent.provider_ref !== providerRefundId) {
    fail('REFUND_PROVIDER_REF_CONFLICT', 'Référence prestataire contradictoire');
  }
  if (intent.status === 'confirmed') {
    return settleConfirmed({ db, orderId, intentId: intent.id, actor: adminUser });
  }
  if (!['processing','unknown'].includes(intent.status)) {
    fail('REFUND_INTENT_NOT_RECONCILABLE', 'Intention jamais envoyée ou refus définitif');
  }
  return finalizeByReadback({ db, paypal, orderId, intentId: intent.id,
    providerRefundId, actor: adminUser });
}

module.exports = { refundPaypalOrder, reconcilePaypalRefund, settleConfirmed };
