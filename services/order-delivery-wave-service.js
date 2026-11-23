/**
 * @komerce-arch
 * @role          order-delivery-wave
 * @domain        orders
 * @layer         service
 * @criticality   critical
 * @inputs        transactional_pg_client, verified_buyer_id, market_id, relais_id, market_code
 * @outputs       unique_commercial_reference, invisible_wave_id
 * @depends       services/relais-mutation-service.js, crypto
 * @used-by       services/order-checkout-service.js, services/pickup-collection-recorder.js
 * @db-read       orders, order_delivery_waves, relais
 * @db-write      order_delivery_waves
 * @db-write-via:relais-mutation-service relais
 * @db-txn        participant (must use checkout / pickup transaction)
 * @doctrine      single_market_relay_client_wave_order_reference, no_bags, no_public_wave_endpoint
 * @impact-areas  orders, checkout, logistics, pickup, market, relay, G6
 * @version       2026-11
 */
'use strict';

const { randomInt } = require('crypto');
const { ensureRelaisShortCode } = require('./relais-mutation-service');

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const SYMBOLS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_WAVE_AGE_DAYS = 90;
const MAX_RETRIES = 64;

function wavesEnabled(env = process.env) {
  if (env.KOMERCE_ORDER_WAVES_ENABLED !== '1') return false;
  if (env.KOMERCE_ENV !== 'staging') {
    const error = new Error('ORDER_WAVES_STAGING_ONLY');
    error.code = 'ORDER_WAVES_STAGING_ONLY';
    throw error;
  }
  return true;
}

function randomFrom(alphabet, length) {
  let code = '';
  for (let n = 0; n < length; n++) code += alphabet[randomInt(alphabet.length)];
  return code;
}

function randomClientCode() {
  return randomFrom(LETTERS, 1) + randomFrom(SYMBOLS, 3);
}

function validateMarketCode(value) {
  if (!/^[A-Z]{2}$/.test(value || '')) throw new Error('ORDER_WAVE_MARKET_CODE_INVALID');
  return value;
}

function buildReference({ marketCode, relayCode, clientCode, suffix }) {
  validateMarketCode(marketCode);
  if (!/^[A-Z]{3}[1-9][0-9]?$/.test(relayCode || '') ||
      !/^[A-HJ-NP-Z][A-HJ-NP-Z2-9]{3}$/.test(clientCode || '') ||
      !/^[A-HJ-NP-Z2-9]{2}$/.test(suffix || '')) {
    throw new Error('ORDER_WAVE_REFERENCE_PART_INVALID');
  }
  return [marketCode, relayCode, clientCode, suffix].join('-');
}

/**
 * Called only AFTER the checkout idempotency claim, in the SAME transaction
 * that persists the order. Serializes simultaneous buyer checkouts.
 * The returned reference is commercial and unique; the wave is private.
 */
async function reserveWaveReference(client, { userId, marketId, relaisId, marketCode }) {
  if (!client || !userId || !marketId || !relaisId) {
    throw new Error('ORDER_WAVE_VERIFIED_SCOPE_REQUIRED');
  }
  validateMarketCode(marketCode);
  const { rows: [relay] } = await client.query(
    'SELECT id FROM relais WHERE id = $1 AND market_id = $2 AND is_active = TRUE',
    [relaisId, marketId]
  );
  if (!relay) throw new Error('ORDER_WAVE_RELAIS_NOT_IN_MARKET');

  // A single advisory lock per verified buyer + destination serializes
  // create/join; the row lock serializes against a simultaneous closing pickup.
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    ['delivery-wave:' + userId + ':' + marketId + ':' + relaisId]
  );
  const relayCode = await ensureRelaisShortCode(client, { marketId, relaisId });
  const { rows: open } = await client.query(
    `SELECT id, client_code, opened_at
       FROM order_delivery_waves
      WHERE subject_user_id=$1 AND market_id=$2 AND relais_id=$3 AND closed_at IS NULL
      FOR UPDATE`,
    [userId, marketId, relaisId]
  );
  let wave = open[0] || null;
  if (wave && new Date(wave.opened_at).getTime() <= Date.now() - MAX_WAVE_AGE_DAYS * 86400000) {
    await client.query(
      `UPDATE order_delivery_waves SET closed_at=now(), close_reason='EXPIRED'
        WHERE id=$1 AND closed_at IS NULL`,
      [wave.id]
    );
    wave = null;
  }
  if (!wave) {
    for (let i = 0; i < MAX_RETRIES; i++) {
      const candidate = randomClientCode();
      const { rows } = await client.query(
        `INSERT INTO order_delivery_waves
           (subject_user_id, market_id, relais_id, client_code)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT DO NOTHING
         RETURNING id, client_code`,
        [userId, marketId, relaisId, candidate]
      );
      if (rows.length) { wave = rows[0]; break; }
    }
    if (!wave) throw new Error('ORDER_WAVE_CODE_EXHAUSTED');
  }
  for (let i = 0; i < MAX_RETRIES; i++) {
    const reference = buildReference({
      marketCode, relayCode, clientCode: wave.client_code, suffix: randomFrom(SYMBOLS, 2),
    });
    const { rows } = await client.query('SELECT 1 FROM orders WHERE reference=$1 LIMIT 1', [reference]);
    if (!rows.length) return { reference, waveId: wave.id, relayCode, clientCode: wave.client_code };
  }
  throw new Error('ORDER_WAVE_ORDER_SUFFIX_EXHAUSTED');
}

/**
 * Close admission to the wave after the FIRST actual, proven physical handoff.
 * Existing orders and their references do not change, even on partial pickup.
 * Called inside the SAME transaction as the canonical handoff proof.
 */
async function closeWaveOnFirstHandoff(client, orderId) {
  if (!wavesEnabled()) return false;
  const { rows } = await client.query(
    `UPDATE order_delivery_waves w
        SET closed_at=now(), close_reason='FIRST_HANDOFF'
      FROM orders o
      WHERE o.id=$1 AND o.delivery_wave_id=w.id AND w.closed_at IS NULL
      RETURNING w.id`,
    [orderId]
  );
  return rows.length > 0;
}

module.exports = {
  LETTERS, SYMBOLS, wavesEnabled, randomClientCode, buildReference,
  reserveWaveReference, closeWaveOnFirstHandoff,
};
