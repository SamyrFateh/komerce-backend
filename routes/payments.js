/**
 * @komerce-arch
 * @role          payment-http-facade
 * @domain        payment
 * @layer         route
 * @criticality   critical
 * @inputs        order_reference, stripe_webhook, cash_ref_code
 * @outputs       stripe_intent, payment_confirmation, rates_config
 * @depends       services/payment-stripe.js, services/payment-cash-confirm.js, routes/purchasing.js, utils/rates.js, validators.js
 * @used-by       bootstrap/api-routes.js, public/boutique/js/b-checkout.js
 * @db-read       orders, stripe_events_processed
 * @db-write      none
 * @db-txn        raw_body_preserved, mutation_delegated_to_payment_services
 * @doctrine      raw_body_webhook_intact, idempotence_stripe, payment_to_stock_single_entry
 * @impact-areas  checkout, orders, stock, cash, sourcing, notifications
 * @version       2026-06
 */

/**
 * KOMERCE — routes/payments.js  (R5)
 *
 * Façade pure : auth + validate + appel service + réponse HTTP.
 * Toute logique métier Stripe déléguée à services/payment-stripe.js.
 *
 * POST /api/payments/stripe/intent    → createStripeIntent
 * POST /api/payments/stripe/webhook   → handleStripeSucceeded / handleStripePaymentFailed
 * POST /api/payments/cash/confirm     → inline (cash_ref_code, cross-relais check, cycle)
 * GET  /api/payments/rates            → inline (lecture seule)
 * GET  /api/payments/config           → inline (lecture seule)
 */

'use strict';

const express = require('express');
const router  = express.Router();
const stripe  = require('stripe')(process.env.STRIPE_SECRET_KEY);
const db      = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { getRates }          = require('../utils/rates');
// O7.2 (Cycle B) : importait auparavant './purchasing' (routes/purchasing.js,
// une route — pas une boundary de feature) pour son ré-export de
// compatibilité. triggerPurchasing est un vrai service purchasing — on le
// prend directement. Voir docs/O7_2_CYCLE_ANALYSIS.md, Cycle B.
const { triggerPurchasing } = require('../services/purchasing-trigger-service');
const { validate }          = require('../middleware/validate');
const { confirmCashByReference } = require('../services/payment-cash-confirm');
const { payments }          = require('../validators');
const {
  createStripeIntent,
  handleStripeSucceeded,
  handleStripePaymentFailed,
  markStripeEventProcessed,
} = require('../services/payment-stripe');

const log = require('../utils/logger').child({ module: 'payments' });
const monitor = require('../services/monitoring'); // F4 — trace les webhooks Stripe en échec (module 'stripe_webhook')

// ── POST /api/payments/stripe/intent ─────────────────────────────────────────
router.post('/stripe/intent', authenticate, validate(payments.stripeIntent), async (req, res, next) => {
  try {
    const { order_reference } = req.body;
    if (!order_reference) return res.status(400).json({ error: 'order_reference requis' });

    const { rows } = await db.query('SELECT * FROM orders WHERE reference = $1', [order_reference]);
    if (!rows.length) return res.status(404).json({ error: 'Commande introuvable' });

    const order = rows[0];
    const privilegedRoles = ['admin', 'agent_hub', 'agent_relais'];
    if (!privilegedRoles.includes(req.user.role) && String(order.user_id) !== String(req.user.id)) {
      return res.status(403).json({ error: 'Acces refuse a cette commande' });
    }
    if (order.payment_mode !== 'stripe_eur') {
      return res.status(400).json({ error: 'Cette commande n\'utilise pas Stripe' });
    }
    if (order.payment_status === 'paid') {
      return res.status(400).json({ error: 'Commande déjà payée' });
    }

    const result = await createStripeIntent(order, stripe, db);
    return res.json(result);
  } catch (err) { next(err); }
});

// ── POST /api/payments/stripe/webhook ────────────────────────────────────────
router.post('/stripe/webhook',
  express.raw({ type: 'application/json' }),  // I-07 : raw body AVANT express.json — NE PAS DÉPLACER
  async (req, res, next) => {
    const sig = req.headers['stripe-signature'];
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      log.error({ err }, 'Webhook Stripe signature invalide');
      monitor.trackError(err, { module: 'stripe_webhook', context: 'signature_invalid' });
      return res.status(400).send('Webhook signature invalid');
    }

    // Idempotence forte dès l'entrée (I-07)
    try {
      const seen = await db.query(
        'SELECT 1 FROM stripe_events_processed WHERE stripe_event_id = $1', [event.id]
      );
      if (seen.rows.length) return res.json({ received: true, idempotent: true });
    } catch (e) {
      log.warn({ err: e }, '[STRIPE-WEBHOOK] stripe_events_processed unavailable');
    }

    try {
      if (event.type === 'payment_intent.succeeded') {
        const result = await handleStripeSucceeded(event, event.data.object, db, triggerPurchasing);
        return res.json(result);
      }
      if (event.type === 'payment_intent.payment_failed') {
        await handleStripePaymentFailed(event, event.data.object, db);
      }
      return res.json({ received: true });
    } catch (err) {
      next(err);
    }
  }
);

// ── POST /api/payments/cash/confirm ──────────────────────────────────────────
// Confirmation cash par code de référence (≠ route /api/cash/collect qui utilise orderId).
router.post('/cash/confirm', authenticate, requireRole(['admin', 'agent_relais']), validate(payments.cashConfirm), async (req, res, next) => {
  try {
    const result = await confirmCashByReference({
      cashRefCode: req.body.cash_ref_code,
      actor:       { id: req.user.id, role: req.user.role },
      triggerPurchasing,
      db,
    });
    return res.status(result.status).json(result.body);
  } catch (err) { next(err); }
});

// ── GET /api/payments/rates ───────────────────────────────────────────────────
router.get('/rates', authenticate, async (req, res, next) => {
  try {
    const rates = await getRates();
    res.json({ eur_kmf: rates.eur_kmf, aed_kmf: rates.aed_kmf, source: 'finance_config' });
  } catch (err) { next(err); }
});

// ── GET /api/payments/config ──────────────────────────────────────────────────
router.get('/config', (req, res) => {
  const key = process.env.STRIPE_PUBLISHABLE_KEY;
  if (!key) return res.status(500).json({ error: 'Stripe non configuré' });
  res.json({ publishable_key: key });
});

module.exports = router;
