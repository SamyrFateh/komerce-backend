'use strict';

/**
 * KOMERCE — services/payment-paypal.js  (R5)
 *
 * Logique métier PayPal extraite de routes/payments-paypal.js.
 * La route reste une façade : auth + ownership + validate + appel service.
 *
 * Invariants :
 *   I-02 : confirmPaymentCycle = seul point d'entrée paiement→stock
 *   I-07 : idempotence webhook via paypal_events_processed
 *   I-09 : amount captured == orders.total_eur (tolérance 0.01 EUR)
 */

const log = require('../utils/logger').child({ module: 'payment-paypal' });
const { confirmPaymentCycle } = require('./order-payment-confirmation');
const { markPaypalEventProcessed } = require('./payment-paypal-events');
const { generateAndStoreSecret, cacheCodeForReveal } = require('../routes/pickup-secret');
const notifSvc = require('./notification-service');

// ─── helpers ────────────────────────────────────────────────────────────────
function toCents(amount) {
  return Math.round(Number(amount || 0) * 100);
}

function amountsMatch(a, b) {
  return Math.abs(toCents(a) - toCents(b)) <= 1;
}

// ─── createPaypalOrder ───────────────────────────────────────────────────────
async function createPaypalOrder(order, paypal, db) {
  if (!order) throw new Error('order requis');
  if (!paypal?.createOrder) throw new Error('paypal client requis');

  const amountEur = Number(order.total_eur);
  if (!Number.isFinite(amountEur) || amountEur <= 0) {
    return { invalid_amount: true, status: 400 };
  }

  const ppOrder = await paypal.createOrder({
    amountEur,
    reference: order.reference,
    orderId: order.id,
  });

  await db.query('UPDATE orders SET paypal_order_id = $1 WHERE id = $2', [ppOrder.id, order.id]);

  return {
    paypal_order_id: ppOrder.id,
    status: ppOrder.status,
    raw: ppOrder,
  };
}

// ─── capturePaypalOrder ──────────────────────────────────────────────────────
async function capturePaypalOrder(paypalOrderId, order, paypal, db) {
  if (!paypalOrderId) return { status: 400, error: 'paypal_order_id requis' };
  if (!order) return { status: 404, error: 'Commande introuvable' };
  if (!paypal?.captureOrder || !paypal?.extractCaptureInfo) {
    throw new Error('paypal client invalide');
  }

  if (order.payment_status === 'paid') {
    return { already_paid: true, order_id: order.id };
  }

  const raw = await paypal.captureOrder(paypalOrderId);
  const info = paypal.extractCaptureInfo(raw);

  if (!info || info.status !== 'COMPLETED') {
    try {
      await db.query(
        `INSERT INTO alerts (level, source, message, payload)
         VALUES ($1, 'paypal_capture', $2, $3)`,
        [
          'warning',
          `paypal_capture_not_completed — order ${order.reference}`,
          JSON.stringify({ order_id: order.id, paypal_order_id: paypalOrderId, capture_info: info }),
        ]
      );
    } catch (e) {
      log.error({ err: e.message }, '[PAYPAL] alert insert failed');
    }
    return { capture_not_completed: true, capture_info: info };
  }

  if (!amountsMatch(info.amount_value, order.total_eur)) {
    try {
      await db.query(
        `INSERT INTO alerts (level, source, message, payload)
         VALUES ($1, 'paypal_capture', $2, $3)`,
        [
          'critical',
          `paypal_amount_mismatch — order ${order.reference}`,
          JSON.stringify({
            order_id: order.id,
            paypal_order_id: paypalOrderId,
            paypal_capture_id: info.paypal_capture_id,
            expected: Number(order.total_eur),
            actual: Number(info.amount_value),
          }),
        ]
      );
    } catch (e) {
      log.error({ err: e.message }, '[PAYPAL] amount mismatch alert insert failed');
    }
    return {
      amount_mismatch: true,
      expected: Number(order.total_eur),
      actual: Number(info.amount_value),
    };
  }

  const client = await db.getClient();
  let pickupCode = null;
  let stockBlocked = false;

  try {
    await client.query('BEGIN');

    // Recharger/verrouiller la commande pour éviter double capture concurrente.
    const { rows: [orderRow] } = await client.query(
      'SELECT * FROM orders WHERE id = $1 FOR UPDATE', [order.id]
    );
    if (!orderRow) {
      await client.query('ROLLBACK');
      return { status: 404, error: 'Commande introuvable' };
    }
    if (orderRow.payment_status === 'paid') {
      await client.query('COMMIT');
      return { already_paid: true, order_id: order.id };
    }

    await client.query(
      `UPDATE orders SET
         paypal_order_id   = COALESCE(paypal_order_id, $1),
         paypal_capture_id = $2,
         payment_mode      = COALESCE(payment_mode, 'paypal_eur'::payment_mode),
         stripe_billing_name  = $3,
         stripe_receipt_email = $4
       WHERE id = $5`,
      [paypalOrderId, info.paypal_capture_id, info.payer_name || null, info.payer_email || null, order.id]
    );

    const cycleResult = await confirmPaymentCycle({
      orderId: order.id,
      actor:   { id: order.user_id || null, role: 'paypal' },
      source:  'paypal_capture',
      dbClient: client,
      note:    `Paiement PayPal capturé (${info.paypal_capture_id})`,
    });

    if (cycleResult.stockBlocked) {
      stockBlocked = true;
      // La capture PayPal a réussi mais le stock ne permet pas de finaliser.
      // On garde la trace PayPal et on alerte ; pas de notification/sourcing.
      await client.query(
        `INSERT INTO alerts (level, source, message, payload)
         VALUES ($1, 'paypal_capture', $2, $3)`,
        [
          'critical',
          `paypal_paid_stock_blocked — order ${order.reference}`,
          JSON.stringify({
            order_id: order.id,
            paypal_order_id: paypalOrderId,
            paypal_capture_id: info.paypal_capture_id,
            insufficientItems: cycleResult.insufficientItems || [],
          }),
        ]
      );
    }

    try {
      const genResult = await generateAndStoreSecret({
        orderId:  order.id,
        relaisId: orderRow?.relais_id || null,
        channel:  'paypal',
        dbClient: client,
        extraUpdates: {
          stripe_billing_name:  info.payer_name,
          stripe_receipt_email: info.payer_email,
        },
      });
      pickupCode = genResult.code;
    } catch (genErr) {
      log.error({ err: genErr.message, order_id: order.id },
        '[PAYPAL] génération code retrait échouée — non-bloquant');
    }

    await client.query('COMMIT');

    // Post-commit : caching du code (non-bloquant)
    if (pickupCode) {
      cacheCodeForReveal(order.id, pickupCode)
        .catch(e => log.error({ err: e.message }, '[PAYPAL] cacheCodeForReveal failed'));
    }

    // PAY-02 — Hooks post-paiement communs (notification + sourcing), alignés sur Stripe/cash.
    // Ne pas notifier ni sourcer si confirmPaymentCycle a bloqué le stock.
    if (!stockBlocked) {
      try {
        const { triggerPurchasing } = require('../routes/purchasing');
        notifSvc.notifyPaymentConfirmed(order.id, order.reference)
          .catch(e => log.error({ err: e }, '[PAYPAL] notification failed'));
        triggerPurchasing(order.id)
          .then(() => log.info({ order_reference: order.reference }, '[PURCHASING] PayPal trigger OK'))
          .catch(e => log.error({ err: e, order_reference: order.reference }, '[PURCHASING] PayPal trigger error'));
      } catch (e) {
        log.error({ err: e.message }, '[PAYPAL-POSTCOMMIT] Non-fatal hook error');
      }
    } else {
      log.warn({ order_id: order.id, order_reference: order.reference }, '[PAYPAL-POSTCOMMIT] stockBlocked=true — notification et sourcing suspendus');
    }

    log.info({
      order_id: order.id, order_reference: order.reference,
      paypal_capture_id: info.paypal_capture_id,
      pay_in_4: info.pay_in_4, stock_blocked: stockBlocked,
    }, '[PAYPAL] capture OK');

    return {
      success:         true,
      order_id:        order.id,
      order_reference: order.reference,
      pay_in_4_used:   info.pay_in_4,
      stock_blocked:   stockBlocked,
    };

  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw err;
  } finally {
    client.release();
  }
}

// ─── handlePaypalWebhookEvent ─────────────────────────────────────────────────
/**
 * Vérifie la signature, vérifie l'idempotence, dispatche l'event.
 *
 * @param {object} event    — event PayPal parsé
 * @param {string} rawBody  — body brut (string) pour la vérification de signature
 * @param {object} headers  — req.headers
 * @param {object} db       — module db (pool)
 * @param {object} paypal   — instance paypal-client
 * @returns {{ received, idempotent?, ignored?, error? }}
 */
async function handlePaypalWebhookEvent(event, rawBody, headers, db, paypal) {
  // Vérification signature
  const signatureValid = await paypal.verifyWebhookSignature(headers, rawBody);
  if (!signatureValid) {
    log.warn({ event_id: event.id, event_type: event.event_type },
      '[PAYPAL-WEBHOOK] signature invalide — rejet');
    return { invalidSignature: true };
  }

  // Idempotence I-07
  try {
    const seen = await db.query(
      'SELECT 1 FROM paypal_events_processed WHERE event_id = $1', [event.id]
    );
    if (seen.rows.length) {
      log.info({ event_id: event.id }, '[PAYPAL-WEBHOOK] déjà traité — idempotent');
      return { received: true, idempotent: true };
    }
  } catch (e) {
    log.warn({ err: e.message }, '[PAYPAL-WEBHOOK] paypal_events_processed unavailable');
  }

  // Dispatch
  switch (event.event_type) {
    case 'PAYMENT.CAPTURE.COMPLETED':
      await _handleCaptureCompleted(event, db, paypal);
      break;
    case 'PAYMENT.CAPTURE.DENIED':
    case 'PAYMENT.CAPTURE.DECLINED':
      await _handleCaptureDenied(event, db, paypal);
      break;
    case 'PAYMENT.CAPTURE.REFUNDED':
    case 'PAYMENT.CAPTURE.REVERSED':
      await _handleCaptureRefunded(event, db);
      break;
    case 'CUSTOMER.DISPUTE.CREATED':
    case 'CUSTOMER.DISPUTE.UPDATED':
      await _handleDispute(event, db);
      break;
    default:
      await markPaypalEventProcessed(event, 'ignored', { reason: 'not_handled' }, db);
      return { received: true, ignored: true };
  }

  return { received: true };
}

// ─── Handlers internes ────────────────────────────────────────────────────────

async function _handleCaptureCompleted(event, db, paypal) {
  const info = paypal.extractCaptureInfo(event);
  if (!info?.paypal_capture_id) {
    log.warn({ event_id: event.id }, '[PAYPAL-WEBHOOK] capture event sans capture_id');
    await markPaypalEventProcessed(event, 'ignored', { reason: 'no_capture_id' }, db);
    return;
  }

  // Lookup order — triple stratégie
  let order = null;
  if (info.paypal_capture_id) {
    const r = await db.query('SELECT * FROM orders WHERE paypal_capture_id = $1', [info.paypal_capture_id]);
    if (r.rows.length) order = r.rows[0];
  }
  if (!order && info.paypal_order_id) {
    const r = await db.query('SELECT * FROM orders WHERE paypal_order_id = $1', [info.paypal_order_id]);
    if (r.rows.length) order = r.rows[0];
  }
  if (!order && info.reference_id) {
    const r = await db.query('SELECT * FROM orders WHERE reference = $1', [info.reference_id]);
    if (r.rows.length) order = r.rows[0];
  }

  if (!order) {
    log.warn({ capture_id: info.paypal_capture_id, event_id: event.id },
      '[PAYPAL-WEBHOOK] capture event sans order matching');
    await markPaypalEventProcessed(event, 'ignored',
      { reason: 'order_not_found', capture_id: info.paypal_capture_id }, db);
    return;
  }

  // Déjà payé (capture endpoint a fait le job)
  if (order.payment_status === 'paid') {
    log.info({ order_id: order.id, event_id: event.id },
      '[PAYPAL-WEBHOOK] order déjà paid — idempotent');
    await markPaypalEventProcessed(event, 'noop', { order_id: order.id, reason: 'already_paid' }, db);
    return;
  }

  // Fallback : cycle paiement via webhook
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const cycleResult = await confirmPaymentCycle({
      orderId:  order.id,
      actor:    { id: null, role: 'system' },
      source:   'paypal_capture',
      dbClient: client,
      note:     `Paiement PayPal confirmé via webhook (capture ${info.paypal_capture_id})`,
    });

    if (cycleResult.noop) {
      await client.query('COMMIT');
      await markPaypalEventProcessed(event, 'noop', { order_id: order.id }, db);
      return;
    }
    if (!cycleResult.success) {
      await client.query('ROLLBACK');
      await markPaypalEventProcessed(event, 'rejected',
        { order_id: order.id, error: cycleResult.error }, db);
      return;
    }

    await client.query(
      `UPDATE orders SET
         paypal_capture_id = COALESCE(paypal_capture_id, $1),
         payment_mode      = COALESCE(payment_mode, 'paypal_eur'::payment_mode)
       WHERE id = $2`,
      [info.paypal_capture_id, order.id]
    );

    // Marquer dans la même tx
    await client.query(
      `INSERT INTO paypal_events_processed (event_id, event_type, payload_summary, status)
       VALUES ($1, $2, $3, 'processed') ON CONFLICT (event_id) DO NOTHING`,
      [event.id, event.event_type, JSON.stringify({
        order_id:          order.id,
        order_reference:   order.reference,
        paypal_capture_id: info.paypal_capture_id,
        stock_blocked:     !!cycleResult.stockBlocked,
      })]
    );

    await client.query('COMMIT');

    // PAY-02 — Hooks post-paiement communs (notification + sourcing).
    // Ne pas notifier ni sourcer si confirmPaymentCycle a bloqué le stock.
    if (!cycleResult.stockBlocked) {
      try {
        const { triggerPurchasing } = require('../routes/purchasing');
        notifSvc.notifyPaymentConfirmed(order.id, order.reference)
          .catch(e => log.error({ err: e }, '[PAYPAL-WEBHOOK] notification failed'));
        triggerPurchasing(order.id)
          .then(() => log.info({ order_reference: order.reference }, '[PURCHASING] PayPal webhook trigger OK'))
          .catch(e => log.error({ err: e, order_reference: order.reference }, '[PURCHASING] PayPal webhook trigger error'));
      } catch (e) {
        log.error({ err: e.message }, '[PAYPAL-WEBHOOK-POSTCOMMIT] Non-fatal hook error');
      }
    } else {
      log.warn({ order_id: order.id, order_reference: order.reference }, '[PAYPAL-WEBHOOK-POSTCOMMIT] stockBlocked=true — notification et sourcing suspendus');
    }

    log.info({ order_id: order.id, paypal_capture_id: info.paypal_capture_id, source: 'webhook_fallback' },
      '[PAYPAL-WEBHOOK] capture traitée via webhook (capture endpoint avait probablement échoué)');

  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw err;
  } finally {
    client.release();
  }
}

async function _handleCaptureDenied(event, db, paypal) {
  const info = paypal.extractCaptureInfo(event);
  log.warn({ event_id: event.id, capture_id: info?.paypal_capture_id },
    '[PAYPAL-WEBHOOK] capture DENIED');
  try {
    await db.query(
      `INSERT INTO alerts (level, source, message, payload) VALUES ($1, 'paypal_webhook', $2, $3)`,
      [
        'warning',
        `paypal_capture_denied — ${info?.reference_id || event.id}`,
        JSON.stringify({ event_id: event.id, capture_info: info }),
      ]
    );
  } catch (_) { /* non-bloquant */ }
  await markPaypalEventProcessed(event, 'processed', { reason: 'denied_logged' }, db);
}

async function _handleCaptureRefunded(event, db) {
  try {
    await db.query(
      `INSERT INTO alerts (level, source, message, payload) VALUES ($1, 'paypal_webhook', $2, $3)`,
      ['warning', `paypal_capture_refunded — ${event.id}`, JSON.stringify({ event_id: event.id })]
    );
  } catch (_) {}
  await markPaypalEventProcessed(event, 'processed', { reason: 'refund_logged' }, db);
}

async function _handleDispute(event, db) {
  try {
    await db.query(
      `INSERT INTO alerts (level, source, message, payload) VALUES ($1, 'paypal_webhook', $2, $3)`,
      ['critical', `paypal_dispute — ${event.id}`, JSON.stringify({ event_id: event.id, event_type: event.event_type })]
    );
  } catch (_) {}
  await markPaypalEventProcessed(event, 'processed', { reason: 'dispute_logged' }, db);
}

// ─── refundPaypalOrder ───────────────────────────────────────────────────────
async function refundPaypalOrder({ orderId, amountEur, reason, adminUser, paypal, db }) {
  if (!orderId) return { status: 400, body: { error: 'orderId requis' } };

  const { rows: [order] } = await db.query(
    'SELECT * FROM orders WHERE id = $1', [orderId]
  );

  if (!order) return { status: 404, body: { error: 'Commande introuvable' } };
  if (!order.paypal_capture_id) {
    return { status: 409, body: { error: 'Pas de capture PayPal liée à cette commande' } };
  }
  if (order.payment_status !== 'paid') {
    return { status: 409, body: { error: 'Commande non payée — refund impossible' } };
  }

  const refundAmount = amountEur ? Number(amountEur) : Number(order.total_eur);
  if (!Number.isFinite(refundAmount) || refundAmount <= 0) {
    return { status: 400, body: { error: 'amountEur invalide' } };
  }
  if (refundAmount > Number(order.total_eur) + 0.01) {
    return { status: 400, body: { error: 'Montant refund supérieur au total commande' } };
  }

  const refund = await paypal.refundCapture(order.paypal_capture_id, {
    amountEur: refundAmount,
    reason: reason || 'admin_refund',
  });

  await db.query(
    `INSERT INTO order_status_history (order_id, status, note, changed_by)
     VALUES ($1, 'refunded', $2, $3)`,
    [order.id, `Refund PayPal ${refund.id || ''} — ${refundAmount} EUR`, adminUser?.id || null]
  );

  await db.query(
    `UPDATE orders SET payment_status = 'refunded', status = 'refunded' WHERE id = $1`,
    [order.id]
  );

  return {
    status: 200,
    body: {
      success: true,
      refund_id: refund.id,
      refund_status: refund.status,
    },
  };
}

module.exports = {
  createPaypalOrder,
  capturePaypalOrder,
  handlePaypalWebhookEvent,
  refundPaypalOrder,
};