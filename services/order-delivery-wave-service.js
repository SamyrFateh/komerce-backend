/**
 * @komerce-arch
 * @role          order-delivery-wave
 * @domain        orders
 * @layer         service
 * @criticality   critical
 * @inputs        transactional_pg_client, verified_buyer_id, verified_recipient_id, market_id, relais_id, market_code, expected_units
 * @outputs       unique_structured_order_reference, invisible_wave_id
 * @depends       services/relais-mutation-service.js, crypto
 * @used-by       services/order-checkout-service.js, services/pickup-collection-recorder.js
 * @db-read       orders, order_delivery_waves, relais, recipients
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

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const SYMBOLS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_WAVE_AGE_DAYS = 90;
const MAX_RETRIES = 64;
const MAX_ORDERS_PER_WAVE = 99;

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

// The first character is NOT randomized. It is the relay-local load-balanced
// letter allocated transactionally; the remaining two are collision-resistant.
function randomClientCode(letter) {
  if (!LETTERS.includes(letter) || letter.length !== 1) throw new Error('ORDER_WAVE_LETTER_INVALID');
  return letter + randomFrom(SYMBOLS, 2);
}

function validateMarketCode(value) {
  if (!/^[A-Z]{2}$/.test(value || '')) throw new Error('ORDER_WAVE_MARKET_CODE_INVALID');
  return value;
}

function buildReference({ marketCode, relayCode, clientCode, orderNumber }) {
  validateMarketCode(marketCode);
  if (!/^[A-Z]{2}(0[1-9]|[1-9][0-9])$/.test(relayCode || '') ||
      !/^[A-Z][A-HJ-NP-Z2-9]{2}$/.test(clientCode || '') ||
      !Number.isSafeInteger(orderNumber) || orderNumber < 1 || orderNumber > MAX_ORDERS_PER_WAVE) {
    throw new Error('ORDER_WAVE_REFERENCE_PART_INVALID');
  }
  return marketCode + '-' + relayCode + '-' + clientCode + String(orderNumber).padStart(2, '0');
}

function chooseLetter(rows) {
  const totals = new Map(LETTERS.split('').map(letter => [letter, 0]));
  for (const row of rows) {
    const letter = String(row.letter || '');
    if (totals.has(letter)) totals.set(letter, totals.get(letter) + Number(row.units || 0));
  }
  const min = Math.min(...totals.values());
  // For ties, start at the relay-local rotation cursor and advance clockwise.
  const allocated = rows.reduce((sum, row) => sum + Number(row.allocations || 0), 0);
  for (let offset = 0; offset < LETTERS.length; offset++) {
    const letter = LETTERS[(allocated + offset) % LETTERS.length];
    if (totals.get(letter) === min) return letter;
  }
  throw new Error('ORDER_WAVE_LETTER_UNAVAILABLE');
}

/**
 * Under the checkout transaction, serializes allocations for the entire relay
 * so two different recipients cannot claim the same letter/candidate concurrently.
 * The order reference is the SINGLE commercial reference.
 */
async function reserveWaveReference(client, { userId, recipientId, marketId, relaisId, marketCode, expectedUnits = 1 }) {
  if (!client || !userId || !recipientId || !marketId || !relaisId) {
    throw new Error('ORDER_WAVE_VERIFIED_SCOPE_REQUIRED');
  }
  if (!Number.isSafeInteger(expectedUnits) || expectedUnits < 1) throw new Error('ORDER_WAVE_UNITS_INVALID');
  validateMarketCode(marketCode);
  const { rows: [relay] } = await client.query(
    'SELECT id FROM relais WHERE id = $1 AND market_id = $2 AND is_active = TRUE',
    [relaisId, marketId]
  );
  if (!relay) throw new Error('ORDER_WAVE_RELAIS_NOT_IN_MARKET');
  const { rows: [recipient] } = await client.query(
    'SELECT id FROM recipients WHERE id=$1 AND user_id=$2 AND relais_id=$3',
    [recipientId, userId, relaisId]
  );
  if (!recipient) throw new Error('ORDER_WAVE_RECIPIENT_NOT_VERIFIED');

  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    ['delivery-wave-relay:' + marketId + ':' + relaisId]);
  const relayCode = await ensureRelaisShortCode(client, { marketId, relaisId });
  const { rows: open } = await client.query(
    `SELECT id, client_code, opened_at, next_order_number
       FROM order_delivery_waves
      WHERE subject_recipient_id=$1 AND market_id=$2 AND relais_id=$3 AND closed_at IS NULL
      FOR UPDATE`,
    [recipientId, marketId, relaisId]
  );
  let wave = open[0] || null;
  if (wave && (new Date(wave.opened_at).getTime() <= Date.now() - MAX_WAVE_AGE_DAYS * 86400000 ||
      Number(wave.next_order_number) > MAX_ORDERS_PER_WAVE)) {
    await client.query(
      `UPDATE order_delivery_waves SET closed_at=now(), close_reason='EXPIRED'
        WHERE id=$1 AND closed_at IS NULL`, [wave.id]
    );
    wave = null;
  }
  if (!wave) {
    const { rows: loads } = await client.query(
      `SELECT left(client_code, 1) AS letter,
              sum(CASE WHEN closed_at IS NULL THEN planned_units ELSE 0 END)::bigint AS units,
              count(*)::int AS allocations
         FROM order_delivery_waves
        WHERE market_id=$1 AND relais_id=$2
        GROUP BY left(client_code, 1)`,
      [marketId, relaisId]
    );
    const letter = chooseLetter(loads);
    for (let i = 0; i < MAX_RETRIES; i++) {
      const candidate = randomClientCode(letter);
      const { rows } = await client.query(
        `INSERT INTO order_delivery_waves
           (subject_recipient_id, market_id, relais_id, client_code, planned_units, next_order_number)
         VALUES ($1,$2,$3,$4,0,1)
         ON CONFLICT DO NOTHING
         RETURNING id, client_code, next_order_number`,
        [recipientId, marketId, relaisId, candidate]
      );
      if (rows.length) { wave = rows[0]; break; }
    }
    if (!wave) throw new Error('ORDER_WAVE_CODE_EXHAUSTED');
  }
  // Row-locked counter is allocated with the same transaction as INSERT orders.
  // A rollback returns both the order number and planned quantity to the pool.
  const orderNumber = Number(wave.next_order_number);
  if (!Number.isSafeInteger(orderNumber) || orderNumber < 1 || orderNumber > MAX_ORDERS_PER_WAVE) {
    throw new Error('ORDER_WAVE_ORDER_NUMBER_EXHAUSTED');
  }
  const reference = buildReference({ marketCode, relayCode, clientCode: wave.client_code, orderNumber });
  const { rows: allocated } = await client.query(
    `UPDATE order_delivery_waves
        SET next_order_number=next_order_number+1, planned_units=planned_units+$2
      WHERE id=$1 AND next_order_number=$3
      RETURNING id`,
    [wave.id, expectedUnits, orderNumber]
  );
  if (!allocated.length) throw new Error('ORDER_WAVE_CONCURRENT_NUMBER_CONFLICT');
  return { reference, waveId: wave.id, relayCode, clientCode: wave.client_code, orderNumber };
}

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
  LETTERS, SYMBOLS, wavesEnabled, randomClientCode, buildReference, chooseLetter,
  reserveWaveReference, closeWaveOnFirstHandoff,
};
