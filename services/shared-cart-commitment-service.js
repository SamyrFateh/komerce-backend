/**
 * @komerce-arch
 * @role          shared-cart-shared-cart-commitment-service
 * @domain        shared-cart
 * @layer         service
 * @criticality   critical
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       @unknown
 * @used-by       @unknown
 * @db-read       shared_cart_commitments, shared_carts
 * @db-write      shared_cart_commitments, shared_cart_events
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  shared-cart
 * @version       2026-06
 */

'use strict';

/**
 * KOMERCE — Shared cart v4 commitment service
 *
 * commitment = engagement indicatif avant passage au règlement.
 * contribution = paiement réel après passage au règlement.
 */

const db = require('../db');
const settlement = require('./shared-cart-v4-settlement');

const MIN_COMMITMENT_KMF = 2500; // v4.1 — aligné sur le minimum Stripe
const MAX_COMMITMENT_KMF = 500000;

function r(n) { return Math.round(Number(n) || 0); }

function maskPhone(phone) {
  if (!phone) return null;
  const value = String(phone);
  if (value.length <= 4) return '****';
  return `${'*'.repeat(Math.max(0, value.length - 4))}${value.slice(-4)}`;
}

function publicCommitment(row) {
  return {
    id: row.id,
    participant_name: row.participant_name,
    participant_phone: maskPhone(row.participant_phone),
    amount_kmf: row.amount_kmf,
    message: row.message,
    status: row.status,
    locked_at: row.locked_at,
    withdrawn_at: row.withdrawn_at,
    paid_at: row.paid_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function httpError(message, status = 400, code = null) {
  const e = new Error(message);
  e.status = status;
  if (code) e.code = code;
  return e;
}

async function tx(fn) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function addEvent(client, cartId, eventType, actor, payload) {
  await client.query(
    `INSERT INTO shared_cart_events (shared_cart_id, event_type, actor_type, actor_id, payload)
     VALUES ($1, $2, $3, $4, $5)`,
    [cartId, eventType, actor?.type || null, actor?.id || null, payload || {}]
  );
}

function assertCartOpenForCommitment(cart) {
  if (!cart) throw httpError('Panier partagé introuvable', 404, 'shared_cart_not_found');
  if (!['active', 'draft', 'commitment_open'].includes(cart.status)) {
    throw httpError(`Ce panier n'accepte plus d'engagements (statut : ${cart.status})`, 409, 'commitment_closed');
  }
  if (new Date(cart.expires_at) < new Date()) {
    throw httpError('Ce panier partagé a expiré', 400, 'shared_cart_expired');
  }
  if (settlement.isSettlementOpen(cart)) {
    throw httpError(
      'Le panier est déjà passé au règlement. Les engagements ne peuvent plus être modifiés.',
      409,
      'settlement_already_open'
    );
  }
}

function validatePayload(body = {}) {
  const name = String(body.participant_name || body.contributor_name || '').trim();
  if (!name) throw httpError('Nom du participant requis', 400, 'participant_name_required');

  const amount = r(body.amount_kmf);
  if (amount < MIN_COMMITMENT_KMF) {
    throw httpError(`Engagement minimum : ${MIN_COMMITMENT_KMF} KMF`, 400, 'amount_too_low');
  }
  if (amount > MAX_COMMITMENT_KMF) {
    throw httpError(`Engagement maximum : ${MAX_COMMITMENT_KMF} KMF`, 400, 'amount_too_high');
  }

  return {
    participantName: name,
    participantPhone: body.participant_phone || body.contributor_phone || null,
    amountKmf: amount,
    message: body.message || null,
  };
}

async function listCommitmentsByToken(token) {
  const { rows: cartRows } = await db.query(
    `SELECT id, token, status, expires_at, metadata
       FROM shared_carts
      WHERE token = $1`,
    [token]
  );
  if (!cartRows.length) throw httpError('Panier partagé introuvable', 404, 'shared_cart_not_found');
  const cart = cartRows[0];

  const { rows } = await db.query(
    `SELECT id,
            participant_name,
            participant_phone,
            amount_kmf,
            message,
            status,
            locked_at,
            withdrawn_at,
            paid_at,
            created_at,
            updated_at
       FROM shared_cart_commitments
      WHERE shared_cart_id = $1
      ORDER BY created_at DESC`,
    [cart.id]
  );

  return { cart, commitments: rows.map(publicCommitment) };
}

async function createOrUpdateCommitment(token, body = {}) {
  const payload = validatePayload(body);
  return tx(async (client) => {
    const cartRes = await client.query(
      `SELECT * FROM shared_carts WHERE token = $1 FOR UPDATE`,
      [token]
    );
    if (!cartRes.rows.length) throw httpError('Panier partagé introuvable', 404, 'shared_cart_not_found');
    const cart = cartRes.rows[0];
    assertCartOpenForCommitment(cart);

    let commitment;
    if (payload.participantPhone) {
      const existing = await client.query(
        `SELECT * FROM shared_cart_commitments
          WHERE shared_cart_id = $1
            AND participant_phone = $2
            AND status IN ('pledged', 'updated')
          ORDER BY created_at DESC
          LIMIT 1
          FOR UPDATE`,
        [cart.id, payload.participantPhone]
      );
      if (existing.rows.length) {
        const updated = await client.query(
          `UPDATE shared_cart_commitments
              SET participant_name = $2,
                  amount_kmf = $3,
                  message = $4,
                  status = 'updated',
                  metadata = COALESCE(metadata, '{}'::jsonb) || $5::jsonb,
                  updated_at = NOW()
            WHERE id = $1
            RETURNING *`,
          [
            existing.rows[0].id,
            payload.participantName,
            payload.amountKmf,
            payload.message,
            JSON.stringify({ last_action: 'updated_before_settlement' }),
          ]
        );
        commitment = updated.rows[0];
        await addEvent(client, cart.id, 'commitment_updated', { type: 'participant' }, {
          commitment_id: commitment.id,
          participant_phone: payload.participantPhone,
          amount_kmf: payload.amountKmf,
        });
        return { cart, commitment, updated: true };
      }
    }

    const inserted = await client.query(
      `INSERT INTO shared_cart_commitments (
         shared_cart_id, participant_name, participant_phone,
         amount_kmf, message, status, metadata
       ) VALUES ($1, $2, $3, $4, $5, 'pledged', $6)
       RETURNING *`,
      [
        cart.id,
        payload.participantName,
        payload.participantPhone,
        payload.amountKmf,
        payload.message,
        JSON.stringify({ source: 'public_shared_cart' }),
      ]
    );
    commitment = inserted.rows[0];

    await addEvent(client, cart.id, 'commitment_created', { type: 'participant' }, {
      commitment_id: commitment.id,
      participant_phone: payload.participantPhone,
      amount_kmf: payload.amountKmf,
    });

    return { cart, commitment, updated: false };
  });
}

async function withdrawCommitment(token, commitmentId, body = {}) {
  return tx(async (client) => {
    const cartRes = await client.query(
      `SELECT * FROM shared_carts WHERE token = $1 FOR UPDATE`,
      [token]
    );
    if (!cartRes.rows.length) throw httpError('Panier partagé introuvable', 404, 'shared_cart_not_found');
    const cart = cartRes.rows[0];
    assertCartOpenForCommitment(cart);

    const participantPhone = body.participant_phone || body.contributor_phone || null;
    const params = [commitmentId, cart.id];
    let phoneClause = ' AND participant_phone IS NULL';
    if (participantPhone) {
      params.push(participantPhone);
      phoneClause = ` AND (participant_phone IS NULL OR participant_phone = $${params.length})`;
    }

    const updated = await client.query(
      `UPDATE shared_cart_commitments
          SET status = 'withdrawn',
              withdrawn_at = NOW(),
              metadata = COALESCE(metadata, '{}'::jsonb) || $${params.length + 1}::jsonb,
              updated_at = NOW()
        WHERE id = $1
          AND shared_cart_id = $2
          AND status IN ('pledged', 'updated')
          ${phoneClause}
        RETURNING *`,
      [...params, JSON.stringify({ reason: body.reason || null })]
    );

    if (!updated.rows.length) {
      throw httpError('Engagement introuvable ou non retirable', 404, 'commitment_not_found_or_locked');
    }

    await addEvent(client, cart.id, 'commitment_withdrawn', { type: 'participant' }, {
      commitment_id: updated.rows[0].id,
      participant_phone: participantPhone,
      reason: body.reason || null,
    });

    return { cart, commitment: updated.rows[0] };
  });
}

async function lockCommitmentsForSettlement(sharedCartId, userId, client) {
  const updated = await client.query(
    `UPDATE shared_cart_commitments
        SET status = 'locked_for_settlement',
            locked_at = NOW(),
            updated_at = NOW()
      WHERE shared_cart_id = $1
        AND status IN ('pledged', 'updated')
      RETURNING *`,
    [sharedCartId]
  );

  await addEvent(client, sharedCartId, 'commitments_locked_for_settlement', { type: 'user', id: userId }, {
    count: updated.rows.length,
    total_kmf: updated.rows.reduce((sum, row) => sum + r(row.amount_kmf), 0),
  });

  return updated.rows;
}

module.exports = {
  listCommitmentsByToken,
  createOrUpdateCommitment,
  withdrawCommitment,
  lockCommitmentsForSettlement,
};
