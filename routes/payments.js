/**
 * KOMERCE — Routes paiement v8.1 (F24/F33) — F17/F18/F21
 *
 * POST /api/payments/stripe/intent    → créer un PaymentIntent Stripe (EUR)
 * POST /api/payments/stripe/webhook   → webhook Stripe (confirmation paiement)
 * POST /api/payments/cash/confirm     → agent relais confirme réception espèces
 * GET  /api/payments/rates            → taux de change actuels
 *
 * Changelog v7.6 :
 *   · triggerPurchasing() déclenché après paiement Stripe ET cash confirmé
 *   · Point d'entrée unique pour le sourcing — plus de déclenchement dans orders.js
 */

const express = require('express');
const router  = express.Router();
const stripe  = require('stripe')(process.env.STRIPE_SECRET_KEY);
const db      = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { sendSMS }  = require('../utils/sms');
const { getRates } = require('../utils/rates');
const { triggerPurchasing } = require('./purchasing'); // Sourcing semi-automatisé v7.6
const { validate } = require('../middleware/validate');
const { transitionOrderStatus } = require('../services/order-status-machine');
const { payments } = require('../validators');

// ── POST /api/payments/stripe/intent ─────────────────────────────────────────
// Crée un Stripe PaymentIntent pour une commande.
// Le client utilise le client_secret retourné pour finaliser le paiement côté front.
// Body : { order_reference }
router.post('/stripe/intent', authenticate, validate(payments.stripeIntent), async (req, res, next) => {
  try {
    const { order_reference } = req.body;
    if (!order_reference) return res.status(400).json({ error: 'order_reference requis' });

    const { rows } = await db.query(
      'SELECT * FROM orders WHERE reference = $1',
      [order_reference]
    );
    if (!rows.length) return res.status(404).json({ error: 'Commande introuvable' });

    const order = rows[0];

    if (order.payment_mode !== 'stripe_eur') {
      return res.status(400).json({ error: 'Cette commande n\'utilise pas Stripe' });
    }
    if (order.payment_status === 'paid') {
      return res.status(400).json({ error: 'Commande déjà payée' });
    }

    // Stripe travaille en centimes
    const amount_cents = Math.round(parseFloat(order.total_eur) * 100);

    const intent = await stripe.paymentIntents.create({
      amount:   amount_cents,
      currency: 'eur',
      metadata: {
        order_reference: order.reference,
        order_id:        order.id,
        komerce:         'true',
      },
      description: `Komerce — Commande ${order.reference}`,
    });

    // Stocker l'intent ID sur la commande
    await db.query(
      'UPDATE orders SET stripe_payment_id = $1 WHERE id = $2',
      [intent.id, order.id]
    );

    res.json({
      client_secret:   intent.client_secret,
      amount_eur:      order.total_eur,
      amount_cents,
      order_reference: order.reference,
    });

  } catch(err) { next(err); }
});

// ── POST /api/payments/stripe/webhook ────────────────────────────────────────
// Stripe appelle cette route automatiquement quand un paiement est confirmé.
// Vérifie la signature Stripe pour éviter les faux événements.
// Ce endpoint reçoit le body brut (raw) — configuré dans server.js
router.post('/stripe/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res, next) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error('⚠️ Webhook Stripe signature invalide :', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Paiement confirmé
    if (event.type === 'payment_intent.succeeded') {
      const intent = event.data.object;
      const { order_id, order_reference } = intent.metadata;

      // Idempotence check — skip if already processed
      const { rows: [existing] } = await db.query(
        'SELECT payment_status FROM orders WHERE id = $1', [order_id]
      );
      if (existing?.payment_status === 'paid') {
        console.log('Webhook already processed, skipping:', order_id);
        return res.json({ received: true });
      }

      const client = await db.pool.connect();
      try {
        await client.query('BEGIN');

        // Step 1: pending → confirmed (payment received)
        // State machine auto-sets payment_status = 'paid'
        const confirmResult = await transitionOrderStatus({
          orderId:  order_id,
          newStatus: 'confirmed',
          actor:    { id: null, role: 'system' },
          source:   'stripe_webhook',
          note:     'Paiement Stripe reçu',
          dbClient: client,
        });
        if (!confirmResult.success && !confirmResult.noop) {
          console.error('[STRIPE] Machine rejected confirm:', confirmResult.error);
          await client.query('ROLLBACK');
          client.release();
          return res.json({ received: true });
        }

        // Step 2: confirmed → ordered (auto-launch purchasing)
        const orderResult = await transitionOrderStatus({
          orderId:  order_id,
          newStatus: 'ordered',
          actor:    { id: null, role: 'system' },
          source:   'system',
          note:     'Commande lancée automatiquement après paiement Stripe',
          dbClient: client,
        });
        if (!orderResult.success && !orderResult.noop) {
          console.warn('[STRIPE] Machine rejected ordered (non-fatal):', orderResult.error);
          // Order stays confirmed — hub can manually advance
        }

        // F21 fix: Stock decrement — Stripe orders never decremented before!
        const { rows: stripeItems } = await client.query(
          `SELECT oi.product_id, oi.quantity FROM order_items oi
           JOIN products p ON p.id = oi.product_id
           WHERE oi.order_id = $1 AND p.stock IS NOT NULL
           FOR UPDATE OF p`,
          [order_id]
        );
        for (const si of stripeItems) {
          await client.query(
            'UPDATE products SET stock = stock - $1 WHERE id = $2',
            [si.quantity, si.product_id]
          );
        }

        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      // SMS confirmation — non bloquant
      const { rows: [order] } = await db.query(
        `SELECT o.*, u.phone AS user_phone
         FROM orders o LEFT JOIN users u ON u.id = o.user_id
         WHERE o.id = $1`,
        [order_id]
      );
      if (order?.user_phone) {
        sendSMS(
          order.user_phone,
          `Komerce · Paiement reçu pour la commande ${order_reference}. Votre commande est lancée — achat en cours à Dubai.`,
          'ordered', order_id
        ).catch(err => console.error('SMS webhook error:', err.message));
      }

      console.log(`✅ Paiement Stripe confirmé : ${order_reference}`);

      // ── NOTIFICATIONS COMPLÈTES — WhatsApp + Email + Facture (fire-and-forget) ──
      try {
        const notifSvc = require('../services/notification-service');
        notifSvc.notifyPaymentConfirmed(order_id, order_reference)
          .then(result => {
            if (result?.invoice) {
              console.log(`🧾 [STRIPE] Invoice ${result.invoice} sent for ${order_reference}`);
            }
          })
          .catch(e => console.error('[STRIPE-NOTIF] ❌', e.message));
      } catch(e) { console.error('[STRIPE-NOTIF] require error:', e.message); }

      // ── Sourcing semi-automatisé — déclenché après paiement Stripe ──────────
      triggerPurchasing(order_id)
        .then(r => console.log('[PURCHASING] Stripe trigger OK:', order_reference, r))
        .catch(e => console.error('[PURCHASING] Stripe trigger error:', order_reference, e.message));
    }

    // Paiement échoué
    if (event.type === 'payment_intent.payment_failed') {
      const intent = event.data.object;
      const { order_id } = intent.metadata;

      await db.query(
        `UPDATE orders SET payment_status = 'failed' WHERE id = $1`,
        [order_id]
      );
      console.log(`❌ Paiement Stripe échoué : ${intent.metadata.order_reference}`);
    }

    res.json({ received: true });
  }
);

// ── POST /api/payments/cash/confirm ──────────────────────────────────────────
// L'agent relais confirme la réception des espèces.
// C'est ICI que la commande est vraiment validée et le stock décrémenté.
// Body : { cash_ref_code }
router.post('/cash/confirm', authenticate, requireRole(['admin', 'agent_relais']), validate(payments.cashConfirm), async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const { cash_ref_code } = req.body;
    if (!cash_ref_code) return res.status(400).json({ error: 'cash_ref_code requis' });

    const { rows } = await client.query(
      `SELECT * FROM orders
       WHERE cash_ref_code = $1
         AND payment_mode = 'cash_relais'
         AND payment_status = 'pending'`,
      [cash_ref_code]
    );

    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Code invalide ou paiement déjà enregistré' });
    }

    const order = rows[0];

    // Step 1: pending → confirmed (payment received)
    // State machine auto-sets payment_status = 'paid'
    const confirmResult = await transitionOrderStatus({
      orderId:   order.id,
      newStatus: 'confirmed',
      actor:     { id: req.user.id, role: req.user.role },
      source:    'cash_confirm',
      note:      'Paiement espèces confirmé par agent relais',
      dbClient:  client,
    });
    if (!confirmResult.success && !confirmResult.noop) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: confirmResult.error });
    }

    // cash_paid_at — not managed by machine
    await client.query('UPDATE orders SET cash_paid_at = NOW() WHERE id = $1', [order.id]);

    // Step 2: confirmed → ordered (auto-launch purchasing)
    const orderResult = await transitionOrderStatus({
      orderId:   order.id,
      newStatus: 'ordered',
      actor:     { id: req.user.id, role: req.user.role },
      source:    'system',
      note:      'Commande lancée après paiement cash',
      dbClient:  client,
    });
    if (!orderResult.success && !orderResult.noop) {
      console.warn('[CASH] Machine rejected ordered (non-fatal):', orderResult.error);
    }

    // ── DÉCRÉMENTAGE STOCK — seul point pour cash relais (F19 fix) ───────────
    const { rows: items } = await client.query(
      'SELECT product_id, quantity FROM order_items WHERE order_id = $1',
      [order.id]
    );
    for (const item of items) {
      const { rows: prod } = await client.query(
        'SELECT stock, name FROM products WHERE id = $1 FOR UPDATE',
        [item.product_id]
      );
      if (prod[0] && prod[0].stock < item.quantity) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: `Stock insuffisant pour "${prod[0].name}" — ${prod[0].stock} restant(s). Annuler ou ajuster la commande.`,
        });
      }
      await client.query(
        'UPDATE products SET stock = stock - $1 WHERE id = $2',
        [item.quantity, item.product_id]
      );
    }

    await client.query('COMMIT');

    // ── Réponse IMMÉDIATE au user (transaction déjà committée) ──
    res.json({
      message:   'Paiement espèces confirmé — commande validée',
      reference: order.reference,
      paid_at:   new Date().toISOString(),
      next_step: 'Sourcing déclenché automatiquement — bon de commande à l\'agent Dubai',
    });

    // ── POST-COMMIT: Notifications crash-safe (fire-and-forget) ──
    // Un échec ici ne doit JAMAIS impacter la réponse utilisateur
    try {
      const { rows: [fullOrder] } = await db.query(
        `SELECT o.*, u.phone AS user_phone
         FROM orders o LEFT JOIN users u ON u.id = o.user_id
         WHERE o.id = $1`,
        [order.id]
      );
      if (fullOrder?.user_phone) {
        sendSMS(
          fullOrder.user_phone,
          `Komerce · Paiement reçu pour la commande ${order.reference} (${order.total_kmf.toLocaleString('fr-FR')} KMF). Votre commande est confirmée et en cours de préparation. Délai : 3 à 5 semaines.`,
          'confirmation', order.id
        ).catch(e => console.error('[CASH-SMS] ❌', e.message));
      }

      const notifSvc = require('../services/notification-service');
      notifSvc.notifyPaymentConfirmed(order.id, order.reference)
        .then(result => {
          if (result?.invoice) {
            console.log(`🧾 [CASH] Invoice ${result.invoice} sent for ${order.reference}`);
          }
        })
        .catch(e => console.error('[CASH-NOTIF] ❌', e.message));

      triggerPurchasing(order.id)
        .then(r => console.log('[PURCHASING] Cash trigger OK:', order.reference, r))
        .catch(e => console.error('[PURCHASING] Cash trigger error:', order.reference, e.message));
    } catch(e) {
      console.error('[CASH-POSTCOMMIT] ❌ Non-fatal notification error:', e.message);
    }

  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// ── GET /api/payments/rates ───────────────────────────────────────────────────
// Retourne les taux de change actuels (utilisés par le front pour la conversion)
router.get('/rates', async (req, res, next) => {
  try {
    const rates = await getRates();
    const { rows } = await db.query(
      'SELECT eur_kmf, aed_kmf, valid_from FROM exchange_rates ORDER BY valid_from DESC LIMIT 1'
    );
    res.json(rows[0] || rates);
  } catch(err) { next(err); }
});

// ── GET /api/payments/config ──────────────────────────────────────────────────
// Expose la clé publique Stripe au frontend (clé publique = safe to expose)
router.get('/config', (req, res) => {
  const key = process.env.STRIPE_PUBLISHABLE_KEY;
  if (!key) return res.status(500).json({ error: 'Stripe non configuré' });
  res.json({ publishable_key: key });
});

module.exports = router;
