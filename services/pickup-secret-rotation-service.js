/**
 * @komerce-arch
 * @role          pickup-secret-partial-rotation
 * @domain        logistics
 * @layer         service
 * @criticality   critical
 * @inputs        client, orderId, relaisId
 * @outputs       { last4 }
 * @depends       services/pickup-secret-issuer.js, services/order-mutation-service.js
 * @used-by       services/pickup-collection-recorder.js
 * @db-write      pickup_reveal_codes, pickup_print_tokens
 * @db-write-via:order-mutation-service orders
 * @db-txn        participant — rotation atomique dans la transaction de collecte
 * @doctrine      docs/architecture/IMPACT_FEATURE_FIRST_FULFILLMENT_MIXTE.md R10
 * @impact-areas  logistics, pickup
 * @version       2026-09
 */
'use strict';

const { generateAndStoreSecret } = require('./pickup-secret-issuer');
const { recordPickupRegeneration } = require('./order-mutation-service');

async function rotatePickupSecretAfterPartialCollection({ client, orderId, relaisId = null }) {
  if (!client || typeof client.query !== 'function') {
    throw new TypeError('rotatePickupSecretAfterPartialCollection: client transactionnel requis');
  }
  if (!orderId) {
    throw new TypeError('rotatePickupSecretAfterPartialCollection: orderId requis');
  }

  // L'ancien secret et ses caches en clair sont consommés dans la même
  // transaction que le retrait physique. En cas d'échec ultérieur, ROLLBACK
  // restaure l'ensemble : jamais de fenêtre entre retrait et rotation.
  await client.query('DELETE FROM pickup_reveal_codes WHERE order_id = $1', [orderId]);
  await client.query('DELETE FROM pickup_print_tokens WHERE order_id = $1', [orderId]);

  const next = await generateAndStoreSecret({
    orderId,
    relaisId,
    channel: 'partial_pickup',
    dbClient: client,
    excludeOrderId: orderId,
    extraUpdates: {
      // Un nouveau secret ouvre une nouvelle révélation one-shot.
      pickup_secret_revealed_at: null,
    },
  });

  await recordPickupRegeneration(client, {
    orderId,
    reason: 'partial_pickup',
  });

  // Le clair reste accessible 30 min via le mécanisme canonique reveal-once.
  // Il n'est jamais retourné au guichet qui vient de consommer l'ancien code.
  await client.query(
    `INSERT INTO pickup_reveal_codes (order_id, code, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '30 minutes')
     ON CONFLICT (order_id) DO UPDATE
       SET code = EXCLUDED.code, expires_at = EXCLUDED.expires_at`,
    [orderId, next.code]
  );

  return { last4: next.last4 };
}

module.exports = { rotatePickupSecretAfterPartialCollection };
