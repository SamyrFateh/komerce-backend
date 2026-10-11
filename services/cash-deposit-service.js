/**
 * @komerce-arch
 * @role          payment-cash-deposit-service
 * @domain        payment
 * @layer         service
 * @criticality   high
 * @inputs        authenticated_actor, deposit_payload_or_id
 * @outputs       cash_deposit_mutation_result
 * @depends       db.js, utils/currency.js, services/market-delegation-service.js
 * @used-by       routes/cash.js, services/finance-accounting-workspace.js
 * @db-read       cash_collections, cash_deposits, relais, users
 * @db-write      cash_deposits, market_delegation_audit
 * @db-txn        caller_or_pool
 * @doctrine      single_cash_deposit_mutation_authority, stable_business_reference_at_browser_boundary
 * @impact-areas  payment, cash-reconciliation, admin-dashboard
 * @version       2026-08
 */

'use strict';

const db = require('../db');
const { getCurrencyParity, roundToMinorUnit } = require('../utils/currency');
const { audit } = require('./market-delegation-service');

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

/**
 * Montant déclaré en devise d'origine -> snapshot figé + amount_kmf canonique.
 * Un seul calcul : parités de utils/currency.js (via EUR), échec fermé si la
 * parité manque. Sans declared_currency : chemin historique (amount_kmf libre).
 */
async function resolveDeclaredAmount(payload = {}) {
  const currency = payload.declared_currency;
  if (currency === undefined || currency === null || currency === '') return { payload, snapshot: null };
  if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) {
    throw new CashDepositError('deposit_currency_invalid', 'Devise invalide (code ISO 4217 en majuscules)', 400);
  }
  const declared = Number(payload.declared_amount);
  if (!Number.isFinite(declared) || declared <= 0) {
    throw new CashDepositError('deposit_amount_invalid', 'Montant requis et > 0', 400);
  }
  let rate = 1;
  let source = 'identity:KMF';
  if (currency !== 'KMF') {
    let kmfRate;
    let fromRate;
    try {
      [fromRate, kmfRate] = await Promise.all([getCurrencyParity(currency), getCurrencyParity('KMF')]);
    } catch (err) {
      throw new CashDepositError('deposit_currency_parity_missing', `Aucune parité enregistrée pour ${currency}`, 422);
    }
    rate = roundToMinorUnit(kmfRate / fromRate, 6);
    source = `currency_parities:${currency}->EUR->KMF`;
  }
  const amountKmf = roundToMinorUnit(declared * rate, 2);
  return {
    payload: { ...payload, amount_kmf: amountKmf },
    snapshot: { declared_amount: declared, declared_currency: currency, fx_rate_to_kmf: rate, fx_source: source },
  };
}

async function createDeposit({ agentId, payload, dbClient = db }) {
  if (!agentId) throw new CashDepositError('deposit_agent_required', 'Agent requis', 400);
  const resolved = await resolveDeclaredAmount(payload);
  const input = normalizePayload(resolved.payload);
  const snap = resolved.snapshot || {};
  const { rows: [deposit] } = await dbClient.query(`
    INSERT INTO cash_deposits
      (agent_id, amount_kmf, deposit_method, reference, proof_url,
       period_start, period_end, notes,
       declared_amount, declared_currency, fx_rate_to_kmf, fx_source)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
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
    snap.declared_amount ?? null,
    snap.declared_currency ?? null,
    snap.fx_rate_to_kmf ?? null,
    snap.fx_source ?? null,
  ]);
  return deposit;
}

// Transitions légales d'une revue de dépôt. Un dépôt vérifié est terminal, sauf
// correction exceptionnelle centrale explicite (verified → disputed, motif obligatoire).
const REVIEW_TRANSITIONS = Object.freeze({
  pending: ['verified', 'disputed'],
  disputed: ['verified'],
});

const CENTRAL_AUDIT_ACTIONS = Object.freeze({
  verified: 'CASH_DEPOSIT_CENTRAL_VERIFIED',
  disputed: 'CASH_DEPOSIT_CENTRAL_DISPUTED',
  correction: 'CASH_DEPOSIT_CENTRAL_CORRECTED',
});

async function withTransaction(dbClient, work) {
  if (dbClient !== db) return work(dbClient);
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* conserver l'erreur d'origine */ }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Autorité unique de revue : verrou, déclarant ≠ vérificateur, transition légale,
 * jamais d'écrasement silencieux d'une validation. `central` ajoute l'audit
 * transactionnel (avant/après, validateur précédent conservé).
 */
async function reviewDeposit({ depositId, verifierId, target, notes = null, reason = null, correction = false, central = false, dbClient = db }) {
  if (!depositId) throw new CashDepositError('deposit_id_required', 'Dépôt requis', 400);
  return withTransaction(dbClient, async client => {
    const { rows: [deposit] } = await client.query(`
      SELECT cd.*, r.market_id AS review_market_id
        FROM cash_deposits cd
        LEFT JOIN users u ON u.id = cd.agent_id
        LEFT JOIN relais r ON r.id = u.relais_id
       WHERE cd.id = $1
         FOR UPDATE OF cd
    `, [depositId]);
    if (!deposit) throw new CashDepositError('deposit_not_found', 'Dépôt introuvable', 404);
    if (deposit.agent_id && verifierId && String(deposit.agent_id) === String(verifierId)) {
      throw new CashDepositError('deposit_self_review_forbidden', 'Le déposant ne peut pas valider ni contester son propre dépôt', 403);
    }
    const isCorrection = deposit.status === 'verified' && target === 'disputed';
    if (isCorrection) {
      if (!central || correction !== true) {
        throw new CashDepositError('deposit_correction_required', 'Dépôt déjà vérifié : correction exceptionnelle explicite requise (correction=true) avec motif', 409);
      }
    } else if (!(REVIEW_TRANSITIONS[deposit.status] || []).includes(target)) {
      throw new CashDepositError('deposit_transition_forbidden', `Transition ${deposit.status} → ${target} interdite pour ce dépôt`, 409);
    }
    const { rows: [updated] } = await client.query(`
      UPDATE cash_deposits
         SET status = $2,
             verified_by = $1,
             verified_at = NOW(),
             notes = CASE WHEN $2 = 'disputed' THEN $4 ELSE COALESCE($3, notes) END
       WHERE id = $5 AND status = $6
       RETURNING *
    `, [verifierId || null, target, notes || null, reason || null, depositId, deposit.status]);
    if (!updated) throw new CashDepositError('deposit_transition_forbidden', 'Le dépôt a changé de statut pendant la revue', 409);
    if (central) {
      await audit(client, {
        actorUserId: verifierId || null,
        marketId: deposit.review_market_id || null,
        action: CENTRAL_AUDIT_ACTIONS[isCorrection ? 'correction' : target],
        before: {
          deposit_ref: deposit.deposit_ref, status: deposit.status, amount_kmf: deposit.amount_kmf,
          verified_by: deposit.verified_by || null, verified_at: deposit.verified_at || null, previous_notes: deposit.notes || null,
        },
        after: { deposit_ref: deposit.deposit_ref, status: target, note: (target === 'disputed' ? reason : notes) || null },
      });
    }
    return updated;
  });
}

async function verifyDeposit({ depositId, verifierId, notes = null, central = false, dbClient = db }) {
  return reviewDeposit({ depositId, verifierId, target: 'verified', notes, central, dbClient });
}

async function disputeDeposit({ depositId, verifierId, reason, correction = false, central = false, dbClient = db }) {
  if (!reason) throw new CashDepositError('deposit_dispute_reason_required', 'Raison requise', 400);
  return reviewDeposit({ depositId, verifierId, target: 'disputed', reason, correction, central, dbClient });
}

/**
 * Couverture cash canonique (sans allocation encaissement↔dépôt, qui n'existe pas encore).
 * Règle de conservation, jamais d'existence : seul un dépôt `verified` couvre ; `pending`
 * (en transit) et `disputed` (écart) ne couvrent rien, quelle que soit leur période.
 * Par agent, le total vérifié couvre les encaissements du plus ancien au plus récent ;
 * `uncovered_kmf` est le reliquat non couvert. L'ordre est une convention d'affichage
 * (aucune correspondance stockée) ; le total non couvert est exact. Une validation interne
 * n'est pas une confirmation bancaire. À préfixer par `WITH` ; expose la CTE `uncovered`.
 */
const UNCOVERED_COLLECTIONS_CTE = `
  verified AS (
    SELECT agent_id, SUM(amount_kmf) AS verified_kmf
      FROM cash_deposits WHERE status = 'verified' GROUP BY agent_id
  ),
  running AS (
    SELECT cc.id, cc.order_id, cc.collected_by, cc.relais_id, cc.amount_kmf, cc.confirmed_at,
           SUM(cc.amount_kmf) OVER (PARTITION BY cc.collected_by ORDER BY cc.confirmed_at, cc.id) AS cumulative_kmf
      FROM cash_collections cc
  ),
  uncovered AS (
    SELECT r.*, LEAST(r.amount_kmf, r.cumulative_kmf - COALESCE(v.verified_kmf, 0)) AS uncovered_kmf
      FROM running r
      LEFT JOIN verified v ON v.agent_id = r.collected_by
     WHERE r.cumulative_kmf > COALESCE(v.verified_kmf, 0)
  )`;

module.exports = {
  METHODS,
  UNCOVERED_COLLECTIONS_CTE,
  CashDepositError,
  normalizePayload,
  resolveDeclaredAmount,
  createDeposit,
  verifyDeposit,
  disputeDeposit,
};
