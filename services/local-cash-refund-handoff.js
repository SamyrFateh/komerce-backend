/**
 * @komerce-arch
 * @role          fable-cash-refund-custody-handoff
 * @domain        refunds
 * @layer         service
 * @criticality   critical
 * @inputs        admin-approved verified original payer and cash holder; physical handoff receipt by holder
 * @outputs       independent approval, nonrepeatable handoff, atomic custody outflow / refunds / qty / receipt
 * @depends       db, services/documents/refund-receipt.js, migrations/417_fable_cash_refund_custody_handoff.sql
 * @used-by       routes/admin/orders.js
 * @db-read       orders, local_item_refund_reservations, cash_collections, users, relais, local_cash_refund_authorizations, local_cash_refund_payouts, refunds, cash_custody_movements
 * @db-write      local_cash_refund_authorizations, local_cash_refund_payouts
 * @db-write-via:local-cash-refund-payout-trigger order_items, refunds
 * @db-txn        order lock, approval lock, cash_custody_lock, balance nonnegative, receipt before COMMIT
 * @doctrine      human_verified_original_payer, two_distinct_actors, no_retry_ambiguous_handoff, cash_only_KMF
 * @impact-areas  refunds, orders, cash-custody, documents
 * @version       2026-11
 */
'use strict';
const defaultDb = require('../db');
const { issue: issueRefundReceipt } = require('./documents/refund-receipt');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class CashHandoffError extends Error {
  constructor(code, message, status = 409) { super(message); this.code = code; this.status = status; }
}
const fail = (code, message, status = 409) => { throw new CashHandoffError(code, message, status); };
function uuid(value, name) {
  if (!UUID.test(String(value || ''))) fail('LOCAL_CASH_REFUND_ID_INVALID', name + ' UUID requis', 400);
  return String(value);
}
function proof(value, name) {
  if (typeof value !== 'string' || value.trim().length < 8 || value.trim().length > 200
      || /[\x00-\x1f]/.test(value))
    fail('LOCAL_CASH_REFUND_PROOF_REQUIRED', name + ' : référence de preuve conservée obligatoire', 400);
  return value.trim();
}
function requireRole(actor, role) {
  uuid(actor && actor.id, 'acteur');
  if (actor.role !== role) fail('LOCAL_CASH_REFUND_ACTOR_FORBIDDEN', 'Rôle requis : ' + role, 403);
}
async function transaction(db, fn) {
  const client = await db.getClient();
  let open = false;
  try {
    await client.query('BEGIN'); open = true;
    const result = await fn(client);
    await client.query('COMMIT'); open = false;
    return result;
  } catch (err) {
    if (open) await client.query('ROLLBACK').catch(() => {});
    if (err && err.code === '23514')
      fail('LOCAL_CASH_REFUND_DB_GUARD', 'Contrainte de sécurité financière refusée');
    if (err && err.code === '23505')
      fail('LOCAL_CASH_REFUND_REPLAY_CONFLICT', 'Opération déjà enregistrée avec une autre preuve');
    throw err;
  } finally { client.release(); }
}
async function lockOrderForReservation(c, reservationId, orderId, itemId) {
  const { rows: [source] } = await c.query(
    'SELECT order_id FROM local_item_refund_reservations WHERE id=$1', [reservationId]);
  if (!source || String(source.order_id) !== orderId)
    fail('LOCAL_CASH_REFUND_RESERVATION_NOT_FOUND', 'Réservation hors commande', 404);
  await c.query('SELECT id FROM orders WHERE id=$1 FOR UPDATE', [orderId]);
  const { rows: [r] } = await c.query(
    'SELECT r.*, o.payment_status, o.relais_id FROM local_item_refund_reservations r ' +
    'JOIN orders o ON o.id=r.order_id WHERE r.id=$1 AND r.order_id=$2 AND r.order_item_id=$3',
    [reservationId, orderId, itemId]);
  if (!r || r.payment_mode !== 'cash_relais' || r.currency !== 'KMF' || Number(r.minor_unit) !== 0
      || r.status !== 'reserved' || r.payment_status !== 'paid')
    fail('LOCAL_CASH_REFUND_SOURCE_INVALID', 'Seule une dette cash attestée et payée est admissible');
  return r;
}
async function lockAuthorization(c, authId, orderId, itemId) {
  const { rows: [auth] } = await c.query(
    'SELECT id, reservation_id, order_id FROM local_cash_refund_authorizations WHERE id=$1', [authId]);
  if (!auth || String(auth.order_id) !== orderId)
    fail('LOCAL_CASH_REFUND_AUTH_NOT_FOUND', 'Autorisation hors commande', 404);
  const r = await lockOrderForReservation(c, auth.reservation_id, orderId, itemId);
  const { rows: [row] } = await c.query(
    'SELECT * FROM local_cash_refund_authorizations WHERE id=$1 FOR UPDATE', [authId]);
  return { auth: row, r };
}
function checkHolder(auth, actor) {
  requireRole(actor, 'agent_relais');
  if (String(auth.holder_id) !== String(actor.id))
    fail('LOCAL_CASH_REFUND_WRONG_HOLDER', 'Seul le détenteur autorisé peut remettre les espèces', 403);
}

async function authorizeCashRefund({ orderId, orderItemId, reservationId, holderId,
  originalPayerProofRef, identityCheckProofRef, actor, db = defaultDb }) {
  requireRole(actor, 'admin');
  const oid=uuid(orderId,'orderId'), iid=uuid(orderItemId,'orderItemId'),
    rid=uuid(reservationId,'reservationId'), hid=uuid(holderId,'holderId');
  const origin=proof(originalPayerProofRef,'Preuve du payeur original'),
    identity=proof(identityCheckProofRef,'Contrôle contradictoire de l identité');
  if (origin===identity) fail('LOCAL_CASH_REFUND_DISTINCT_EVIDENCE_REQUIRED','Deux preuves distinctes requises');
  if (hid===String(actor.id)) fail('LOCAL_CASH_REFUND_DUAL_ACTOR_REQUIRED','Validateur et détenteur distincts');
  return transaction(db, async c => {
    const r = await lockOrderForReservation(c,rid,oid,iid);
    const { rows: [cc] } = await c.query(
      'SELECT id FROM cash_collections WHERE id=$1::uuid AND order_id=$2 AND relais_id=$3',
      [r.capture_ref,oid,r.relais_id]);
    if (!cc) fail('LOCAL_CASH_REFUND_CAPTURE_MISSING','Collecte initiale non rapprochée');
    const { rows: [holder] } = await c.query(
      "SELECT u.id FROM users u JOIN relais rel ON rel.id=u.relais_id WHERE u.id=$1 AND u.role='agent_relais' AND rel.market_id=$2",
      [hid,r.market_id]);
    if (!holder) fail('LOCAL_CASH_REFUND_HOLDER_SCOPE','Détenteur non habilité sur le marché',403);
    const { rows: [prior] } = await c.query(
      'SELECT * FROM local_cash_refund_authorizations WHERE reservation_id=$1 FOR UPDATE',[rid]);
    if (prior) {
      if (String(prior.holder_id)!==hid || String(prior.approved_by)!==String(actor.id)
        || prior.original_payer_proof_ref!==origin || prior.identity_check_proof_ref!==identity)
        fail('LOCAL_CASH_REFUND_AUTH_CONFLICT','Autorisation existante : preuves divergentes');
      return {authorizationId:prior.id,status:prior.status,paid:prior.status==='settled',replayed:true};
    }
    const { rows: [approved] } = await c.query(
      'INSERT INTO local_cash_refund_authorizations ' +
      '(reservation_id,order_id,market_id,holder_id,approved_by,original_payer_proof_ref,identity_check_proof_ref) ' +
      'VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id,status',
      [rid,oid,r.market_id,hid,actor.id,origin,identity]);
    return {authorizationId:approved.id,status:approved.status,paid:false,replayed:false};
  });
}

async function beginCashHandoff({ orderId, orderItemId, authorizationId, actor, db = defaultDb }) {
  requireRole(actor,'agent_relais');
  const oid=uuid(orderId,'orderId'),iid=uuid(orderItemId,'orderItemId'),aid=uuid(authorizationId,'authorizationId');
  return transaction(db, async c => {
    const { auth }=await lockAuthorization(c,aid,oid,iid);
    checkHolder(auth,actor);
    if (auth.status==='settled')
      return {authorizationId:aid,status:'settled',paid:true,replayed:true,doNotHandOverAgain:true};
    if (auth.status==='handoff_pending')
      return {authorizationId:aid,status:'handoff_pending',paid:false,replayed:true,doNotHandOverAgain:true};
    if (auth.status!=='approved') fail('LOCAL_CASH_REFUND_STATE_INVALID','État de remise inconnu');
    const { rows: [row] }=await c.query(
      "UPDATE local_cash_refund_authorizations SET status='handoff_pending',handoff_started_at=NOW() " +
      "WHERE id=$1 AND status='approved' RETURNING id,status",[aid]);
    if (!row) fail('LOCAL_CASH_REFUND_HANDOFF_CONFLICT','Début de remise déjà consommé');
    return {authorizationId:aid,status:row.status,paid:false,replayed:false,
      message:'Autorisation consommée. Remettre une fois au payeur vérifié ; en cas de doute, ne jamais rejouer.'};
  });
}

async function confirmCashHandoff({ orderId, orderItemId, authorizationId,
  signedReceiptRef, payerSignatureProofRef, witnessProofRef, actor, db = defaultDb }) {
  requireRole(actor,'agent_relais');
  const oid=uuid(orderId,'orderId'),iid=uuid(orderItemId,'orderItemId'),aid=uuid(authorizationId,'authorizationId'),
    signed=proof(signedReceiptRef,'Quittance signée'),signature=proof(payerSignatureProofRef,'Preuve signature payeur'),
    witness=proof(witnessProofRef,'Preuve témoin');
  if (signature===witness) fail('LOCAL_CASH_REFUND_WITNESS_INDEPENDENT','Témoin et signature sont des preuves distinctes');

  // CRITICAL: commit the authoritative physical handoff, custody outflow and
  // refunds/qty BEFORE attempting a generated digital document. A PDF outage
  // must never roll back books after real cash physically left the custodian.
  const outcome=await transaction(db, async c => {
    const { auth,r }=await lockAuthorization(c,aid,oid,iid);
    checkHolder(auth,actor);
    if (auth.status==='settled') {
      const { rows: [p] }=await c.query(
        'SELECT p.id,p.signed_receipt_ref,p.payer_signature_proof_ref,p.witness_proof_ref,' +
        'f.id AS refund_id FROM local_cash_refund_payouts p ' +
        'JOIN refunds f ON f.local_cash_refund_payout_id=p.id WHERE p.authorization_id=$1',[aid]);
      if (!p || p.signed_receipt_ref!==signed ||
        p.payer_signature_proof_ref!==signature || p.witness_proof_ref!==witness)
        fail('LOCAL_CASH_REFUND_SETTLED_CONFLICT','Déjà remboursé avec une autre quittance');
      return {authorizationId:aid,status:'settled',paid:true,replayed:true,
        payoutId:p.id,refundId:p.refund_id};
    }
    if (auth.status!=='handoff_pending')
      fail('LOCAL_CASH_REFUND_HANDOFF_NOT_STARTED','La remise physique doit être engagée avant confirmation');
    const { rows: [p] }=await c.query(
      'INSERT INTO local_cash_refund_payouts ' +
      '(authorization_id,reservation_id,order_id,market_id,holder_id,paid_by,amount_kmf,' +
      'signed_receipt_ref,payer_signature_proof_ref,witness_proof_ref) ' +
      'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id',
      [aid,r.id,oid,r.market_id,auth.holder_id,actor.id,r.amount_kmf,signed,signature,witness]);
    // SQL AFTER INSERT trigger serializes custody and inserts refunds.completed + qty_refunded.
    const { rows: [f] }=await c.query(
      'SELECT id FROM refunds WHERE local_cash_refund_payout_id=$1',[p.id]);
    if (!f) fail('LOCAL_CASH_REFUND_FINALIZATION_MISSING','Transaction financière non finalisée');
    return {authorizationId:aid,status:'settled',paid:true,replayed:false,
      payoutId:p.id,refundId:f.id};
  });

  // Post-commit idempotent document. Paper signed receipt remains durable in
  // local_cash_refund_payouts. On failure the caller sees paid=true and a
  // document_pending state; no second physical handoff or ledger mutation.
  try {
    const doc=await issueRefundReceipt(outcome.refundId,{issuedBy:actor.id});
    return {...outcome,documentStatus:'issued',receiptRef:doc.reference};
  } catch(error) {
    return {...outcome,documentStatus:'pending',receiptRef:null,
      documentError:'REFUND_RECEIPT_RECONCILIATION_REQUIRED'};
  }
}

module.exports={ CashHandoffError, authorizeCashRefund, beginCashHandoff, confirmCashHandoff };
