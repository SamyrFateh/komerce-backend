/**
 * @komerce-arch
 * @role          pickup-secret-customer-rotation
 * @domain        logistics
 * @layer         service
 * @criticality   high
 * @inputs        orderId, userId
 * @outputs       new_pickup_code_one_shot
 * @depends       db.js, services/pickup-secret-issuer.js, services/order-mutation-service.js
 * @used-by       routes/pickup-secret.js
 * @db-read       orders, pickup_code_generations
 * @db-write      pickup_code_generations, pickup_reveal_codes, pickup_print_tokens
 * @db-write-via:order-mutation-service orders
 * @db-txn        single_transaction_for_update
 * @doctrine      no_second_secret_writer
 * @impact-areas  logistics, pickup
 * @version       2026-11
 */
'use strict';

/**
 * #3900 R1 — le client propriétaire d'une commande prête au retrait peut
 * générer un nouveau code. Même writer canonique que regenerateCode admin
 * (generateAndStoreSecret + recordPickupRegeneration) : la rotation invalide
 * l'ancien secret, le nouveau clair est renvoyé UNE fois, jamais stocké.
 */
const db = require('../db');
const { generateAndStoreSecret } = require('./pickup-secret-issuer');
const { recordPickupRegeneration } = require('./order-mutation-service');
const log = require('../utils/logger').child({ module: 'pickup-secret-customer-rotation' });

const MAX_GENERATIONS_PER_24H = 5;

async function customerGenerateNewCode({ orderId, userId }) {
  return db.withTransaction(async (client) => {
    const { rows: [order] } = await client.query(
      `SELECT id, reference, user_id, status, relais_id, pickup_secret_hash
         FROM orders WHERE id = $1 FOR UPDATE`,
      [orderId]
    );
    if (!order) return { status: 404, body: { error: 'Commande introuvable' } };
    if (!order.user_id || String(order.user_id) !== String(userId)) {
      return { status: 403, body: { error: 'Cette commande ne vous appartient pas' } };
    }
    if (['collected', 'cancelled', 'refunded'].includes(order.status)) {
      return { status: 409, body: { error: 'Commande déjà retirée ou annulée', code: 'PICKUP_ORDER_CLOSED' } };
    }
    if (order.status !== 'available' || !order.pickup_secret_hash) {
      return { status: 409, body: { error: 'Commande pas encore prête au retrait', code: 'PICKUP_NOT_READY' } };
    }

    const { rows: [q] } = await client.query(
      `SELECT COUNT(*)::int AS n FROM pickup_code_generations
        WHERE order_id = $1 AND created_at > NOW() - INTERVAL '24 hours'`,
      [orderId]
    );
    if ((q?.n || 0) >= MAX_GENERATIONS_PER_24H) {
      return { status: 429, body: {
        error: 'Limite atteinte : 5 nouveaux codes par commande et par 24 h.',
        code: 'PICKUP_CODE_QUOTA',
      }};
    }

    await client.query('DELETE FROM pickup_reveal_codes WHERE order_id = $1', [orderId]);
    await client.query('DELETE FROM pickup_print_tokens WHERE order_id = $1', [orderId]);

    const next = await generateAndStoreSecret({
      orderId,
      relaisId: order.relais_id || null,
      channel: 'customer_regenerate',
      dbClient: client,
      excludeOrderId: orderId,
      // Le clair est affiché dans cette réponse : plus rien à révéler ensuite.
      extraUpdates: { pickup_secret_revealed_at: new Date() },
    });
    await recordPickupRegeneration(client, { orderId, reason: 'customer_regenerate' });
    await client.query(
      'INSERT INTO pickup_code_generations (order_id, user_id) VALUES ($1, $2)',
      [orderId, userId]
    );
    log.info(`[PICKUP-SECRET] code regénéré par le propriétaire order=${orderId}`);

    return { status: 200, body: {
      success: true,
      order_ref: order.reference,
      code: next.code,
      remaining_today: MAX_GENERATIONS_PER_24H - ((q?.n || 0) + 1),
      warning: 'Ce code ne s\'affichera qu\'une seule fois. L\'ancien code n\'est plus valable.',
    }};
  });
}

module.exports = { customerGenerateNewCode, MAX_GENERATIONS_PER_24H };
