/**
 * @komerce-arch
 * @role          payment-cash-deposit-service
 * @domain        payment
 * @layer         service
 * @criticality   high
 * @inputs        authenticated_actor, deposit_payload_or_id
 * @outputs       cash_deposit_mutation_result
 * @depends       db.js
 * @used-by       routes/cash.js, services/finance-accounting-workspace.js
 * @db-read       cash_deposits
 * @db-write      cash_deposits
 * @db-txn        caller_or_pool
 * @doctrine      single_cash_deposit_mutation_authority, stable_business_reference_at_browser_boundary
 * @impact-areas  payment, cash-reconciliation, admin-dashboard
 * @version       2026-08
 */

'use strict';

const db = require('../db');

const METHODS = Object.freeze(['mobile_money', 'bank', 'physical']);

class CashDepositError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'CashDepositError';
    this.code = code;
    this.status = status;
  }
}

function normalizePayload(payload = {}) {
  const amount = Number(payload.amount_kmf);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new CashDepositError('deposit_amount_invalid', 'Montant requis et > 0', 400);
  }
  if (!METHODS.includes(payload.deposit_method)) {
    throw new CashDepositError(
      'deposit_method_invalid',
      `Méthode invalide. Options: ${METHODS.join(', ')}`,
      400
    );
  }
  if (!payload.period_start || !payload.period_end) {
    throw new CashDepositError('deposit_period_required', 'Période (period_start, period_end) requise', 400);
  }
  return {
    amount_kmf: amount,
    deposit_method: payload.deposit_method,
    reference: payload.reference || null,
    proof_url: payload.proof_url || null,
    period_start: payload.period_start,
    period_end: payload.period_end,
    notes: payload.notes || null,
  };
}

async function createDeposit({ agentId, payload, dbClient = db }) {
  if (!agentId) throw new CashDepositError('deposit_agent_required', 'Agent requis', 400);
  const input = normalizePayload(payload);
  const { rows: [deposit] } = await dbClient.query(`
    INSERT INTO cash_deposits
      (agent_id, amount_kmf, deposit_method, reference, proof_url,
       period_start, period_end, notes)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *
  `, [
    agentId,
    input.amount_kmf,
    input.deposit_method,
    input.reference,
    input.proof_url,
    input.period_start,
    input.period_end,
    input.notes,
  ]);
  return deposit;
}

async function verifyDeposit({ depositId, verifierId, notes = null, dbClient = db }) {
  if (!depositId) throw new CashDepositError('deposit_id_required', 'Dépôt requis', 400);
  const { rows: [deposit] } = await dbClient.query(`
    UPDATE cash_deposits
       SET status = 'verified',
           verified_by = $1,
           verified_at = NOW(),
           notes = COALESCE($3, notes)
     WHERE id = $2
     RETURNING *
  `, [verifierId || null, depositId, notes || null]);
  if (!deposit) throw new CashDepositError('deposit_not_found', 'Dépôt introuvable', 404);
  return deposit;
}

async function disputeDeposit({ depositId, verifierId, reason, dbClient = db }) {
  if (!reason) throw new CashDepositError('deposit_dispute_reason_required', 'Raison requise', 400);
  const { rows: [deposit] } = await dbClient.query(`
    UPDATE cash_deposits
       SET status = 'disputed',
           verified_by = $1,
           verified_at = NOW(),
           notes = $3
     WHERE id = $2
     RETURNING *
  `, [verifierId || null, depositId, reason]);
  if (!deposit) throw new CashDepositError('deposit_not_found', 'Dépôt introuvable', 404);
  return deposit;
}

module.exports = {
  METHODS,
  CashDepositError,
  normalizePayload,
  createDeposit,
  verifyDeposit,
  disputeDeposit,
};
