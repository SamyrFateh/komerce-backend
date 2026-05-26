'use strict';

/**
 * KOMERCE — Shared cart v4 settlement guard
 *
 * Produit :
 *   - Panier ouvert : engagements indicatifs, aucun paiement participant.
 *   - Passer au règlement : action créateur qui ouvre la fenêtre de paiement.
 *   - Panier en règlement : paiements Stripe/cash autorisés.
 *
 * Implémentation transitionnelle :
 *   On ne change pas encore l'enum shared_cart_status.
 *   Le statut reste compatible avec l'ancien runtime, et l'ouverture du règlement
 *   est portée par metadata.settlement_open=true.
 */

const db = require('../db');
const commitments = require('./shared-cart-commitment-service');

const OPEN_STATUSES = new Set(['draft', 'active', 'commitment_open']);
const LEGACY_PAYMENT_COMPAT_STATUSES = new Set(['active', 'partially_funded']);
const CLOSED_STATUSES = new Set(['converted_to_order', 'finalized', 'cancelled', 'expired', 'refunded']);
const FUTURE_SETTLEMENT_STATUSES = new Set(['closed_for_settlement', 'settlement_in_progress', 'ready_to_finalize']);

function metadataOf(cart) {
  if (!cart?.metadata) return {};
  if (typeof cart.metadata === 'object') return cart.metadata;
  try { return JSON.parse(cart.metadata); } catch (_) { return {}; }
}

function isSettlementOpen(cart) {
  const meta = metadataOf(cart);
  return meta.settlement_open === true || FUTURE_SETTLEMENT_STATUSES.has(cart?.status);
}

function httpError(message, status = 400, code = null) {
  const e = new Error(message);
  e.status = status;
  if (code) e.code = code;
  return e;
}

function assertCartCanAcceptParticipantPayment(cart) {
  if (!cart) throw httpError('Panier partagé introuvable', 404, 'shared_cart_not_found');

  if (CLOSED_STATUSES.has(cart.status)) {
    throw httpError(`Ce panier n'accepte plus de paiements (statut : ${cart.status})`, 409, 'shared_cart_closed');
  }

  if (new Date(cart.expires_at) < new Date()) {
    throw httpError('Ce panier partagé a expiré', 400, 'shared_cart_expired');
  }

  if (!isSettlementOpen(cart)) {
    throw httpError(
      'Le panier est encore ouvert. Le créateur doit d’abord passer au règlement avant qu’un participant puisse payer.',
      409,
      'settlement_not_open'
    );
  }

  if (!LEGACY_PAYMENT_COMPAT_STATUSES.has(cart.status) && !FUTURE_SETTLEMENT_STATUSES.has(cart.status)) {
    throw httpError(`Statut incompatible avec un paiement participant : ${cart.status}`, 409, 'invalid_payment_status');
  }
}

async function assertCanAcceptParticipantPaymentByToken(token, client = db) {
  const { rows } = await client.query(
    `SELECT id, token, status, expires_at, metadata
       FROM shared_carts
      WHERE token = $1`,
    [token]
  );
  const cart = rows[0] || null;
  assertCartCanAcceptParticipantPayment(cart);
  return cart;
}

async function openSettlement(sharedCartId, userId, opts = {}) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT * FROM shared_carts
        WHERE id = $1 AND beneficiary_user_id = $2
        FOR UPDATE`,
      [sharedCartId, userId]
    );
    if (!rows.length) throw httpError('Panier introuvable ou non autorisé', 404, 'shared_cart_not_found');
    const cart = rows[0];

    if (CLOSED_STATUSES.has(cart.status)) {
      throw httpError(`Impossible de passer au règlement un panier au statut ${cart.status}`, 409, 'shared_cart_closed');
    }
    if (isSettlementOpen(cart)) {
      throw httpError('Ce panier est déjà en règlement', 409, 'settlement_already_open');
    }
    if (!OPEN_STATUSES.has(cart.status) && !LEGACY_PAYMENT_COMPAT_STATUSES.has(cart.status)) {
      throw httpError(`Statut incompatible avec le passage au règlement : ${cart.status}`, 409, 'invalid_open_settlement_status');
    }
    if (new Date(cart.expires_at) < new Date()) {
      throw httpError('Ce panier partagé a expiré', 400, 'shared_cart_expired');
    }

    const lockedCommitments = await commitments.lockCommitmentsForSettlement(sharedCartId, userId, client);
    const lockedTotalKmf = lockedCommitments.reduce((sum, row) => sum + Math.round(Number(row.amount_kmf) || 0), 0);

    const settlementWindowHours = Math.max(1, Math.min(168, Number(opts.settlement_window_hours) || 48));
    const payload = {
      settlement_open: true,
      settlement_opened_at: new Date().toISOString(),
      settlement_opened_by: userId,
      settlement_window_hours: settlementWindowHours,
      locked_commitments_count: lockedCommitments.length,
      locked_commitments_total_kmf: lockedTotalKmf,
      product_label: 'panier_en_reglement',
    };

    const update = await client.query(
      `UPDATE shared_carts
          SET metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb,
              updated_at = NOW()
        WHERE id = $1 AND beneficiary_user_id = $2
        RETURNING *`,
      [sharedCartId, userId, JSON.stringify(payload)]
    );

    await client.query(
      `INSERT INTO shared_cart_events (shared_cart_id, event_type, actor_type, actor_id, payload)
       VALUES ($1, 'settlement_opened', 'user', $2, $3)`,
      [sharedCartId, userId, JSON.stringify(payload)]
    );

    await client.query('COMMIT');
    return update.rows[0];
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  isSettlementOpen,
  assertCartCanAcceptParticipantPayment,
  assertCanAcceptParticipantPaymentByToken,
  openSettlement,
};
