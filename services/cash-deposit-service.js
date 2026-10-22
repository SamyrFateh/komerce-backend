/**
 * @komerce-arch
 * @role          payment-cash-deposit-service
 * @domain        payment
 * @layer         service
 * @criticality   high
 * @inputs        authenticated_actor, deposit_payload_or_id
 * @outputs       cash_deposit_mutation_result
 * @depends       db.js, utils/currency.js, services/market-delegation-service.js, services/cash-custody-service.js
 * @used-by       routes/cash.js, services/finance-accounting-workspace.js
 * @db-read       cash_collections, cash_deposit_allocations, cash_deposits, cash_custody_movements, relais, users
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
const custody = require('./cash-custody-service');

const METHODS = Object.freeze(['mobile_money', 'bank', 'physical']);

class CashDepositError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'CashDepositError';
    this.code = code;
    this.status = status;
  }
}

function today() {
  return new Date().toISOString().slice(0, 10);
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
  return {
    amount_kmf: amount,
    deposit_method: payload.deposit_method,
    reference: payload.reference || null,
    proof_url: payload.proof_url || null,
    period_start: payload.period_start || today(),
    period_end: payload.period_end || today(),
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

/**
 * Une remise est TOUJOURS une remise de garde vers une cible autorisée : une personne habilitée du
 * Market (TRANSFER) ou une destination finale ACTIVE (FINAL). La déclaration ne transfère rien :
 * le solde ne bouge qu'à l'acceptation (cash-custody-service.recordReceipt). Le Market vient du
 * serveur (relais de l'agent, ou `marketId` résolu par la route), jamais du client. Une remise
 * historique vérifiée peut être régularisée (`regularizes_deposit_ref`), jamais clôturée seule.
 */
async function createDeposit({ agentId, marketId = null, payload = {}, dbClient = db }) {
  if (!agentId) throw new CashDepositError('deposit_agent_required', 'Agent requis', 400);
  const recipientId = payload.recipient_user_id || null;
  const destinationId = payload.destination_id || null;
  if (Boolean(recipientId) === Boolean(destinationId)) {
    throw new CashDepositError('deposit_target_required', 'Cible requise : une personne habilitée (recipient_user_id) OU une destination finale (destination_id).', 422);
  }
  const base = payload.declared_currency ? payload : {
    ...payload,
    declared_currency: 'KMF',
    declared_amount: payload.amount_kmf,
  };
  const resolved = await resolveDeclaredAmount(base);
  return withTransaction(dbClient, async client => {
    try {
      const market = marketId || (await client.query(
        `SELECT r.market_id FROM users u JOIN relais r ON r.id = u.relais_id WHERE u.id = $1::uuid`, [agentId]
      )).rows[0]?.market_id;
      if (!market) throw new CashDepositError('deposit_market_unresolved', 'Market du remettant introuvable (relais ou habilitation requis)', 403);
      let method = payload.deposit_method;
      let destination = null;
      if (recipientId) {
        await custody.assertAuthorizedRecipient(client, { marketId: market, userId: recipientId });
        method = method || 'physical';
      } else {
        destination = await custody.assertActiveDestination(client, { marketId: market, destinationId });
        method = method || (destination.kind === 'BANK' ? 'bank' : 'mobile_money');
      }
      const input = normalizePayload({ ...resolved.payload, deposit_method: method });
      const snap = resolved.snapshot;
      if (destination && destination.currency !== snap.declared_currency) {
        throw new CashDepositError('deposit_destination_currency_mismatch', `La destination est en ${destination.currency} : montant à déclarer dans cette devise`, 422);
      }
      const held = await custody.holdingOf(client, agentId, market);
      if (input.amount_kmf > held) {
        throw new CashDepositError('deposit_exceeds_holding', `Montant annoncé (${input.amount_kmf} KMF) supérieur à la garde actuelle (${held} KMF)`, 409);
      }
      let regularizesId = null;
      if (payload.regularizes_deposit_ref) {
        const { rows: [legacy] } = await client.query(
          `SELECT id FROM cash_deposits WHERE deposit_ref = $1 AND market_id = $2::uuid AND movement_kind = 'LEGACY'`,
          [payload.regularizes_deposit_ref, market]);
        if (!legacy) throw new CashDepositError('deposit_regularizes_not_found', 'Remise historique introuvable dans ce Market', 404);
        regularizesId = legacy.id;
      }
      const { rows: [deposit] } = await client.query(`
        INSERT INTO cash_deposits
          (agent_id, amount_kmf, deposit_method, reference, proof_url,
           period_start, period_end, notes,
           declared_amount, declared_currency, fx_rate_to_kmf, fx_source,
           market_id, movement_kind, recipient_user_id, destination_id, regularizes_deposit_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        RETURNING *
      `, [
        agentId, input.amount_kmf, input.deposit_method, input.reference, input.proof_url,
        input.period_start, input.period_end, input.notes,
        snap.declared_amount, snap.declared_currency, snap.fx_rate_to_kmf, snap.fx_source,
        market, recipientId ? 'TRANSFER' : 'FINAL', recipientId, destinationId, regularizesId,
      ]);
      await audit(client, {
        actorUserId: agentId, marketId: market, capability: custody.RECEIVE_CAPABILITY, action: 'CASH_TRANSFER_DECLARED',
        after: { deposit_ref: deposit.deposit_ref, kind: deposit.movement_kind, announced_kmf: deposit.amount_kmf,
          declared_amount: snap.declared_amount, declared_currency: snap.declared_currency, fx_rate_to_kmf: snap.fx_rate_to_kmf,
          recipient_user_id: recipientId, destination_id: destinationId, regularizes: payload.regularizes_deposit_ref || null },
      });
      return deposit;
    } catch (error) {
      if (error instanceof custody.CashCustodyError) throw new CashDepositError(error.code, error.message, error.status);
      const mapped = custody.mapDbError(error);
      if (mapped instanceof custody.CashCustodyError) throw new CashDepositError(mapped.code, mapped.message, mapped.status);
      throw error;
    }
  });
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
    if (deposit.movement_kind !== 'LEGACY') {
      throw new CashDepositError('deposit_review_legacy_only', 'Une remise de garde se résout par réception et contrôle (cash-custody), pas par revue de dépôt', 409);
    }
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
 * Couverture cash canonique : la vue unique cash_custody_movements (migration 289). Un encaissement
 * n'est déchargé que par des sorties de responsabilité ACCEPTÉES (transfert accepté, clôture finale
 * contrôlée, perte décidée), appliquées du plus ancien au plus récent. Une remise historique
 * « vérifiée », une déclaration en attente ou une réception finale non contrôlée ne déchargent rien
 * (aucun faux vert). Les entrées par transfert reçu sont déduites des sorties avant d'en décharger
 * les encaissements propres de l'agent (lecture prudente). Partitionné par (agent, Market) : la décharge d'un Market ne couvre jamais l'encaissement d'un autre. À préfixer par `WITH` ; expose la CTE
 * `uncovered` (colonnes d'origine + `market_id`).
 */
const UNCOVERED_COLLECTIONS_CTE = `
  running AS (
    SELECT cc.id, cc.order_id, cc.collected_by, cc.relais_id, cc.amount_kmf, cc.confirmed_at,
           cash_collection_market(cc.relais_id, cc.collected_by) AS market_id,
           SUM(cc.amount_kmf) OVER (
             PARTITION BY cc.collected_by, cash_collection_market(cc.relais_id, cc.collected_by)
             ORDER BY cc.confirmed_at, cc.id) AS cumulative_kmf
      FROM cash_collections cc
  ),
  released AS (
    SELECT holder_id AS collected_by, market_id,
           GREATEST(0, COALESCE(-SUM(delta_kmf) FILTER (WHERE source IN ('TRANSFER_OUT', 'FINAL_CLOSURE', 'LOSS')), 0)
                       - COALESCE(SUM(delta_kmf) FILTER (WHERE source = 'TRANSFER_IN'), 0)) AS released_kmf
      FROM cash_custody_movements
     WHERE source <> 'COLLECTION'
     GROUP BY holder_id, market_id
  ),
  uncovered AS (
    SELECT r.*, r.amount_kmf - LEAST(r.amount_kmf, GREATEST(0, COALESCE(rel.released_kmf, 0) - (r.cumulative_kmf - r.amount_kmf))) AS uncovered_kmf
      FROM running r
      LEFT JOIN released rel ON rel.collected_by = r.collected_by AND rel.market_id IS NOT DISTINCT FROM r.market_id
     WHERE r.cumulative_kmf > COALESCE(rel.released_kmf, 0)
  )`;

module.exports = {
  METHODS,
  UNCOVERED_COLLECTIONS_CTE,
  CashDepositError,
  normalizePayload,
  resolveDeclaredAmount,
  withTransaction,
  createDeposit,
  verifyDeposit,
  disputeDeposit,
};
