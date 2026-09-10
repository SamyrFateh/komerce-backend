/**
 * @komerce-arch
 * @role          market-settlement-lifecycle-owner
 * @domain        settlement
 * @layer         service
 * @criticality   high
 * @inputs        central attestation, assignment-scoped request/receipt, central payment attestation
 * @outputs       immutable settlement snapshots and append-only lifecycle events
 * @depends       db executor supplied by caller
 * @used-by       routes/admin-market-settlement.js, services/market-delegation-settlement-service.js
 * @db-read       markets, market_operating_assignments, market_settlements
 * @db-write      market_settlements, market_settlement_events
 * @db-txn        caller-owned
 * @doctrine      ready_is_central_attestation_not_formula, monetary_snapshot_immutable, strict_ready_requested_paid_received_machine
 * @impact-areas  finance, market-delegation, settlement
 * @version       2026-09
 */
'use strict';

class MarketSettlementError extends Error {
  constructor(code, message, status = 400) {
    super(message || code);
    this.name = 'MarketSettlementError';
    this.code = code;
    this.status = status;
  }
}

function requireExecutor(executor) {
  if (!executor || typeof executor.query !== 'function') {
    throw new TypeError('market-settlement-service: executor.query requis');
  }
  return executor;
}

function normalizeAmount(value) {
  const text = String(value == null ? '' : value).trim();
  if (!/^\d{1,18}(?:\.\d{1,6})?$/.test(text) || !/[1-9]/.test(text.replace('.', ''))) {
    throw new MarketSettlementError('SETTLEMENT_AMOUNT_INVALID', 'Montant de settlement invalide.', 400);
  }
  return text;
}

function optionalText(value, max = 1000) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (text.length > max) throw new MarketSettlementError('SETTLEMENT_TEXT_TOO_LONG', 'Texte de settlement trop long.', 400);
  return text;
}

function optionalDate(value) {
  if (value == null || value === '') return null;
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new MarketSettlementError('SETTLEMENT_DATE_INVALID', 'Date de settlement invalide.', 400);
  }
  return text;
}

function publicSettlement(row) {
  if (!row) return null;
  return {
    id: row.id,
    market_id: row.market_id,
    assignment_id: row.assignment_id,
    amount: row.amount == null ? null : String(row.amount),
    currency: row.currency,
    source: row.source,
    source_reference: row.source_reference || null,
    period_start: row.period_start || null,
    period_end: row.period_end || null,
    attestation_note: row.attestation_note || null,
    status: row.status,
    requested_by: row.requested_by || null,
    requested_at: row.requested_at || null,
    paid_at: row.paid_at || null,
    payment_reference: row.payment_reference || null,
    received_at: row.received_at || null,
    receipt_note: row.receipt_note || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function appendEvent(db, { settlementId, actorUserId = null, eventType, payload = null, correlationId = null }) {
  await db.query(
    `INSERT INTO market_settlement_events
       (settlement_id, actor_user_id, event_type, payload, correlation_id)
     VALUES ($1::uuid,$2::uuid,$3,$4::jsonb,$5)`,
    [settlementId, actorUserId, eventType, payload == null ? null : JSON.stringify(payload), correlationId]
  );
}

async function listForAssignment(executor, { marketId, assignmentId }) {
  const db = requireExecutor(executor);
  const { rows } = await db.query(
    `SELECT *
       FROM market_settlements
      WHERE market_id=$1::uuid
        AND assignment_id=$2::uuid
      ORDER BY created_at DESC`,
    [marketId, assignmentId]
  );
  return rows.map(publicSettlement);
}

async function resolveActiveAssignmentSnapshot(db, { marketId, assignmentId }) {
  const { rows } = await db.query(
    `SELECT m.id AS market_id, m.code AS market_code, m.currency,
            a.id AS assignment_id, a.status AS assignment_status
       FROM markets m
       JOIN market_operating_assignments a ON a.market_id = m.id
      WHERE m.id=$1::uuid
        AND a.id=$2::uuid
        AND m.is_active=TRUE
        AND a.status='ACTIVE'
      LIMIT 1`,
    [marketId, assignmentId]
  );
  if (!rows[0]) {
    throw new MarketSettlementError('SETTLEMENT_ACTIVE_ASSIGNMENT_REQUIRED', 'Assignment marché actif requis.', 409);
  }
  return rows[0];
}

async function createReadySettlement(executor, {
  marketId,
  assignmentId,
  amount,
  sourceReference = null,
  periodStart = null,
  periodEnd = null,
  attestationNote = null,
  actorUserId,
  correlationId = null,
}) {
  const db = requireExecutor(executor);
  if (!actorUserId) throw new MarketSettlementError('SETTLEMENT_ATTESTOR_REQUIRED', 'Acteur central requis.', 401);
  const snapshot = await resolveActiveAssignmentSnapshot(db, { marketId, assignmentId });
  const normalizedAmount = normalizeAmount(amount);
  const start = optionalDate(periodStart);
  const end = optionalDate(periodEnd);
  if (start && end && end < start) {
    throw new MarketSettlementError('SETTLEMENT_PERIOD_INVALID', 'La fin de période doit être postérieure au début.', 400);
  }

  const { rows } = await db.query(
    `INSERT INTO market_settlements
       (market_id, assignment_id, amount, currency, source, source_reference,
        period_start, period_end, attestation_note, status, attested_by)
     VALUES ($1::uuid,$2::uuid,$3::numeric,$4,'CENTRAL_ATTESTATION',$5,$6::date,$7::date,$8,'READY',$9::uuid)
     RETURNING *`,
    [marketId, assignmentId, normalizedAmount, snapshot.currency,
      optionalText(sourceReference, 200), start, end, optionalText(attestationNote, 2000), actorUserId]
  );
  const settlement = publicSettlement(rows[0]);
  await appendEvent(db, {
    settlementId: settlement.id,
    actorUserId,
    eventType: 'READY_ATTESTED',
    payload: { amount: settlement.amount, currency: settlement.currency, source: 'CENTRAL_ATTESTATION' },
    correlationId,
  });
  return settlement;
}

async function lockForAssignment(db, { settlementId, marketId, assignmentId }) {
  const { rows } = await db.query(
    `SELECT * FROM market_settlements
      WHERE id=$1::uuid AND market_id=$2::uuid AND assignment_id=$3::uuid
      FOR UPDATE`,
    [settlementId, marketId, assignmentId]
  );
  if (!rows[0]) {
    throw new MarketSettlementError('SETTLEMENT_NOT_FOUND', 'Settlement introuvable dans ce Market ID.', 404);
  }
  return rows[0];
}

async function lockById(db, settlementId) {
  const { rows } = await db.query(`SELECT * FROM market_settlements WHERE id=$1::uuid FOR UPDATE`, [settlementId]);
  if (!rows[0]) throw new MarketSettlementError('SETTLEMENT_NOT_FOUND', 'Settlement introuvable.', 404);
  return rows[0];
}

function requireStatus(row, expected) {
  if (row.status !== expected) {
    throw new MarketSettlementError(
      'SETTLEMENT_TRANSITION_INVALID',
      `Transition settlement invalide depuis ${row.status}; statut attendu ${expected}.`,
      409
    );
  }
}

async function requestSettlement(executor, { settlementId, marketId, assignmentId, actorUserId, correlationId = null }) {
  const db = requireExecutor(executor);
  const beforeRow = await lockForAssignment(db, { settlementId, marketId, assignmentId });
  requireStatus(beforeRow, 'READY');
  const { rows } = await db.query(
    `UPDATE market_settlements
        SET status='REQUESTED', requested_by=$2::uuid, requested_at=NOW()
      WHERE id=$1::uuid AND status='READY'
      RETURNING *`,
    [settlementId, actorUserId]
  );
  const before = publicSettlement(beforeRow);
  const after = publicSettlement(rows[0]);
  await appendEvent(db, { settlementId, actorUserId, eventType: 'REQUESTED', correlationId });
  return { before, after };
}

async function markPaid(executor, { settlementId, actorUserId, paymentReference, correlationId = null }) {
  const db = requireExecutor(executor);
  const beforeRow = await lockById(db, settlementId);
  requireStatus(beforeRow, 'REQUESTED');
  const reference = optionalText(paymentReference, 200);
  if (!reference) throw new MarketSettlementError('SETTLEMENT_PAYMENT_REFERENCE_REQUIRED', 'Référence de paiement requise.', 400);
  const { rows } = await db.query(
    `UPDATE market_settlements
        SET status='PAID', paid_by=$2::uuid, paid_at=NOW(), payment_reference=$3
      WHERE id=$1::uuid AND status='REQUESTED'
      RETURNING *`,
    [settlementId, actorUserId, reference]
  );
  const before = publicSettlement(beforeRow);
  const after = publicSettlement(rows[0]);
  await appendEvent(db, {
    settlementId,
    actorUserId,
    eventType: 'PAID',
    payload: { payment_reference: reference },
    correlationId,
  });
  return { before, after };
}

async function confirmReceived(executor, {
  settlementId,
  marketId,
  assignmentId,
  actorUserId,
  receiptNote = null,
  correlationId = null,
}) {
  const db = requireExecutor(executor);
  const beforeRow = await lockForAssignment(db, { settlementId, marketId, assignmentId });
  requireStatus(beforeRow, 'PAID');
  const note = optionalText(receiptNote, 2000);
  const { rows } = await db.query(
    `UPDATE market_settlements
        SET status='RECEIVED', received_by=$2::uuid, received_at=NOW(), receipt_note=$3
      WHERE id=$1::uuid AND status='PAID'
      RETURNING *`,
    [settlementId, actorUserId, note]
  );
  const before = publicSettlement(beforeRow);
  const after = publicSettlement(rows[0]);
  await appendEvent(db, { settlementId, actorUserId, eventType: 'RECEIVED', payload: note ? { receipt_note: note } : null, correlationId });
  return { before, after };
}

module.exports = {
  MarketSettlementError,
  normalizeAmount,
  optionalDate,
  publicSettlement,
  listForAssignment,
  createReadySettlement,
  requestSettlement,
  markPaid,
  confirmReceived,
};
