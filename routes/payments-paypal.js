/**
 * @komerce-arch
 * @role          route-payment-paypal
 * @domain        payment
 * @layer         route
 * @criticality   critical
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result
 * @depends       db.js, middleware/auth.js, middleware/auth-guest.js, services/paypal-client.js, services/payment-paypal.js
 * @used-by       bootstrap/api-routes.js
 * @db-read       orders
 * @db-write      (none)
 * @doctrine      route = auth + ownership + validate + appel service + réponse HTTP
 * @impact-areas  payment, checkout
 * @version       2026-06
 *
 * POST /api/payments/paypal/create-order           → createPaypalOrder
 * POST /api/payments/paypal/capture/:paypalOrderId → capturePaypalOrder
 * POST /api/payments/paypal/webhook                → handlePaypalWebhookEvent
 * POST /api/payments/paypal/refund/:orderId        → refundPaypalOrder
 */

'use strict';

const express = require('express');
const router  = express.Router();

const db               = require('../db');
const log              = require('../utils/logger').child({ module: 'payments-paypal' });
const { authenticate } = require('../middleware/auth');
const { authenticateOrCreateGuest: authGuest } = require('../middleware/auth-guest');
const paypal           = require('../services/paypal-client');
const {
  createPaypalOrder,
  capturePaypalOrder,
  handlePaypalWebhookEvent,
  refundPaypalOrder,
} = require('../services/payment-paypal');

// ─────────────────────────────────────────────────────────────────────────────
// 1. POST /api/payments/paypal/create-order
// ─────────────────────────────────────────────────────────────────────────────
router.post('/create-order', authGuest, async (req, res, next) => {
  const { order_reference, order_id } = req.body || {};
  if (!order_reference && !order_id) {
    return res.status(400).json({ error: 'order_reference ou order_id requis' });
  }

  try {
    const where = order_id ? 'id = $1' : 'reference = $1';
    const { rows } = await db.query(
      `SELECT id, reference, total_eur, payment_status, payment_mode, user_id, guest_token
         FROM orders WHERE ${where}`,
      [order_id || order_reference]
    );
    if (!rows.length) return res.status(404).json({ error: 'Commande introuvable' });

    const order = rows[0];

    // Ownership
    if (req.user?.id && order.user_id && order.user_id !== req.user.id) {
      log.warn({ order_id: order.id, requested_by: req.user.id },
        '[PAYPAL] tentative create-order sur commande d\'autrui');
      return res.status(403).json({ error: 'Accès refusé à cette commande' });
    }
    if (order.payment_status === 'paid') {
      return res.status(409).json({ error: 'Commande déjà payée' });
    }
    const amountEur = Number(order.total_eur);
    if (!amountEur || amountEur <= 0) {
      log.error({ order_id: order.id, total_eur: order.total_eur },
        '[PAYPAL] total_eur manquant ou invalide');
      return res.status(409).json({ error: 'Montant EUR non disponible pour cette commande' });
    }

    const result = await createPaypalOrder(order, paypal, db);
    return res.json(result);

  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. POST /api/payments/paypal/capture/:paypalOrderId
// ─────────────────────────────────────────────────────────────────────────────
router.post('/capture/:paypalOrderId', authGuest, async (req, res, next) => {
  const { paypalOrderId } = req.params;
  if (!paypalOrderId) return res.status(400).json({ error: 'paypalOrderId requis' });

  const { rows: [order] } = await db.query(
    `SELECT id, reference, total_eur, payment_status, user_id
       FROM orders WHERE paypal_order_id = $1`,
    [paypalOrderId]
  );
  if (!order) {
    log.warn({ paypal_order_id: paypalOrderId },
      '[PAYPAL] capture demandé pour paypal_order_id inconnu');
    return res.status(404).json({ error: 'Commande PayPal inconnue côté Komerce' });
  }
  if (req.user?.id && order.user_id && order.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Accès refusé' });
  }

  try {
    const result = await capturePaypalOrder(paypalOrderId, order, paypal, db);

    if (result.already_paid)         return res.json(result);
    if (result.capture_not_completed) return res.status(409).json({ error: 'Capture PayPal non-COMPLETED', status: result.status });
    if (result.amount_mismatch)      return res.status(409).json({ error: 'Montant capturé incohérent avec la commande — admin contacté', expected: result.expected, actual: result.actual });
    if (result.cycle_rejected)       return res.status(502).json({ error: 'Cycle paiement rejeté — admin contacté' });

    return res.json(result);

  } catch (err) {
    if (err._paypalCaptureFailed) {
      return res.status(502).json({ error: 'Échec capture PayPal', detail: err.message });
    }
    log.error({ err: err.message, stack: err.stack, order_id: order.id },
      '[PAYPAL] capture handler crashed');
    return next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. POST /api/payments/paypal/webhook
// ─────────────────────────────────────────────────────────────────────────────
router.post('/webhook', async (req, res) => {
  let rawBody = req.body;
  if (Buffer.isBuffer(rawBody)) rawBody = rawBody.toString('utf8');

  let event;
  try {
    event = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;
  } catch (e) {
    log.warn({ err: e.message }, '[PAYPAL-WEBHOOK] body non-JSON');
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  if (!event?.id || !event?.event_type) {
    log.warn('[PAYPAL-WEBHOOK] event mal formé');
    return res.status(400).json({ error: 'Event malformed' });
  }

  try {
    const result = await handlePaypalWebhookEvent(event, rawBody, req.headers, db, paypal);

    if (result.invalidSignature) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
    return res.json(result);

  } catch (err) {
    log.error({ err: err.message, event_id: event.id, event_type: event.event_type },
      '[PAYPAL-WEBHOOK] handler error');
    // 200 pour éviter le retry PayPal — l'event n'est pas marqué processed → rejouable
    return res.json({ received: true, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. POST /api/payments/paypal/refund/:orderId  (admin)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/refund/:orderId', authenticate, async (req, res, next) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin uniquement' });

  const { orderId } = req.params;
  const { amount_eur, reason } = req.body || {};

  try {
    const result = await refundPaypalOrder({
      orderId,
      amountEur:  amount_eur,
      reason,
      adminUser:  req.user,
      paypal,
      db,
    });
    return res.status(result.status).json(result.body);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
