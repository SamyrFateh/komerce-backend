/**
 * KOMERCE — Routes paiement v7.6
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

// ── POST /api/payments/stripe/intent ─────────────────────────────────────────
// Crée un Stripe PaymentIntent pour une commande.
// Le client utilise le client_secret retourné pour finaliser le paiement côté front.
// Body : { order_reference }
router.post('/stripe/intent', authenticate, async (req, res) => {
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

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur création PaymentIntent' });
  }
});

// ── POST /api/payments/stripe/webhook ────────────────────────────────────────
// Stripe appelle cette route automatiquement quand un paiement est confirmé.
// Vérifie la signature Stripe pour éviter les faux événements.
// Ce endpoint reçoit le body brut (raw) — configuré dans server.js
router.post('/stripe/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
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

      // Paiement confirmé → statut 'ordered' (spec §9.1 statut #1)
      // 'paid' est un statut interne de validation paiement,
      // 'ordered' est le statut opérationnel visible client.
      await db.query(
        `UPDATE orders SET
           payment_status = 'paid',
           status         = 'ordered',
           ordered_at     = NOW()
         WHERE id = $1`,
        [order_id]
      );

      await db.query(
        `INSERT INTO order_status_history (order_id, status, note)
         VALUES ($1,'ordered','Paiement Stripe confirmé — commande lancée')`,
        [order_id]
      );

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
router.post('/cash/confirm', authenticate, requireRole(['admin', 'agent_relais']), async (req, res) => {
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

    // Paiement espèces confirmé → statut 'ordered' (spec §9.1 statut #1)
    await client.query(
      `UPDATE orders SET
         payment_status = 'paid',
         status         = 'ordered',
         ordered_at     = NOW(),
         cash_paid_at   = NOW()
       WHERE id = $1`,
      [order.id]
    );

    // ── DÉCRÉMENTAGE STOCK — uniquement ici pour le cash relais ──────────────
    // Le stock n'est réservé qu'à partir du paiement réel, pas à la création
    const { rows: items } = await client.query(
      'SELECT product_id, quantity FROM order_items WHERE order_id = $1',
      [order.id]
    );
    for (const item of items) {
      // Vérifier le stock une dernière fois avant de décrémenter
      const { rows: prod } = await client.query(
        'SELECT stock, name FROM products WHERE id = $1',
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

    await client.query(
      `INSERT INTO order_status_history (order_id, status, changed_by, note)
       VALUES ($1,'ordered',$2,'Paiement espèces confirmé par agent relais — commande lancée')`,
      [order.id, req.user.id]
    );

    await client.query('COMMIT');

    // SMS au commanditaire
    const { rows: [fullOrder] } = await db.query(
      `SELECT o.*, u.phone AS user_phone
       FROM orders o LEFT JOIN users u ON u.id = o.user_id
       WHERE o.id = $1`,
      [order.id]
    );
    if (fullOrder?.user_phone) {
      await sendSMS(
        fullOrder.user_phone,
        `Komerce · Paiement reçu pour la commande ${order.reference} (${order.total_kmf.toLocaleString('fr-FR')} KMF). Votre commande est confirmée et en cours de préparation. Délai : 3 à 5 semaines.`,
        'confirmation', order.id
      );
    }


    // ── Sourcing semi-automatisé — déclenché après paiement cash ──────────────
    triggerPurchasing(order.id)
      .then(r => console.log('[PURCHASING] Cash trigger OK:', order.reference, r))
      .catch(e => console.error('[PURCHASING] Cash trigger error:', order.reference, e.message));

    res.json({
      message:   'Paiement espèces confirmé — commande validée',
      reference: order.reference,
      paid_at:   new Date().toISOString(),
      next_step: 'Sourcing déclenché automatiquement — bon de commande à l\'agent Dubai',
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Erreur confirmation paiement cash' });
  } finally {
    client.release();
  }
});

// ── GET /api/payments/rates ───────────────────────────────────────────────────
// Retourne les taux de change actuels (utilisés par le front pour la conversion)
router.get('/rates', async (req, res) => {
  try {
    const rates = await getRates();
    const { rows } = await db.query(
      'SELECT eur_kmf, aed_kmf, valid_from FROM exchange_rates ORDER BY valid_from DESC LIMIT 1'
    );
    res.json(rows[0] || rates);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
