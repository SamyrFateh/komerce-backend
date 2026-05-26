/**
 * KOMERCE — Routes paiement v8.2 (REFACTO-PAYMENTS)
 *
 * POST /api/payments/stripe/intent    → créer un PaymentIntent Stripe (EUR)
 * POST /api/payments/stripe/webhook   → webhook Stripe (confirmation paiement)
 * POST /api/payments/cash/confirm     → agent relais confirme réception espèces
 * GET  /api/payments/rates            → taux de change actuels
 *
 * Changelog v8.2 (REFACTO-PAYMENTS) :
 *   · _handleStripeSucceeded() extraite — handler webhook < 30 lignes
 *   · _handleStripePaymentFailed() extraite — 12 lignes isolation
 *   · Logique métier inchangée — déplacement pur
 */

'use strict';

const express = require('express');
const router  = express.Router();
const stripe  = require('stripe')(process.env.STRIPE_SECRET_KEY);
const db      = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { sendSMS }  = require('../utils/sms');
const { getRates } = require('../utils/rates');
const { triggerPurchasing } = require('./purchasing'); // Sourcing semi-automatisé v7.6
const { validate } = require('../middleware/validate');
const { transitionOrderStatus } = require('../services/order-status-machine'); // conservé (utilisé indirectement via confirmPaymentCycle)
const { confirmPaymentCycle }    = require('../services/order-payment-confirmation'); // LOT 1
const { payments } = require('../validators');

// Western Union model : émission du code secret au moment du paiement Stripe
const { generateAndStoreSecret, cacheCodeForReveal } = require('./pickup-secret');
const log = require('../utils/logger').child({ module: 'payments' });

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

    // A-BE-11 (2026-05-26) — Idempotence PaymentIntent.
    // Si un intent existe déjà pour cette commande, on le réutilise.
    // Évite la création de multiples intents sur double-clic ou retry réseau.
    if (order.stripe_payment_id) {
      try {
        const existing = await stripe.paymentIntents.retrieve(order.stripe_payment_id);
        // Réutiliser uniquement si l'intent n'est pas dans un état terminal
        const REUSABLE_STATES = ['requires_payment_method', 'requires_confirmation', 'requires_action'];
        if (REUSABLE_STATES.includes(existing.status)) {
          log.info(`[PAYMENTS] PaymentIntent existant réutilisé : ${existing.id} (status: ${existing.status})`);
          return res.json({
            client_secret:   existing.client_secret,
            amount_eur:      order.total_eur,
            amount_cents:    existing.amount,
            order_reference: order.reference,
          });
        }
        // Sinon (succeeded, canceled…) on crée un nouvel intent ci-dessous
        log.warn(`[PAYMENTS] PaymentIntent ${existing.id} dans état non réutilisable (${existing.status}) — nouvel intent créé`);
      } catch (retrieveErr) {
        // Intent introuvable chez Stripe (supprimé, mauvaise clé…) → on recrée
        log.warn({ err: retrieveErr }, `[PAYMENTS] Échec retrieve PaymentIntent ${order.stripe_payment_id} — nouvel intent créé`);
      }
    }

    // Stripe travaille en centimes
    const amount_cents = Math.round(parseFloat(order.total_eur) * 100);

    // Idempotency key stable : garantit qu'un double appel simultané crée un seul intent
    const idempotencyKey = `order_pi_${order.id}`;

    const intent = await stripe.paymentIntents.create({
      amount:   amount_cents,
      currency: 'eur',
      metadata: {
        order_reference: order.reference,
        order_id:        order.id,
        komerce:         'true',
      },
      description: `Komerce — Commande ${order.reference}`,
    }, { idempotencyKey });

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
//
// PATCH P0 (sprint 1) — durcissement :
//   1. Idempotence forte via stripe_events_processed (event.id) en TÊTE
//   2. Ignorer proprement les PaymentIntents sans metadata order_id
//   3. Si transition noop -> commit + return immédiat (pas de side-effects)
//   4. Stock guarded : SELECT FOR UPDATE + check stock>=quantity
//   5. Si stock insuffisant -> alerte 'paid_but_stock_blocked' + pas de purchasing
//   6. payment_failed limité à payment_status='pending'
//   7. triggerPurchasing seulement si tout est nominal + alerte si erreur
router.post('/stripe/webhook',
  express.raw({ type: 'application/json' }),  // I-07 : raw body AVANT express.json — NE PAS DÉPLACER
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
      log.error({ err }, 'Webhook Stripe signature invalide');
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // ── 0. IDEMPOTENCE FORTE — DÈS L'ENTRÉE ────────────────────────────────
    try {
      const seen = await db.query(
        'SELECT 1 FROM stripe_events_processed WHERE stripe_event_id = $1',
        [event.id]
      );
      if (seen.rows.length) {
        return res.json({ received: true, idempotent: true });
      }
    } catch (e) {
      log.warn({ err: e }, '[STRIPE-WEBHOOK] stripe_events_processed unavailable');
    }

    if (event.type === 'payment_intent.succeeded') {
      await _handleStripeSucceeded(event, event.data.object, res);
      return;
    }

    if (event.type === 'payment_intent.payment_failed') {
      await _handleStripePaymentFailed(event, event.data.object);
    }

    res.json({ received: true });
  }
);

// ── _handleStripeSucceeded ────────────────────────────────────────────────────
// Gère payment_intent.succeeded : 8 chemins de sortie, transaction + post-commit.
// Paramètres :
//   event  — objet Stripe Event complet
//   intent — event.data.object (PaymentIntent)
//   res    — objet réponse Express (la fonction envoie elle-même la réponse)
async function _handleStripeSucceeded(event, intent, res) {
  const orderId        = intent.metadata?.order_id;
  const orderReference = intent.metadata?.order_reference;

  // ── Chemin 1 : PI sans order_id metadata ──────────────────────────────
  if (!orderId) {
    log.warn({ intent_id: intent.id }, '[STRIPE-WEBHOOK] PI sans order_id metadata, ignored');
    await _markEventProcessed(event, { ignored: 'no_metadata' });
    return res.json({ received: true, ignored: true });
  }

  // ── Chemin 2 : commande introuvable ────────────────────────────────────
  // ── Chemin 3 : order déjà paid (garde dégradée si table idempotence absente) ─
  const { rows: [existing] } = await db.query(
    'SELECT payment_status FROM orders WHERE id = $1', [orderId]
  );
  if (!existing) {
    log.warn({ order_id: orderId }, '[STRIPE-WEBHOOK] order_id not found');
    await _markEventProcessed(event, { ignored: 'order_not_found', order_id: orderId });
    return res.json({ received: true, ignored: true });
  }
  if (existing.payment_status === 'paid') {
    log.info({ order_id: orderId }, '[STRIPE-WEBHOOK] order already paid, skipping');
    await _markEventProcessed(event, { ignored: 'already_paid', order_id: orderId });
    return res.json({ received: true, idempotent: true });
  }

  // Variables d'état post-transaction
  let processedOk          = false;
  let triggerPurchasingFor = null;
  let smsContext           = null;
  let stockBlocked         = false;

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // ── CYCLE CENTRAL (I-02) : confirmed + ordered + stock ────────────────
    const cycleResult = await confirmPaymentCycle({
      orderId,
      actor:    { id: null, role: 'system' },
      source:   'stripe_webhook',
      dbClient: client,
    });

    // ── Chemin 4 : noop (déjà confirmé) ───────────────────────────────────
    if (cycleResult.noop) {
      await client.query('COMMIT');
      await _markEventProcessed(event, { noop: 'confirm', order_id: orderId });
      return res.json({ received: true, idempotent: true });
    }

    // ── Chemin 5 : cycle rejeté ────────────────────────────────────────────
    if (!cycleResult.success) {
      log.error({ cycle_error: cycleResult.error }, '[STRIPE] Cycle rejected');
      await client.query('ROLLBACK');
      await _markEventProcessed(event, { rejected: 'confirm', error: cycleResult.error, order_id: orderId });
      return res.json({ received: true, rejected: true });
    }

    // ── Chemin 6 : stockBlocked — Stripe encaissé, pas de rollback possible ─
    if (cycleResult.stockBlocked) {
      stockBlocked = true;
      const insufficientItems = cycleResult.insufficientItems;

      const incidentNote = '\n[INCIDENT paid_but_stock_blocked] ' +
        insufficientItems.map(i => `${i.product_name}: dispo=${i.available}, besoin=${i.needed}`).join('; ');
      await client.query(
        `UPDATE orders SET notes = COALESCE(notes,'') || $1 WHERE id = $2`,
        [incidentNote, orderId]
      );

      try {
        await client.query(
          `INSERT INTO alerts (level, source, message, payload)
           VALUES ('critical', 'stripe_webhook', $1, $2)`,
          [
            `paid_but_stock_blocked — ${orderReference}`,
            JSON.stringify({
              order_id:                orderId,
              order_reference:         orderReference,
              insufficient_items:      insufficientItems,
              stripe_event_id:         event.id,
              stripe_payment_intent_id: intent.id,
            }),
          ]
        );
      } catch (alertErr) {
        log.error({ err: alertErr, order_reference: orderReference }, '[STRIPE-WEBHOOK] FAILED TO INSERT ALERT');
      }

      log.error(`[STRIPE-WEBHOOK] ⛔ paid_but_stock_blocked: ${orderReference} — ${insufficientItems.length} produit(s) en rupture`);
      // Pas de purchasing si stock bloqué (triggerPurchasingFor reste null)
    }

    // ── Western Union : émission du code secret de retrait ────────────────
    const { rows: [orderRow] } = await client.query(
      'SELECT relais_id FROM orders WHERE id = $1', [orderId]
    );

    let stripeBillingName = null;
    let stripeCardLast4   = null;
    let stripeEmail       = intent.receipt_email || null;
    try {
      if (intent.charges && intent.charges.data && intent.charges.data[0]) {
        const charge = intent.charges.data[0];
        stripeBillingName = charge.billing_details?.name || null;
        stripeCardLast4   = charge.payment_method_details?.card?.last4 || null;
        stripeEmail       = charge.billing_details?.email || stripeEmail;
      }
    } catch(_) { /* non-bloquant */ }

    try {
      const genResult = await generateAndStoreSecret({
        orderId,
        relaisId:  orderRow?.relais_id || null,
        channel:   'stripe',
        dbClient:  client,
        extraUpdates: {
          stripe_billing_name:  stripeBillingName,
          stripe_card_last4:    stripeCardLast4,
          stripe_receipt_email: stripeEmail,
        },
      });
      await cacheCodeForReveal(orderId, genResult.code); // SEC-1: async depuis migration 070
    } catch(genErr) {
      log.error({ err: genErr }, '[STRIPE-WEBHOOK] génération code échouée');
    }

    // Marquer event traité DANS la même transaction
    await client.query(
      `INSERT INTO stripe_events_processed (stripe_event_id, event_type, payload_summary)
       VALUES ($1, $2, $3)
       ON CONFLICT (stripe_event_id) DO NOTHING`,
      [event.id, event.type, JSON.stringify({
        order_id: orderId,
        order_reference: orderReference,
        stock_blocked: stockBlocked,
      })]
    );

    await client.query('COMMIT');
    processedOk = !stockBlocked;
    smsContext  = { order_id: orderId, order_reference: orderReference };
    if (processedOk) triggerPurchasingFor = orderId;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // ── Chemin 7 (stockBlocked) et 8 (nominal) : SMS post-commit ──────────
  if (smsContext) {
    const { rows: [order] } = await db.query(
      `SELECT o.*, u.phone AS user_phone
       FROM orders o LEFT JOIN users u ON u.id = o.user_id
       WHERE o.id = $1`,
      [smsContext.order_id]
    );
    if (order?.user_phone && !stockBlocked) {
      sendSMS(
        order.user_phone,
        `Komerce · Paiement reçu pour la commande ${smsContext.order_reference}. Votre commande est lancée — achat en cours à Dubai.`,
        'ordered', smsContext.order_id
      ).catch(err => log.error({ err }, 'SMS webhook error'));
    } else if (order?.user_phone && stockBlocked) {
      // Chemin 7 : notif différente paiement reçu + traitement manuel
      sendSMS(
        order.user_phone,
        `Komerce · Paiement reçu pour ${smsContext.order_reference}. Notre équipe vous contacte sous 24h pour finaliser.`,
        'paid_pending_review', smsContext.order_id
      ).catch(err => log.error({ err }, 'SMS webhook error'));
    }
    log.info(`✅ Paiement Stripe confirmé : ${smsContext.order_reference}${stockBlocked ? ' (STOCK BLOCKED)' : ''}`);

    // ── Chemin 8 : notifications complètes uniquement si nominal ─────────
    if (processedOk) {
      try {
        const notifSvc = require('../services/notification-service');
        notifSvc.notifyPaymentConfirmed(smsContext.order_id, smsContext.order_reference)
          .then(result => {
            if (result?.invoice) {
              log.info(`🧾 [STRIPE] Invoice ${result.invoice} sent for ${smsContext.order_reference}`);
            }
          })
          .catch(e => log.error({ err: e }, '[STRIPE-NOTIF] notification failed'));
      } catch(e) { log.error({ err: e }, '[STRIPE-NOTIF] require error'); }
    }
  }

  // ── Chemin 8 : sourcing fire-and-forget — JAMAIS await (I-02 / purchasing) ─
  if (triggerPurchasingFor) {
    triggerPurchasing(triggerPurchasingFor)
      .then(() => log.info({ order_reference: smsContext?.order_reference }, '[PURCHASING] Stripe trigger OK'))
      .catch(async (e) => {
        log.error({ err: e, order_reference: smsContext?.order_reference }, '[PURCHASING] Stripe trigger error');
        try {
          await db.query(
            `INSERT INTO alerts (level, source, message, payload)
             VALUES ('elevated', 'purchasing', $1, $2)`,
            [
              `triggerPurchasing failed: ${smsContext?.order_reference}`,
              JSON.stringify({ order_id: triggerPurchasingFor, error: e.message, stripe_event_id: event.id }),
            ]
          );
        } catch (alertErr) {
          log.error({ err: alertErr }, '[PURCHASING] alert insert failed');
        }
      });
  }

  return res.json({ received: true });
}

// ── _handleStripePaymentFailed ────────────────────────────────────────────────
// Gère payment_intent.payment_failed.
// Guard : ne jamais écraser un statut 'paid' avec 'failed'.
// Le caller fait res.json({ received: true }) après retour.
async function _handleStripePaymentFailed(event, intent) {
  const orderId = intent.metadata?.order_id;

  if (!orderId) {
    log.warn({ intent_id: intent.id }, '[STRIPE-WEBHOOK] payment_failed sans order_id, ignored');
    await _markEventProcessed(event, { ignored: 'no_metadata_failed' });
    return;
  }

  // Guard : ne JAMAIS écraser un paid avec un failed
  const upd = await db.query(
    `UPDATE orders SET payment_status = 'failed'
     WHERE id = $1 AND payment_status = 'pending'`,
    [orderId]
  );
  if (upd.rowCount === 0) {
    log.warn(`[STRIPE-WEBHOOK] payment_failed ignored (already paid or unknown): ${intent.metadata?.order_reference}`);
  } else {
    log.info(`❌ Paiement Stripe échoué : ${intent.metadata?.order_reference}`);
  }

  await _markEventProcessed(event, { event: 'failed', order_id: orderId, applied: upd.rowCount > 0 });
}

// ── _markEventProcessed ──────────────────────────────────────────────────────
// Marque un event Stripe traité (idempotence). Hors transaction principale.
// Erreur loggée mais non bloquante. Ne pas déplacer dans un service externe.
async function _markEventProcessed(event, payloadSummary) {
  try {
    await db.query(
      `INSERT INTO stripe_events_processed (stripe_event_id, event_type, payload_summary)
       VALUES ($1, $2, $3)
       ON CONFLICT (stripe_event_id) DO NOTHING`,
      [event.id, event.type, JSON.stringify(payloadSummary || {})]
    );
  } catch (e) {
    log.warn({ err: e }, '[STRIPE-WEBHOOK] _markEventProcessed failed');
  }
}

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

    // ── CROSS-RELAIS CHECK (P0 sprint 2) — STRICT ────────────────────────
    if (req.user.role === 'agent_relais') {
      let agentRelaisId = null;
      let checkPossible = true;
      try {
        const { rows: [agent] } = await client.query(
          'SELECT relais_id FROM users WHERE id = $1',
          [req.user.id]
        );
        agentRelaisId = agent?.relais_id || null;
      } catch (e) {
        checkPossible = false;
        log.warn(`[CASH-CONFIRM] users.relais_id query failed: ${e.message}`);
      }

      if (!checkPossible || !agentRelaisId) {
        await client.query('ROLLBACK');
        try {
          await db.query(
            `INSERT INTO alerts (level, source, message, payload)
             VALUES ('elevated', 'cash_confirm', $1, $2)`,
            [
              `agent_relais sans relais_id tente cash_confirm: user=${req.user.id}`,
              JSON.stringify({
                order_reference: order.reference,
                user_id: req.user.id,
                check_possible: checkPossible,
              }),
            ]
          );
        } catch (_) { /* non-bloquant */ }
        return res.status(403).json({
          error: 'Configuration agent incomplète — contactez un admin',
        });
      }

      if (String(agentRelaisId) !== String(order.relais_id)) {
        await client.query('ROLLBACK');
        log.warn(`[CASH-CONFIRM] ⛔ Cross-relais refusé — agent ${req.user.id} (relais ${agentRelaisId}) tentait commande ${order.reference} (relais ${order.relais_id})`);
        try {
          await db.query(
            `INSERT INTO alerts (level, source, message, payload)
             VALUES ('elevated', 'cash_confirm', $1, $2)`,
            [
              `Cross-relais refusé: ${order.reference}`,
              JSON.stringify({
                user_id: req.user.id,
                agent_relais_id: agentRelaisId,
                order_relais_id: order.relais_id,
                order_reference: order.reference,
              }),
            ]
          );
        } catch (_) { /* non-bloquant */ }
        return res.status(403).json({
          error: 'Cette commande appartient à un autre relais — vous ne pouvez pas la valider',
        });
      }
    }

    // ── CYCLE CENTRAL : confirmed + ordered + stock (LOT 1 — service centralisé) ──
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
        error: `Stock insuffisant pour "${first.product_name}" — ${first.available} restant(s). Annuler ou ajuster la commande.`,
      });
    }

    await client.query(
      'UPDATE orders SET cash_paid_at = COALESCE(cash_paid_at, NOW()) WHERE id = $1',
      [order.id]
    );

    await client.query('COMMIT');

    res.json({
      message:   'Paiement espèces confirmé — commande validée',
      reference: order.reference,
      paid_at:   new Date().toISOString(),
      next_step: 'Sourcing déclenché automatiquement — bon de commande à l\'agent Dubai',
    });

    // ── POST-COMMIT: Notifications crash-safe (fire-and-forget) ──
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
        ).catch(e => log.error({ err: e }, '[CASH-SMS] SMS send failed'));
      }

      const notifSvc = require('../services/notification-service');
      notifSvc.notifyPaymentConfirmed(order.id, order.reference)
        .then(result => {
          if (result?.invoice) {
            log.info(`🧾 [CASH] Invoice ${result.invoice} sent for ${order.reference}`);
          }
        })
        .catch(e => log.error({ err: e }, '[CASH-NOTIF] notification failed'));

      triggerPurchasing(order.id)
        .then(() => log.info({ order_reference: order.reference }, '[PURCHASING] Cash trigger OK'))
        .catch(e => log.error({ err: e, order_reference: order.reference }, '[PURCHASING] Cash trigger error'));
    } catch(e) {
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
router.get('/rates', async (req, res, next) => {
  try {
    const rates = await getRates();
    res.json({
      eur_kmf: rates.eur_kmf,
      aed_kmf: rates.aed_kmf,
      source: 'finance_config',
    });
  } catch(err) { next(err); }
});

// ── GET /api/payments/config ──────────────────────────────────────────────────
router.get('/config', (req, res) => {
  const key = process.env.STRIPE_PUBLISHABLE_KEY;
  if (!key) return res.status(500).json({ error: 'Stripe non configuré' });
  res.json({ publishable_key: key });
});

module.exports = router;
