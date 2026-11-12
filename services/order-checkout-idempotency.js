/**
 * @komerce-arch
 * @role          order-checkout-idempotency
 * @domain        orders
 * @layer         service
 * @criticality   critical
 * @inputs        user_id, Idempotency-Key, validated_checkout_body
 * @outputs       one_order_and_wallet_debit_per_key, immutable_replay_response
 * @depends       node:crypto
 * @used-by       services/order-checkout-service.js
 * @db-read       order_checkout_idempotency
 * @db-write      order_checkout_idempotency
 * @db-txn        same_transaction_as_checkout
 * @doctrine      idempotency_scope_is_authenticated_buyer, no_new_order_on_replay
 * @impact-areas  checkout, orders, payments, wallet
 * @version       2026-11
 */
'use strict';

const crypto = require('crypto');
const KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

/** The same JSON object in a different property order must be the same attempt. */
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) out[key] = stable(value[key]);
    }
    return out;
  }
  return value;
}
function hashRequest(body) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(body))).digest('hex');
}
function validKey(key) {
  return typeof key === 'string' && KEY_PATTERN.test(key);
}

/**
 * Unique INSERT is the concurrency mutex. PostgreSQL waits on a concurrent
 * conflicting insert until that transaction COMMITs or ROLLBACKs, then either
 * replays its immutable snapshot or claims the unoccupied key.
 * Every claim/finish runs on the checkout's *same* PostgreSQL client/transaction.
 */
async function claimCheckout(client, { userId, key, body }) {
  if (!key) return null; // backward-compatible callers without a key
  if (!validKey(key)) throw Object.assign(new Error('Clé anti-doublon invalide.'), { code: 'idempotency_key_invalid', status: 400 });
  const hash = hashRequest(body);
  const { rows: inserted } = await client.query(
    `INSERT INTO order_checkout_idempotency (user_id, idempotency_key, request_hash)
       VALUES ($1,$2,$3) ON CONFLICT (user_id,idempotency_key) DO NOTHING
       RETURNING request_hash`, [userId, key, hash]);
  if (inserted.length) return { key, hash, claimed: true, replayed: false, userId };
  const { rows: [existing] } = await client.query(
    `SELECT request_hash, order_id, response_snapshot
       FROM order_checkout_idempotency WHERE user_id=$1 AND idempotency_key=$2`,
    [userId, key]);
  if (!existing) throw Object.assign(new Error('Réessayez la commande avec la même clé.'), { code: 'idempotency_state_unavailable', status: 503 });
  if (String(existing.request_hash).trim() !== hash) {
    throw Object.assign(new Error('Cette clé anti-doublon correspond à une autre commande.'), { code: 'idempotency_key_reused', status: 409 });
  }
  if (!existing.order_id || !existing.response_snapshot) {
    throw Object.assign(new Error('Commande précédente encore en cours de validation.'), { code: 'idempotency_in_progress', status: 409 });
  }
  return { key, hash, claimed: false, replayed: true, snapshot: existing.response_snapshot };
}
async function completeCheckout(client, claim, { order, creditApplied, relais }) {
  if (!claim || !claim.claimed) return;
  const snapshot = JSON.stringify({
    order,
    creditApplied,
    relais: relais ? { id: relais.id, name: relais.name, address: relais.address } : null,
  });
  const { rowCount } = await client.query(
    `UPDATE order_checkout_idempotency SET order_id=$3, response_snapshot=$4::jsonb
       WHERE user_id=$1 AND idempotency_key=$2 AND response_snapshot IS NULL`,
    [claim.userId, claim.key, order.id, snapshot]);
  if (rowCount !== 1) {
    throw Object.assign(new Error('Impossible de valider la clé anti-doublon.'), { code: 'idempotency_finalize_failed', status: 409 });
  }
}
module.exports = { claimCheckout, completeCheckout, hashRequest, validKey };
