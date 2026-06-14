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
const { triggerPurchasing } = require('./purchasing');
const { validate }          = require('../middleware/validate');
const { confirmPaymentCycle } = require('../services/order-payment-confirmation');
const { payments }          = require('../validators');
const {
  createStripeIntent,
  handleStripeSucceeded,
  handleStripePaymentFailed,
  markStripeEventProcessed,
} = require('../services/payment-stripe');

const log = require('../utils/logger').child({ module: 'payments' });

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
      return res.status(400).send(`Webhook Error: ${err.message}`);
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
// La logique cross-relais et cycle reste ici (périmètre limité, pas de service dédié R5).
router.post('/cash/confirm', authenticate, requireRole(['admin', 'agent_relais']), validate(payments.cashConfirm), async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const { cash_ref_code } = req.body;
    if (!cash_ref_code) return res.status(400).json({ error: 'cash_ref_code requis' });

    const { rows } = await client.query(
      `SELECT * FROM orders
       WHERE cash_ref_code = $1 AND payment_mode = 'cash_relais' AND payment_status = 'pending'`,
      [cash_ref_code]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Code invalide ou paiement déjà enregistré' });
    }

    const order = rows[0];

    // Cross-relais check
    if (req.user.role === 'agent_relais') {
      let agentRelaisId = null;
      let checkPossible = true;
      try {
        const { rows: [agent] } = await client.query(
          'SELECT relais_id FROM users WHERE id = $1', [req.user.id]
        );
        agentRelaisId = agent?.relais_id || null;
      } catch (e) {
        checkPossible = false;
        log.warn(`[CASH-CONFIRM] users.relais_id query failed: ${e.message}`);
      }

      if (!checkPossible || !agentRelaisId) {
        await client.query('ROLLBACK');
        db.query(
          `INSERT INTO alerts (level, source, message, payload) VALUES ('elevated', 'cash_confirm', $1, $2)`,
          [`agent_relais sans relais_id tente cash_confirm: user=${req.user.id}`,
           JSON.stringify({ order_reference: order.reference, user_id: req.user.id })]
        ).catch(() => {});
        return res.status(403).json({ error: 'Configuration agent incomplète — contactez un admin' });
      }

      if (String(agentRelaisId) !== String(order.relais_id)) {
        await client.query('ROLLBACK');
        log.warn(`[CASH-CONFIRM] ⛔ Cross-relais refusé — agent ${req.user.id} (relais ${agentRelaisId}) tentait commande ${order.reference} (relais ${order.relais_id})`);
        db.query(
          `INSERT INTO alerts (level, source, message, payload) VALUES ('elevated', 'cash_confirm', $1, $2)`,
          [`Cross-relais refusé: ${order.reference}`,
           JSON.stringify({ user_id: req.user.id, agent_relais_id: agentRelaisId, order_relais_id: order.relais_id, order_reference: order.reference })]
        ).catch(() => {});
        return res.status(403).json({ error: 'Cette commande appartient à un autre relais — vous ne pouvez pas la valider' });
      }
    }

    // Hub I-02
    const cycleResult = await confirmPaymentCycle({
      orderId:  order.id,
      actor:    { id: req.user.id, role: req.user.role },
      source:   'cash_confirm',
      dbClient: client,
    });

    if (!cycleResult.success && !cycleResult.noop) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: cycleResult.error });
    }
    if (cycleResult.stockBlocked) {
      await client.query('ROLLBACK');
      const first = cycleResult.insufficientItems[0];
      return res.status(409).json({
        error: `Stock insuffisant pour "${first.product_name}" — ${first.available} restant(s).`,
      });
    }

    await client.query(
      'UPDATE orders SET cash_paid_at = COALESCE(cash_paid_at, NOW()) WHERE id = $1', [order.id]
    );
    await client.query('COMMIT');

    res.json({
      message:   'Paiement espèces confirmé — commande validée',
      reference: order.reference,
      paid_at:   new Date().toISOString(),
      next_step: 'Sourcing déclenché automatiquement — bon de commande à l\'agent Dubai',
    });

    // Post-commit fire-and-forget
    try {
      const notifSvc = require('../services/notification-service');
      notifSvc.notifyPaymentConfirmed(order.id, order.reference)
        .catch(e => log.error({ err: e }, '[CASH-NOTIF] notification failed'));
      triggerPurchasing(order.id)
        .then(() => log.info({ order_reference: order.reference }, '[PURCHASING] Cash trigger OK'))
        .catch(e => log.error({ err: e, order_reference: order.reference }, '[PURCHASING] Cash trigger error'));
    } catch (e) {
      log.error({ err: e }, '[CASH-POSTCOMMIT] Non-fatal notification error');
    }

  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
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
