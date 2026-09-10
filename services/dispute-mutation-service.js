/**
 * @komerce-arch
 * @role          orders-dispute-mutation-boundary
 * @domain        orders
 * @layer         service
 * @criticality   critical
 * @inputs        db_or_transaction_executor, dispute workflow payload
 * @outputs       dispute read model, mutated dispute row
 * @depends       none (executor fourni par l'appelant)
 * @used-by       services/market-delegation-client-case-service.js
 * @db-read       disputes, orders
 * @db-write      disputes
 * @db-txn        caller_transaction_preserved
 * @doctrine      lifecycle_owner_persistence_boundary, refund_authority_never_delegated
 * @impact-areas  orders, market-delegation
 * @version       2026-09
 */
'use strict';

function requireExecutor(executor) {
  if (!executor || typeof executor.query !== 'function') {
    throw new TypeError('dispute-mutation-service: executor.query requis');
  }
  return executor;
}

class DisputeValidationError extends Error {
  constructor(code, message, status = 400) {
    super(message || code);
    this.code = code;
    this.status = status;
  }
}

// open -> processing -> resolved|closed. Pas de saut, pas de retour arrière
// silencieux — un litige rouvert redevient explicitement 'processing'.
const STATUS = Object.freeze({ OPEN: 'open', PROCESSING: 'processing', RESOLVED: 'resolved', CLOSED: 'closed' });
const ALLOWED_TRANSITIONS = Object.freeze({
  open: ['processing'],
  processing: ['resolved', 'closed', 'open'],
  resolved: ['closed', 'processing'],
  closed: ['processing'],
});

const DISPUTE_COLUMNS = `id, order_id, type, level, status, description, photo_urls, resolution,
            refund_kmf, refund_eur, created_by, resolved_by, resolved_at, created_at, updated_at`;

async function listDisputesForMarket(marketId, executor) {
  const db = requireExecutor(executor);
  const { rows } = await db.query(
    `SELECT d.id, d.order_id, d.type, d.level, d.status, d.description, d.resolution,
            d.created_at, d.updated_at, d.resolved_at
       FROM disputes d
       JOIN orders o ON o.id = d.order_id
      WHERE o.market_id = $1
      ORDER BY (d.status = 'open') DESC, (d.status = 'processing') DESC, d.created_at DESC`,
    [marketId]
  );
  return rows;
}

/**
 * Récupère un litige en garantissant qu'il appartient (via order_id) au
 * marché indiqué. null (jamais une erreur) si le litige existe sur un autre
 * marché — pour ne jamais confirmer l'existence d'une ressource hors
 * périmètre.
 */
async function getOwnedDispute(disputeId, marketId, executor) {
  const db = requireExecutor(executor);
  const { rows } = await db.query(
    `SELECT d.id, d.order_id, d.type, d.level, d.status, d.description, d.photo_urls, d.resolution,
            d.refund_kmf, d.refund_eur, d.created_by, d.resolved_by, d.resolved_at, d.created_at, d.updated_at,
            o.market_id
       FROM disputes d
       JOIN orders o ON o.id = d.order_id
      WHERE d.id = $1`,
    [disputeId]
  );
  const dispute = rows[0];
  if (!dispute || String(dispute.market_id) !== String(marketId)) return null;
  return dispute;
}

/**
 * Fait avancer le statut d'un litige et/ou sa note de résolution.
 * N'écrit JAMAIS refund_kmf ni refund_eur — ces colonnes restent
 * exclusivement sous autorité centrale, quel que soit le statut atteint.
 * Une transition hors ALLOWED_TRANSITIONS est refusée explicitement (pas de
 * saut open -> resolved).
 *
 * @param {string} disputeId
 * @param {string} marketId
 * @param {object} patch
 * @param {string} [patch.status]
 * @param {string} [patch.resolution]
 * @param {string} actorUserId
 * @param {object} executor
 * @returns {Promise<{before: object, after: object}|null>} null si hors marché
 */
async function updateDisputeWorkflow(disputeId, marketId, patch, actorUserId, executor) {
  const db = requireExecutor(executor);
  const before = await getOwnedDispute(disputeId, marketId, db);
  if (!before) return null;

  const nextStatus = patch.status !== undefined ? String(patch.status) : before.status;
  if (patch.status !== undefined) {
    if (!Object.values(STATUS).includes(nextStatus)) {
      throw new DisputeValidationError('DISPUTE_STATUS_INVALID', `Statut invalide (${nextStatus}).`, 400);
    }
    const allowed = ALLOWED_TRANSITIONS[before.status] || [];
    if (nextStatus !== before.status && !allowed.includes(nextStatus)) {
      throw new DisputeValidationError(
        'DISPUTE_TRANSITION_INVALID',
        `Transition ${before.status} -> ${nextStatus} non autorisée.`,
        409
      );
    }
  }

  const nextResolution = patch.resolution !== undefined ? (patch.resolution || null) : before.resolution;
  const closesNow = ['resolved', 'closed'].includes(nextStatus) && !['resolved', 'closed'].includes(before.status);

  const { rows } = await db.query(
    `UPDATE disputes
        SET status = $2,
            resolution = $3,
            resolved_by = CASE WHEN $4 THEN $5::uuid ELSE resolved_by END,
            resolved_at = CASE WHEN $4 THEN now() ELSE resolved_at END,
            updated_at = now()
      WHERE id = $1
      RETURNING ${DISPUTE_COLUMNS}`,
    [disputeId, nextStatus, nextResolution, closesNow, actorUserId]
  );
  return { before, after: rows[0] };
}

module.exports = {
  STATUS,
  ALLOWED_TRANSITIONS,
  DisputeValidationError,
  listDisputesForMarket,
  getOwnedDispute,
  updateDisputeWorkflow,
};
