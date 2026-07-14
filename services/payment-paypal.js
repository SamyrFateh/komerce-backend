/**
 * @komerce-arch
 * @role          payment-paypal
 * @domain        payment
 * @layer         service
 * @criticality   critical
 * @inputs        order, paypal_client, db, webhook_event
 * @outputs       capture_result, refund_result, side_effects
 * @depends       db.js, services/paypal-client.js, services/order-payment-confirmation.js, services/documents/refund-receipt.js, routes/pickup-secret.js
 * @used-by       routes/payments-paypal.js
 * @db-read       orders, paypal_events_processed
 * @db-write      alerts, orders, paypal_events_processed
 * @db-write-via:refund-service refunds
 * @db-write-via:order-status-machine order_status_history
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  payment, checkout
 * @version       2026-06
 */

'use strict';

const refundReceiptService = require('./documents/refund-receipt');

/**
 * KOMERCE — services/payment-paypal.js  (R5)
 *
 * Logique métier PayPal extraite de routes/payments-paypal.js.
 * La route reste une façade : auth + ownership + validate + appel service + réponse.
 *
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  Invariants respectés                                               ║
 * ║  I-01 : toute transition passe par order-status-machine            ║
 * ║  I-02 : confirmPaymentCycle = seul point d'entrée paiement→stock   ║
 * ║  I-07 : idempotence PayPal via paypal_events_processed             ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * Exports :
 *   createPaypalOrder(order, paypal, db)
 *   capturePaypalOrder(paypalOrderId, order, paypal, db)
 *   handlePaypalWebhookEvent(event, rawBody, headers, db, paypal)
 *   markPaypalEventProcessed(event, status, payloadSummary, db)
 */

const { confirmPaymentCycle }    = require('./order-payment-confirmation');
const { markRefunded }           = require('./payment-service');
const { recordExternalRefund }   = require('./refund-service');
const { appendOrderHistoryNote, transitionOrderStatus } = require('./order-status-machine');
// O7.2 (Cycle B) : importait auparavant routes/pickup-secret.js (une route,
// pas une boundary de feature). Voir docs/O7_2_CYCLE_ANALYSIS.md, Cycle B.
const { generateAndStoreSecret, cacheCodeForReveal } = require('./pickup-secret-service');
const { createAlert } = require('../utils/alerts');
const log = require('../utils/logger').child({ module: 'payment-paypal' });

// ─── createPaypalOrder ────────────────────────────────────────────────────────
/**
 * Crée une PayPal Order pour une commande Komerce.
 * NE touche pas payment_status — c'est le cycle capture qui le fera.
 *
 * @param {object} order   — ligne orders avec { id, reference, total_eur }
 * @param {object} paypal  — instance paypal-client
 * @param {object} db      — module db (pool)
 * @returns {{ paypal_order_id, status }}
 * @throws si PayPal ou DB échoue
 */
async function createPaypalOrder(order, paypal, db) {
  const amountEur = Number(order.total_eur);

  const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `https://${process.env.HOST || 'komerce.fr'}`;

  const ppOrder = await paypal.createOrder({
    amountEur,
    reference:   order.reference,
    description: `Komerce — Commande ${order.reference}`,
    applicationContext: {
      brand_name:          'Komerce',
      locale:              'fr-FR',
      landing_page:        'BILLING',
      shipping_preference: 'NO_SHIPPING',
      user_action:         'PAY_NOW',
      return_url:          `${PUBLIC_BASE_URL}/boutique/?paypal=return`,
      cancel_url:          `${PUBLIC_BASE_URL}/boutique/?paypal=cancel`,
    },
  });

  await db.query(
    'UPDATE orders SET paypal_order_id = $1 WHERE id = $2',
    [ppOrder.id, order.id]
  );

  log.info({ order_id: order.id, paypal_order_id: ppOrder.id, amount_eur: amountEur },
    '[PAYPAL] order créée');

  return { paypal_order_id: ppOrder.id, status: ppOrder.status };
}

// ─── capturePaypalOrder ───────────────────────────────────────────────────────
/**
 * Capture une PayPal Order et déclenche le cycle paiement→stock.
 *
 * Chemins de sortie :
 *   { already_paid }       — idempotence, déjà payé avant capture
 *   { amount_mismatch }    — tampering détecté, alerte critique insérée
 *   { cycle_rejected }     — confirmPaymentCycle rejeté, alerte critique insérée
 *   { success, ... }       — nominal ou stock_blocked
 *
 * @param {string} paypalOrderId
 * @param {object} order    — ligne orders avec { id, reference, total_eur, payment_status }
 * @param {object} paypal   — instance paypal-client
 * @param {object} db       — module db (pool)
 * @returns {object} payload de réponse (la route construit le statut HTTP)
 */
async function capturePaypalOrder(paypalOrderId, order, paypal, db) {
  // Idempotence pré-capture
  if (order.payment_status === 'paid') {
    return { already_paid: true, order_id: order.id, order_reference: order.reference };
  }

  // Capture côté PayPal
  let captureResult;
  try {
    captureResult = await paypal.captureOrder(paypalOrderId);
  } catch (err) {
    log.error({ err: err.message, paypal_order_id: paypalOrderId }, '[PAYPAL] capture failed');
    throw Object.assign(err, { _paypalCaptureFailed: true });
  }

  const info = paypal.extractCaptureInfo(captureResult);
  if (!info || info.status !== 'COMPLETED') {
    log.warn({ captureResult }, '[PAYPAL] capture non-COMPLETED');
    return { capture_not_completed: true, status: info?.status || 'unknown' };
  }

  // Validation montant anti-tampering (tolérance 1 centime)
  const expectedEur = Number(order.total_eur);
  const actualEur   = info.amount_value;
  if (Math.abs(expectedEur - actualEur) > 0.01) {
    log.error({ order_id: order.id, expected: expectedEur, actual: actualEur,
      capture_id: info.paypal_capture_id }, '[PAYPAL] MISMATCH montant — capture rejetée');
    try {
      await createAlert(db, {
        type: 'paypal_amount_mismatch',
        entityType: 'order',
        entityId: order.id,
        severity: 'high',
        title: `Montant PayPal ne correspond pas — ${order.reference}`,
        description: `Attendu ${expectedEur} EUR, reçu ${actualEur} EUR ` +
          `(capture ${info.paypal_capture_id}, order PayPal ${paypalOrderId}).`,
      });
    } catch (e) { log.error({ err: e.message }, '[PAYPAL] alert insert failed'); }
    return { amount_mismatch: true, expected: expectedEur, actual: actualEur };
  }

  // Transaction : cycle paiement + persistance infos PayPal + code retrait
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // Hub I-02
    const cycleResult = await confirmPaymentCycle({
      orderId:  order.id,
      actor:    { id: null, role: 'system' },
      source:   'paypal_capture',
      dbClient: client,
      note:     `Paiement PayPal reçu (capture ${info.paypal_capture_id})`,
    });

    // Noop : race condition avec webhook
    if (cycleResult.noop) {
      await client.query(
        `UPDATE orders SET
           paypal_capture_id    = COALESCE(paypal_capture_id, $1),
           paypal_payer_email   = COALESCE(paypal_payer_email, $2),
           paypal_payer_id      = COALESCE(paypal_payer_id, $3),
           paypal_pay_in_4_used = $4
         WHERE id = $5`,
        [info.paypal_capture_id, info.payer_email, info.payer_id, info.pay_in_4, order.id]
      );
      await client.query('COMMIT');
      return { already_paid: true, order_id: order.id, order_reference: order.reference };
    }

    // Cycle rejeté : argent encaissé mais transition impossible → alerte critique
    if (!cycleResult.success) {
      log.error({ cycle_error: cycleResult.error, order_id: order.id }, '[PAYPAL] cycle rejected');
      await client.query('ROLLBACK');
      try {
        await createAlert(db, {
          type: 'paypal_paid_but_cycle_failed',
          entityType: 'order',
          entityId: order.id,
          severity: 'high',
          title: `PayPal encaissé mais cycle rejeté — ${order.reference}`,
          description: `cycle_error=${cycleResult.error} capture=${info.paypal_capture_id}`,
        });
      } catch (e) { log.error({ err: e.message }, '[PAYPAL] alert insert failed (cycle_rejected)'); }
      return { cycle_rejected: true, error: cycleResult.error };
    }

    // Stock bloqué : COMMIT + alerte
    let stockBlocked = false;
    if (cycleResult.stockBlocked) {
      stockBlocked = true;
      const items = cycleResult.insufficientItems;
      const note  = '\n[INCIDENT paid_but_stock_blocked] ' +
        items.map(i => `${i.product_name}: dispo=${i.available}, besoin=${i.needed}`).join('; ');
      await client.query(
        `UPDATE orders SET notes = COALESCE(notes, '') || $1 WHERE id = $2`, [note, order.id]
      );
      // SAVEPOINT dédié (même doctrine que P0-A) : la persistance de l'alerte
      // ne doit jamais empoisonner le client transactionnel dont dépendent
      // les queries suivantes (UPDATE orders infos PayPal, pickup secret, COMMIT).
      try {
        await client.query('SAVEPOINT alert_stock_blocked');
        await createAlert(client, {
          type: 'paid_but_stock_blocked',
          entityType: 'order',
          entityId: order.id,
          severity: 'high',
          title: `Paiement PayPal encaissé mais stock bloqué — ${order.reference}`,
          description: `Capture ${info.paypal_capture_id} : ` +
            items.map(i => `${i.product_name} dispo=${i.available} besoin=${i.needed}`).join('; '),
        });
        await client.query('RELEASE SAVEPOINT alert_stock_blocked');
      } catch (e) {
        await client.query('ROLLBACK TO SAVEPOINT alert_stock_blocked').catch(() => {});
        log.error({ err: e.message }, '[PAYPAL] alert insert failed (stockBlocked)');
      }
    }

    // Persister infos PayPal
    await client.query(
      `UPDATE orders SET
         paypal_capture_id    = $1,
         paypal_payer_email   = $2,
         paypal_payer_id      = $3,
         paypal_pay_in_4_used = $4,
         payment_mode         = COALESCE(payment_mode, 'paypal_eur'::payment_mode)
       WHERE id = $5`,
      [info.paypal_capture_id, info.payer_email, info.payer_id, info.pay_in_4, order.id]
    );

    // Code secret retrait
    const { rows: [orderRow] } = await client.query(
      'SELECT relais_id FROM orders WHERE id = $1', [order.id]
    );
    let pickupCode = null;
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

    // Post-commit : hooks métier (parity Stripe — LOY-01 + NOTIF + INVOICE + PURCHASING)
    // Déclenché uniquement si le cycle a réellement progressé (pas noop, pas stockBlocked seul)
    if (!stockBlocked) {
      try {
        const loyaltyService = require('./loyalty-service');
        loyaltyService.handleOrderConfirmed({ orderId: order.id })
          .then(r => { if (r && !r.skipped) log.info({ orderId: order.id }, '[PAYPAL] loyalty hook OK:', r); })
          .catch(e => log.warn({ err: e }, '[PAYPAL] loyalty hook error'));
      } catch (_) { /* non-bloquant */ }

      try {
        const notifSvc = require('./notification-service');
        notifSvc.notifyPaymentConfirmed(order.id, order.reference)
          .catch(e => log.error({ err: e }, '[PAYPAL] notif payment-confirmed failed'));
        require('./invoice-service').sendInvoiceReadyNotification(order.id, order.reference)
          .catch(e => log.error({ err: e }, '[PAYPAL] invoice-ready notif failed'));
      } catch (e) { log.error({ err: e }, '[PAYPAL] notif require error'); }

      try {
        const { triggerPurchasing } = require('./purchasing-trigger-service');
        triggerPurchasing(order.id)
          .then(() => log.info({ order_reference: order.reference }, '[PAYPAL] purchasing trigger OK'))
          .catch(async (e) => {
            log.error({ err: e, order_reference: order.reference }, '[PAYPAL] purchasing trigger error');
            try {
              await createAlert(db, {
                type: 'purchasing_trigger_failed', entityType: 'order', entityId: order.id,
                severity: 'medium',
                title: `triggerPurchasing failed (PayPal) — ${order.reference}`,
                description: `capture ${info.paypal_capture_id} : ${e.message}`,
              });
            } catch (_) {}
          });
      } catch (e) { log.error({ err: e }, '[PAYPAL] purchasing require error'); }
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

    // Code secret retrait — parity avec capturePaypalOrder (webhook = seul chemin si capture HTTP échouée)
    let webhookPickupCode = null;
    const hasSecretRow = await client.query('SELECT pickup_secret_hash FROM orders WHERE id = $1', [order.id]);
    if (!hasSecretRow.rows[0]?.pickup_secret_hash) {
      try {
        const { rows: [oRow] } = await client.query('SELECT relais_id FROM orders WHERE id = $1', [order.id]);
        const genResult = await generateAndStoreSecret({
          orderId: order.id, relaisId: oRow?.relais_id || null,
          channel: 'paypal_webhook', dbClient: client,
        });
        webhookPickupCode = genResult.code;
      } catch (genErr) {
        log.error({ err: genErr.message, order_id: order.id }, '[PAYPAL-WEBHOOK] génération code retrait échouée — non-bloquant');
      }
    }

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

    // Post-commit : hooks métier (parity Stripe — LOY-01 + NOTIF + INVOICE + PURCHASING)
    if (!cycleResult.stockBlocked) {
      try {
        const loyaltyService = require('./loyalty-service');
        loyaltyService.handleOrderConfirmed({ orderId: order.id })
          .catch(e => log.warn({ err: e }, '[PAYPAL-WEBHOOK] loyalty hook error'));
      } catch (_) {}
      try {
        const notifSvc = require('./notification-service');
        notifSvc.notifyPaymentConfirmed(order.id, order.reference)
          .catch(e => log.error({ err: e }, '[PAYPAL-WEBHOOK] notif failed'));
        require('./invoice-service').sendInvoiceReadyNotification(order.id, order.reference)
          .catch(e => log.error({ err: e }, '[PAYPAL-WEBHOOK] invoice-ready notif failed'));
      } catch (e) { log.error({ err: e }, '[PAYPAL-WEBHOOK] notif require error'); }
      try {
        const { triggerPurchasing } = require('./purchasing-trigger-service');
        triggerPurchasing(order.id)
          .catch(e => log.error({ err: e, order_reference: order.reference }, '[PAYPAL-WEBHOOK] purchasing trigger error'));
      } catch (e) { log.error({ err: e }, '[PAYPAL-WEBHOOK] purchasing require error'); }
    }

    if (webhookPickupCode) {
      cacheCodeForReveal(order.id, webhookPickupCode)
        .catch(e => log.error({ err: e.message }, '[PAYPAL-WEBHOOK] cacheCodeForReveal failed'));
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
    await createAlert(db, {
      type: 'paypal_capture_denied',
      entityType: 'paypal_webhook',
      severity: 'medium',
      title: `paypal_capture_denied — ${info?.reference_id || event.id}`,
      description: `event_id=${event.id} capture_info=${JSON.stringify(info)}`,
    });
  } catch (_e) { /* non-bloquant */ }
  await markPaypalEventProcessed(event, 'processed', { reason: 'denied_logged' }, db);
}

async function _handleCaptureRefunded(event, db) {
  log.info({ event_id: event.id }, '[PAYPAL-WEBHOOK] capture REFUNDED — info enregistrée');
  await markPaypalEventProcessed(event, 'processed', { reason: 'refund_acknowledged' }, db);
}

async function _handleDispute(event, db) {
  log.warn({ event_id: event.id, event_type: event.event_type },
    '[PAYPAL-WEBHOOK] litige reçu');
  try {
    const r = event.resource || {};
    await createAlert(db, {
      type: 'paypal_dispute',
      entityType: 'paypal_dispute',
      severity: 'high',
      title: `paypal_dispute — ${r.dispute_id || event.id}`,
      description: `event_id=${event.id} state=${r.dispute_state} reason=${r.reason} ` +
        `amount=${JSON.stringify(r.dispute_amount)} transactions=${JSON.stringify(r.disputed_transactions)}`,
    });
  } catch (e) {
    log.error({ err: e.message }, '[PAYPAL-WEBHOOK] dispute alert insert failed');
  }
  await markPaypalEventProcessed(event, 'processed', { dispute_alert_created: true }, db);
}

// ─── markPaypalEventProcessed ─────────────────────────────────────────────────
/**
 * Marque un event PayPal traité. Hors transaction principale.
 * Erreur loggée mais non bloquante.
 */
async function markPaypalEventProcessed(event, status, payloadSummary, db) {
  try {
    await db.query(
      `INSERT INTO paypal_events_processed (event_id, event_type, payload_summary, status)
       VALUES ($1, $2, $3, $4) ON CONFLICT (event_id) DO NOTHING`,
      [event.id, event.event_type, JSON.stringify(payloadSummary || {}), status]
    );
  } catch (e) {
    log.warn({ err: e, event_id: event.id }, '[PAYPAL-WEBHOOK] markPaypalEventProcessed failed');
  }
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

  let refund;
  try {
    refund = await paypal.refundCapture(order.paypal_capture_id, {
      amountEur: refundAmount,
      reason:    reason || 'admin_refund',
    });
  } catch (err) {
    log.error({ err: err.message, order_id: order.id, capture_id: order.paypal_capture_id }, '[PAYPAL] refundCapture failed');
    return { status: 502, body: { error: 'Échec refund PayPal', detail: err.message } };
  }

  const totalKmf     = Number(order.total_kmf || 0);
  const totalEur     = Number(order.total_eur || 0);
  const isFullRefund = Math.abs(refundAmount - totalEur) < 0.01;
  const amountKmf    = isFullRefund
    ? totalKmf
    : (totalEur > 0 ? Math.round(refundAmount * totalKmf / totalEur) : 0);
  const refundType   = isFullRefund ? 'full' : 'partial';

  const refundRowId = await recordExternalRefund(db, {
    orderId:          order.id,
    amountKmf,
    amountEur:        refundAmount,
    refundType,
    method:           'paypal',
    externalRefundId: refund.id || null,
    reason:           reason || 'admin_refund',
    initiatedBy:      adminUser?.id || null,
    conflictOn:       'any',
  });

  await appendOrderHistoryNote(db, order.id, 'refunded',
    `Refund PayPal ${refund.id || ''} — ${refundAmount} EUR`,
    adminUser?.id || null);

  await markRefunded(order.id, { client: db });

  // I-BACK-3 : le remboursement PayPal est DÉJÀ effectué (capture.refund ci-dessus).
  // La transition status → refunded passe par la machine avec source='refund_external'
  // qui autorise * → refunded (l'argent est parti, bloquer = incohérence).
  await transitionOrderStatus({
    orderId: order.id,
    newStatus: 'refunded',
    actor: { id: adminUser?.id || null, role: 'admin' },
    source: 'refund_external',
    note: `Refund PayPal ${refund.id || ''} — ${refundAmount} EUR`,
    dbClient: db,
  });

  if (refundRowId) {
    refundReceiptService.issue(refundRowId, { issuedBy: adminUser?.id }).catch(err => {
      log.warn({ err, order_id: order.id }, '[payment-paypal] reçu remboursement échoué (non-fatal)');
    });
  }

  return {
    status: 200,
    body: { success: true, refund_id: refund.id, refund_status: refund.status },
  };
}

module.exports = {
  createPaypalOrder,
  capturePaypalOrder,
  handlePaypalWebhookEvent,
  markPaypalEventProcessed,
  refundPaypalOrder,
};
