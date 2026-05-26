'use strict';

const crypto = require('crypto');
const db = require('../db');
const settlement = require('./shared-cart-v4-settlement');

const MIN_KMF = 2500;
const MAX_KMF = 500000;

function r(n) { return Math.round(Number(n) || 0); }
function ref() { return `SCASH-${crypto.randomBytes(4).toString('hex').toUpperCase()}`; }

async function tx(fn) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

async function event(client, cartId, type, actor, payload) {
  await client.query(
    `INSERT INTO shared_cart_events (shared_cart_id, event_type, actor_type, actor_id, payload)
     VALUES ($1, $2, $3, $4, $5)`,
    [cartId, type, actor?.type || null, actor?.id || null, payload || {}]
  );
}

function httpError(message, status = 400, code = null) {
  const e = new Error(message);
  e.status = status;
  if (code) e.code = code;
  return e;
}

function assertOpen(cart) {
  if (!['active', 'partially_funded'].includes(cart.status)) {
    throw httpError(`Ce panier n'accepte plus de paiements (statut : ${cart.status})`, 400);
  }
  if (new Date(cart.expires_at) < new Date()) {
    throw httpError('Ce panier partagé a expiré', 400);
  }
  settlement.assertCartCanAcceptParticipantPayment(cart);
}

function validateAmount(amountKmf) {
  const amount = r(amountKmf);
  if (amount < MIN_KMF) throw httpError(`Contribution minimum : ${MIN_KMF} KMF`, 400);
  if (amount > MAX_KMF) throw httpError(`Contribution maximum : ${MAX_KMF} KMF`, 400);
  return amount;
}

async function createPendingCashContribution(token, body = {}) {
  return tx(async (client) => {
    const cartRes = await client.query(`SELECT * FROM shared_carts WHERE token = $1 FOR UPDATE`, [token]);
    if (!cartRes.rows.length) throw httpError('Panier partagé introuvable', 404);
    const cart = cartRes.rows[0];
    assertOpen(cart);

    const name = String(body.contributor_name || '').trim();
    if (!name) throw httpError('Nom du contributeur requis', 400);
    const amount = validateAmount(body.amount_kmf);
    if (amount > r(cart.remaining_kmf)) {
      throw httpError(`Le panier ne nécessite plus que ${cart.remaining_kmf} KMF`, 400, 'amount_exceeds_remaining');
    }

    let cashRef = ref();
    for (let i = 0; i < 5; i++) {
      const exists = await client.query(`SELECT 1 FROM shared_cart_contributions WHERE cash_reference = $1`, [cashRef]);
      if (!exists.rows.length) break;
      cashRef = ref();
      if (i === 4) throw new Error('Impossible de générer une référence cash unique');
    }

    const contribRes = await client.query(
      `INSERT INTO shared_cart_contributions (
         shared_cart_id, contributor_name, contributor_email, contributor_phone, message,
         amount_kmf, amount_paid, currency_paid, status,
         payment_method, cash_reference, cash_relais_id, metadata
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,'KMF','pending_cash','cash',$8,$9,$10)
       RETURNING *`,
      [
        cart.id,
        name,
        String(body.contributor_email || 'cash@komerce.local').trim().toLowerCase(),
        body.contributor_phone || null,
        body.message || null,
        amount,
        amount,
        cashRef,
        body.relais_id || null,
        JSON.stringify({ source: 'cash_settlement', counted: false }),
      ]
    );

    const contribution = contribRes.rows[0];
    await event(client, cart.id, 'cash_contribution_pending', { type: 'contributor' }, {
      contribution_id: contribution.id,
      amount_kmf: amount,
      cash_reference: cashRef,
      relais_id: body.relais_id || null,
      settlement_open: true,
    });

    return { cart, contribution };
  });
}

async function confirmCashContribution(contributionId, actor = {}, body = {}) {
  return tx(async (client) => {
    const contribRes = await client.query(
      `SELECT * FROM shared_cart_contributions WHERE id = $1 FOR UPDATE`,
      [contributionId]
    );
    if (!contribRes.rows.length) throw httpError('Contribution introuvable', 404);
    const contribution = contribRes.rows[0];

    if (contribution.status === 'paid') {
      return { contribution, already_confirmed: true };
    }
    if (contribution.payment_method !== 'cash' || contribution.status !== 'pending_cash') {
      throw httpError(`Contribution cash non confirmable (statut : ${contribution.status})`, 409);
    }

    const cartRes = await client.query(`SELECT * FROM shared_carts WHERE id = $1 FOR UPDATE`, [contribution.shared_cart_id]);
    if (!cartRes.rows.length) throw new Error('Panier introuvable lors de la confirmation cash');
    const cart = cartRes.rows[0];
    assertOpen(cart);

    const amount = r(contribution.amount_kmf);
    if (amount > r(cart.remaining_kmf)) {
      const failedRes = await client.query(
        `UPDATE shared_cart_contributions
            SET status = 'failed', failed_at = NOW(),
                metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
                updated_at = NOW()
          WHERE id = $1
          RETURNING *`,
        [contribution.id, JSON.stringify({ failure_reason: 'amount_exceeds_remaining_on_cash_confirmation', requires_manual_resolution: true })]
      );
      await event(client, cart.id, 'cash_contribution_rejected', { type: actor.role || 'agent_relais', id: actor.id || null }, {
        contribution_id: contribution.id,
        amount_kmf: amount,
        remaining_kmf: cart.remaining_kmf,
      });
      return {
        contribution: failedRes.rows[0],
        rejected: true,
        error: `Le panier ne nécessite plus que ${cart.remaining_kmf} KMF`,
        code: 'amount_exceeds_remaining',
      };
    }

    const newContributed = r(cart.contributed_kmf) + amount;
    const newRemaining = Math.max(0, r(cart.total_kmf_snapshot) - newContributed);
    const newStatus = newRemaining === 0 ? 'fully_funded' : 'partially_funded';

    const updatedContrib = await client.query(
      `UPDATE shared_cart_contributions
          SET status = 'paid', paid_at = NOW(), cash_confirmed_at = NOW(),
              cash_confirmed_by = $2,
              cash_relais_id = COALESCE($3, cash_relais_id),
              metadata = COALESCE(metadata, '{}'::jsonb) || $4::jsonb,
              updated_at = NOW()
        WHERE id = $1 AND status = 'pending_cash'
        RETURNING *`,
      [contribution.id, actor.id || null, body.relais_id || actor.relais_id || null, JSON.stringify({ confirmed_cash: true, note: body.note || null })]
    );

    await client.query(
      `UPDATE shared_carts
          SET contributed_kmf = $1, remaining_kmf = $2, status = $3, updated_at = NOW()
        WHERE id = $4`,
      [newContributed, newRemaining, newStatus, cart.id]
    );

    await event(client, cart.id, 'cash_contribution_paid', { type: actor.role || 'agent_relais', id: actor.id || null }, {
      contribution_id: contribution.id,
      amount_kmf: amount,
      cash_reference: contribution.cash_reference,
      relais_id: body.relais_id || actor.relais_id || null,
      new_status: newStatus,
    });

    if (newStatus === 'fully_funded') {
      await event(client, cart.id, 'cart_fully_funded', { type: 'system' }, { contributed_kmf: newContributed, source: 'cash' });
    }

    const updatedCart = await client.query(`SELECT * FROM shared_carts WHERE id = $1`, [cart.id]);
    return { cart: updatedCart.rows[0], contribution: updatedContrib.rows[0] };
  });
}

module.exports = { createPendingCashContribution, confirmCashContribution };
