/**
 * @komerce-arch
 * @role          pickup-secret-issuer
 * @domain        logistics
 * @layer         service
 * @criticality   critical
 * @inputs        orderId, relaisId, channel, dbClient?, excludeOrderId?, extraUpdates?
 * @outputs       { code, last4 }
 * @depends       db.js, services/order-mutation-service.js, services/pickup-code-helpers.js
 * @used-by       services/pickup-secret-service.js, services/pickup-secret-rotation-service.js
 * @db-read       orders
 * @db-write-via:order-mutation-service orders
 * @db-txn        caller-owned when dbClient is supplied
 * @doctrine      docs/architecture/IMPACT_FEATURE_FIRST_FULFILLMENT_MIXTE.md R10
 * @impact-areas  logistics, pickup
 * @version       2026-09
 */
'use strict';

const crypto = require('crypto');
const db = require('../db');
const { writePickupSecret } = require('./order-mutation-service');
const { generatePickupCode, hashCode } = require('./pickup-code-helpers');
const log = require('../utils/logger').child({ module: 'pickup-secret-issuer' });

/**
 * Génération anti-collision + stockage canonique du secret order-level.
 * Le code clair retourné est éphémère : l'appelant doit le transmettre ou le
 * mettre dans le cache de révélation contrôlé, jamais le persister ailleurs.
 */
async function generateAndStoreSecret({
  orderId,
  relaisId = null,
  channel,
  dbClient = null,
  excludeOrderId = null,
  extraUpdates = {},
}) {
  if (!orderId) throw new Error('generateAndStoreSecret: orderId requis');
  if (!channel) throw new Error('generateAndStoreSecret: channel requis');

  const dbHandle = dbClient || db;
  const salt = crypto.randomBytes(16).toString('hex');
  const MAX_GEN_ATTEMPTS = 50;
  let code;
  let last4;
  let attempts = 0;

  while (attempts < MAX_GEN_ATTEMPTS) {
    code = generatePickupCode();
    last4 = code.replace(/-/g, '').slice(-4);

    const params = [last4, relaisId];
    let query = `
      SELECT id FROM orders
      WHERE pickup_secret_last4 = $1
        AND relais_id IS NOT DISTINCT FROM $2
        AND status NOT IN ('collected', 'cancelled', 'refunded')
        AND (pickup_secret_expires_at IS NULL OR pickup_secret_expires_at > NOW())
    `;
    if (excludeOrderId) {
      query += ' AND id <> $3';
      params.push(excludeOrderId);
    }
    query += ' LIMIT 1';

    const { rows: [dup] } = await dbHandle.query(query, params);
    if (!dup) break;
    attempts++;
  }

  if (attempts >= MAX_GEN_ATTEMPTS) {
    log.error(`[PICKUP-SECRET] Saturation anti-collision relais=${relaisId} channel=${channel}`);
    throw new Error('Génération du code impossible (saturation)');
  }

  const hash = hashCode(code, salt);
  const now = new Date();
  const expires = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);

  const baseCols = {
    pickup_secret_hash: hash,
    pickup_secret_salt: salt,
    pickup_secret_last4: last4,
    pickup_secret_created_at: now,
    pickup_secret_expires_at: expires,
    pickup_secret_attempts: 0,
    pickup_secret_blocked_until: null,
    pickup_secret_channel: channel,
    pickup_secret_emitted_at: now,
  };

  await writePickupSecret(dbHandle, {
    orderId,
    fields: Object.assign({}, baseCols, extraUpdates || {}),
  });

  log.info(`[PICKUP-SECRET] ✅ Code généré channel=${channel} order=${orderId} last4=${last4}`);
  return { code, last4 };
}

module.exports = { generateAndStoreSecret };
