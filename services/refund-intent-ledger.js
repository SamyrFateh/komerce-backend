/**
 * @komerce-arch
 * @role          durable-refund-intent-reservation
 * @domain        refunds
 * @layer         service
 * @criticality   critical
 * @inputs        order, provider, capture, event id, EUR amount
 * @outputs       durable intent id and stable PSP request key
 * @depends       db.js, orders, refunds, refund_execution_intents
 * @used-by       future refund orchestrators (NOT ACTIVATED)
 * @db-read       orders, refunds, refund_execution_intents
 * @db-write      refund_execution_intents
 * @db-txn        explicit BEGIN / COMMIT before PSP; NO PSP call here
 * @doctrine      multi_market_isolation, idempotent_refund, legacy_reconciliation_first
 *
 * Foundation RC-5/RC-9 only. Callers MUST NOT send payments until after commit.
 * The existing Stripe/PayPal refund flows are NOT rewired by this module.
 */
'use strict';

const defaultDb = require('../db');

class RefundIntentError extends Error {
  constructor(code, message, status = 409) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function euroCents(value, allowZero = false) {
  const input = String(value ?? '').trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(input)) {
    throw new RefundIntentError('REFUND_AMOUNT_INVALID', 'EUR invalide, au plus deux décimales', 400);
  }
  const [whole, decimals = ''] = input.split('.');
  const cents = BigInt(whole) * 100n + BigInt(decimals.padEnd(2, '0'));
  if (cents < 0n || (!allowZero && cents === 0n) || cents > 999999999999n) {
    throw new RefundIntentError('REFUND_AMOUNT_INVALID', 'EUR hors plafond ou nul', 400);
  }
  return cents;
}

function euroString(cents) {
  return (cents / 100n).toString() + '.' + (cents % 100n).toString().padStart(2, '0');
}

function providerKey(id) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id))) {
    throw new RefundIntentError('REFUND_INTENT_ID_INVALID', 'ID intention invalide', 400);
  }
  return 'kmr-ref-' + String(id).toLowerCase();
}

function orderCapture(order, provider) {
  if (provider === 'stripe' && order.payment_mode === 'stripe_eur') return order.stripe_payment_id;
  if (provider === 'paypal' && order.payment_mode === 'paypal_eur') return order.paypal_capture_id;
  return null;
}

async function reserveRefundIntent({
  orderId, operationKey, provider, captureRef, amountEur, initiatedBy = null, db = defaultDb,
}) {
  if (!orderId || !operationKey || !captureRef || !['stripe', 'paypal'].includes(provider)) {
    throw new RefundIntentError('REFUND_INTENT_INPUT_INVALID', 'Commande, événement, capture et PSP requis', 400);
  }
  if (String(operationKey).length > 160 || !/^[a-zA-Z0-9:_./-]+$/.test(operationKey)) {
    throw new RefundIntentError('REFUND_OPERATION_KEY_INVALID', 'Identifiant événement non autorisé', 400);
  }
  const requested = euroCents(amountEur);
  const client = await db.connect();
  let active = false;
  try {
    await client.query('BEGIN');
    active = true;
    // Serialize every reservation per order at the PostgreSQL boundary.
    const orderResult = await client.query(
      'SELECT id, market_id, total_eur, payment_status, payment_mode, ' +
      'stripe_payment_id, paypal_capture_id FROM orders WHERE id = $1 FOR UPDATE', [orderId]
    );
    const order = orderResult.rows[0];
    if (!order || !order.market_id) {
      throw new RefundIntentError('REFUND_ORDER_UNKNOWN', 'Commande ou marché introuvable');
    }
    if (order.payment_status !== 'paid') {
      throw new RefundIntentError('REFUND_PAYMENT_NOT_CONFIRMED', 'Commande non payée');
    }
    if (!orderCapture(order, provider) || String(orderCapture(order, provider)) !== String(captureRef)) {
      throw new RefundIntentError('REFUND_CAPTURE_MISMATCH', 'Prestataire ou capture incohérent');
    }

    const found = await client.query(
      'SELECT id, order_id, market_id, capture_ref, amount_eur, status ' +
      'FROM refund_execution_intents WHERE provider = $1 AND operation_key = $2 FOR UPDATE',
      [provider, operationKey]
    );
    const existing = found.rows[0];
    if (existing) {
      if (String(existing.order_id) !== String(orderId) ||
          String(existing.market_id) !== String(order.market_id) ||
          String(existing.capture_ref) !== String(captureRef) ||
          euroCents(existing.amount_eur) !== requested) {
        throw new RefundIntentError('REFUND_REPLAY_PAYLOAD_MISMATCH', 'Événement rejoué avec paramètres différents');
      }
      await client.query('COMMIT');
      active = false;
      return { intentId: existing.id, providerRequestKey: providerKey(existing.id),
        status: existing.status, replayed: true, executable: false };
    }

    // ANY existing refund (wallet or PSP) is not automatically migrated or
    // reconciled: they must be reviewed before enabling this new ledger.
    const legacy = await client.query(
      'SELECT id FROM refunds WHERE order_id = $1 LIMIT 1',
      [orderId]
    );
    if (legacy.rows.length) {
      throw new RefundIntentError('REFUND_LEGACY_RECONCILIATION_REQUIRED',
        'Remboursement historique non rapproché');
    }

    const unresolved = await client.query(
      "SELECT id FROM refund_execution_intents WHERE order_id = $1 " +
      "AND status IN ('reserved','processing','unknown') LIMIT 1", [orderId]
    );
    if (unresolved.rows.length) {
      throw new RefundIntentError('REFUND_UNRESOLVED_INTENT', 'Opération PSP en cours ou inconnue');
    }

    const totals = await client.query(
      "SELECT COALESCE(SUM(amount_eur),0)::text AS confirmed_eur " +
      "FROM refund_execution_intents WHERE order_id = $1 AND status = 'confirmed'", [orderId]
    );
    const captured = euroCents(order.total_eur);
    const done = euroCents(totals.rows[0]?.confirmed_eur ?? '0', true);
    if (requested + done > captured) {
      throw new RefundIntentError('REFUND_EXCEEDS_CAPTURE', 'Montant total supérieur à la capture EUR');
    }

    const inserted = await client.query(
      'INSERT INTO refund_execution_intents ' +
      '(order_id, market_id, provider, capture_ref, operation_key, amount_eur, initiated_by) ' +
      'VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, status',
      [orderId, order.market_id, provider, captureRef, operationKey, euroString(requested), initiatedBy]
    );
    const intent = inserted.rows[0];
    await client.query('COMMIT');
    active = false;
    return { intentId: intent.id, providerRequestKey: providerKey(intent.id),
      status: intent.status, replayed: false, executable: false };
  } catch (error) {
    if (active) await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Claim only AFTER reserveRefundIntent returned a committed reservation.
 * Processing and unknown are deliberately NOT retryable without PSP reconciliation.
 * A claim is a transaction that finishes before any external PSP call.
 */
async function claimRefundIntent({ intentId, db = defaultDb }) {
  const client = await db.connect();
  let active = false;
  try {
    await client.query('BEGIN');
    active = true;
    const found = await client.query(
      'SELECT id, status, provider, capture_ref, amount_eur FROM refund_execution_intents ' +
      'WHERE id = $1 FOR UPDATE', [intentId]
    );
    const intent = found.rows[0];
    if (!intent || intent.status !== 'reserved') {
      throw new RefundIntentError('REFUND_INTENT_NOT_CLAIMABLE', 'Opération déjà lancée ou à rapprocher');
    }
    const updated = await client.query(
      "UPDATE refund_execution_intents SET status = 'processing', " +
      "processing_at = NOW(), updated_at = NOW() WHERE id = $1 AND status = 'reserved' RETURNING id",
      [intent.id]
    );
    if (updated.rows.length !== 1) {
      throw new RefundIntentError('REFUND_INTENT_CLAIM_CONFLICT', 'Intention non attribuable');
    }
    await client.query('COMMIT');
    active = false;
    return { ...intent, providerRequestKey: providerKey(intent.id) };
  } catch (error) {
    if (active) await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  RefundIntentError, euroCents, euroString, providerKey,
  reserveRefundIntent, claimRefundIntent,
};
