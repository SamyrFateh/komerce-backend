/**
 * @komerce-arch
 * @role          verified-manual-mobile-refund-handoff
 * @domain        refunds
 * @layer         service
 * @criticality   high
 * @inputs        authenticated operators, reserved native obligation, reviewed offline transfer evidence
 * @outputs       approved, transfer_pending or settled handoff
 * @depends       db, services/documents/refund-receipt.js, migrations/418_fable_manual_mobile_money_refund.sql
 * @used-by       routes/admin/orders.js
 * @db-read       orders, local_item_refund_reservations, mobile_money_transactions, local_mobile_refund_handoffs, refunds
 * @db-write      local_mobile_refund_handoffs
 * @db-txn        order lock then handoff lock, proof-backed settlement before document issuance
 * @doctrine      independent_human_attestation, original_payer, no_blind_retry
 * @impact-areas  refunds, payments, documents
 * @version       2026-11
 */
'use strict';

const defaultDb = require('../db');
const { issue: issueRefundReceipt } = require('./documents/refund-receipt');
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const FINGERPRINT = /^[a-f0-9]{64}$/;
const MINOR = /^[1-9][0-9]{0,18}$/;

function fail(code, message, status = 409) {
  throw Object.assign(new Error(message), { code, status });
}

function evidenceRef(value) {
  const ref = typeof value === 'string' ? value.trim() : '';
  if (ref.length < 8 || ref.length > 200 || /[\x00-\x1f]/.test(ref)) {
    fail('LOCAL_MOBILE_REFUND_PROOF_REQUIRED', 'Référence de preuve vérifiée requise', 422);
  }
  return ref;
}

async function loadHandoff(client, { orderId, orderItemId, reservationId }) {
  const { rows: [order] } = await client.query(
    "SELECT id FROM orders WHERE id=$1 AND payment_status='paid' FOR UPDATE", [orderId]
  );
  if (!order) fail('LOCAL_MOBILE_REFUND_ORDER_NOT_PAID', 'Commande payée introuvable', 404);
  const { rows: [reservation] } = await client.query(
    `SELECT r.amount_minor, r.currency, r.minor_unit, t.provider,
              t.external_transaction_id AS capture_external_transaction_id
       FROM local_item_refund_reservations r
       JOIN mobile_money_transactions t ON t.id::text=r.capture_ref
        AND t.order_id=r.order_id AND t.market_id=r.market_id
      WHERE r.id=$1 AND r.order_id=$2 AND r.order_item_id=$3
        AND r.payment_mode='mobile_money' AND t.status='succeeded'
        AND NULLIF(btrim(t.external_transaction_id),'') IS NOT NULL
        AND t.currency=r.currency AND t.minor_unit=r.minor_unit AND t.amount_minor>=r.amount_minor`,
    [reservationId, orderId, orderItemId]
  );
  if (!reservation) fail('LOCAL_MOBILE_REFUND_CAPTURE_INVALID', 'Réservation ou capture d’origine non vérifiable', 404);
  const { rows: [handoff] } = await client.query(
    'SELECT * FROM local_mobile_refund_handoffs WHERE reservation_id=$1 FOR UPDATE', [reservationId]
  );
  return { reservation, handoff };
}

async function approve(client, reservation, handoff, reservationId, actor, body) {
  const { operator_id: operatorId, payer_fingerprint: fingerprint } = body;
  const proof = evidenceRef(body.original_payer_proof_ref);
  if (!UUID.test(operatorId || '') || operatorId === actor.id || !FINGERPRINT.test(fingerprint || '')) {
    fail('LOCAL_MOBILE_REFUND_APPROVAL_INVALID', 'Opérateur distinct et empreinte du payeur vérifié requis', 422);
  }
  if (handoff) {
    if (handoff.approved_by !== actor.id || handoff.operator_id !== operatorId ||
        handoff.payer_fingerprint !== fingerprint || handoff.original_payer_proof_ref !== proof) {
      fail('LOCAL_MOBILE_REFUND_REPLAY_CONFLICT', 'Autorisation existante avec une preuve différente');
    }
    return { status: handoff.status, replayed: true };
  }
  await client.query(
    `INSERT INTO local_mobile_refund_handoffs
     (reservation_id,approved_by,operator_id,provider,payer_fingerprint,original_payer_proof_ref,source_capture_ref)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [reservationId, actor.id, operatorId, reservation.provider, fingerprint, proof,
      evidenceRef(reservation.capture_external_transaction_id)]
  );
  return { status: 'approved', replayed: false };
}

async function start(client, handoff, reservationId, actor) {
  if (handoff.operator_id !== actor.id) {
    fail('LOCAL_MOBILE_REFUND_OPERATOR_REQUIRED', 'Seul l’opérateur désigné peut engager le virement', 403);
  }
  if (handoff.status !== 'approved') {
    return { status: handoff.status, replayed: true, doNotTransferAgain: true };
  }
  await client.query(
    "UPDATE local_mobile_refund_handoffs SET status='transfer_pending',started_at=NOW() WHERE reservation_id=$1",
    [reservationId]
  );
  return { status: 'transfer_pending', replayed: false };
}

async function confirm(client, reservation, handoff, reservationId, actor, body) {
  if (handoff.operator_id === actor.id || handoff.approved_by === actor.id) {
    fail('LOCAL_MOBILE_REFUND_INDEPENDENT_REVIEW_REQUIRED',
      'Contrôleur distinct de l’opérateur et de l’autorisateur requis', 403);
  }
  // Manual verification: the independent reviewer must inspect BOTH external
  // documents. An MSISDN typed by a customer is not original-payer evidence.
  const sourceRef = evidenceRef(body.capture_external_transaction_id);
  const verificationRef = evidenceRef(body.operator_verification_ref);
  const ref = evidenceRef(body.transfer_ref);
  const proof = evidenceRef(body.transfer_proof_ref);
  const { amount_minor: minor, currency, payee_fingerprint: fingerprint } = body;
  if (typeof minor !== 'string' || !MINOR.test(minor) || minor !== String(reservation.amount_minor) ||
      currency !== reservation.currency || fingerprint !== handoff.payer_fingerprint ||
      sourceRef !== handoff.source_capture_ref ||
      ref.toLowerCase() === sourceRef.toLowerCase() ||
      verificationRef === proof || verificationRef === handoff.original_payer_proof_ref ||
      proof === handoff.original_payer_proof_ref) {
    fail('LOCAL_MOBILE_REFUND_TRANSFER_MISMATCH', 'La preuve du virement doit correspondre au montant, à la devise et au payeur d’origine');
  }
  const replayed = handoff.status === 'settled';
  if (replayed) {
    if (handoff.transfer_ref !== ref || handoff.transfer_proof_ref !== proof ||
        handoff.operator_verification_ref !== verificationRef) {
      fail('LOCAL_MOBILE_REFUND_REPLAY_CONFLICT', 'Virement déjà rapproché avec une autre preuve');
    }
  } else {
    if (handoff.status !== 'transfer_pending') {
      fail('LOCAL_MOBILE_REFUND_NOT_STARTED', 'Le virement doit être engagé avant rapprochement');
    }
    await client.query(
      `UPDATE local_mobile_refund_handoffs SET status='settled', confirmed_at=NOW(), confirmed_by=$2,
         transfer_ref=$3, transfer_proof_ref=$4, settled_amount_minor=$5, settled_currency=$6,
         settled_payee_fingerprint=$7, operator_verification_ref=$8 WHERE reservation_id=$1`,
      [reservationId, actor.id, ref, proof, minor, currency, fingerprint, verificationRef]
    );
  }
  const { rows: [refund] } = await client.query(
    'SELECT id FROM refunds WHERE local_mobile_refund_handoff_id=$1', [reservationId]
  );
  if (!refund) fail('LOCAL_MOBILE_REFUND_SETTLEMENT_MISSING', 'Règlement non finalisé');
  return { status: 'settled', replayed, refundId: refund.id };
}

async function recordManualMobileRefund({ action, orderId, orderItemId, reservationId, actor, body = {},
  db = defaultDb, issueReceipt = issueRefundReceipt }) {
  if (actor?.role !== 'admin' || !UUID.test(actor.id || '')) {
    fail('LOCAL_MOBILE_REFUND_ADMIN_REQUIRED', 'Accès admin requis', 403);
  }
  if (![orderId, orderItemId, reservationId].every(id => UUID.test(id || '')) ||
      !['approve', 'start', 'confirm'].includes(action)) {
    fail('LOCAL_MOBILE_REFUND_REQUEST_INVALID', 'Action ou identifiants invalides', 422);
  }
  let result;
  try {
    result = await db.withTransaction(async client => {
      const { reservation, handoff } = await loadHandoff(client, { orderId, orderItemId, reservationId });
      if (action === 'approve') return approve(client, reservation, handoff, reservationId, actor, body);
      if (!handoff) fail('LOCAL_MOBILE_REFUND_APPROVAL_REQUIRED', 'Autorisation préalable requise');
      if (action === 'start') return start(client, handoff, reservationId, actor);
      return confirm(client, reservation, handoff, reservationId, actor, body);
    });
  } catch (error) {
    if (error.code === '23505') fail('LOCAL_MOBILE_REFUND_REPLAY_CONFLICT', 'Référence de virement déjà enregistrée');
    if (error.code === '23514') fail('LOCAL_MOBILE_REFUND_DB_GUARD', 'Preuve ou état financier refusé');
    throw error;
  }
  const response = { ...result, paid: result.status === 'settled' };
  if (!result.refundId) return response;
  try {
    const receipt = await issueReceipt(result.refundId, { issuedBy: actor.id });
    return { ...response, documentStatus: 'issued', receiptRef: receipt.reference };
  } catch {
    return { ...response, documentStatus: 'pending', receiptRef: null };
  }
}

module.exports = { recordManualMobileRefund };
