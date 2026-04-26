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

// Western Union model : émission du code secret au moment du paiement Stripe
const { generateAndStoreSecret, cacheCodeForReveal } = require('./pickup-secret');

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

    // ── 0. IDEMPOTENCE FORTE — DÈS L'ENTRÉE ────────────────────────────────
    // Si event.id déjà traité, on ne refait RIEN (pas de stock, pas de SMS,
    // pas de purchasing). On répond 200 pour que Stripe arrête de retry.
    try {
      const seen = await db.query(
        'SELECT 1 FROM stripe_events_processed WHERE stripe_event_id = $1',
        [event.id]
      );
      if (seen.rows.length) {
        return res.json({ received: true, idempotent: true });
      }
    } catch (e) {
      // Si la table n'existe pas (migration 048 pas passée), on log mais on continue
      // pour ne pas bloquer le webhook. L'idempotence dégradera sur payment_status.
      console.warn('[STRIPE-WEBHOOK] stripe_events_processed unavailable:', e.message);
    }

    // Variables d'état partagées entre les events
    let processedOk = false;          // true si traitement nominal complet
    let triggerPurchasingFor = null;  // order_id seulement si tout est nickel
    let smsContext = null;            // {order, order_reference}
    let stockBlocked = false;         // true si stock insuffisant détecté

    // Paiement confirmé
    if (event.type === 'payment_intent.succeeded') {
      const intent = event.data.object;
      const orderId = intent.metadata?.order_id;
      const orderReference = intent.metadata?.order_reference;

      // ── 1. Ignorer proprement les PI sans metadata order_id ──────────────
      if (!orderId) {
        console.warn('[STRIPE-WEBHOOK] PI sans order_id metadata, ignored:', intent.id);
        await _markEventProcessed(event, { ignored: 'no_metadata' });
        return res.json({ received: true, ignored: true });
      }

      // ── Garde additionnelle (defense in depth, dégradée) ─────────────────
      // Si la commande est déjà 'paid', l'idempotence event.id a échoué (table absente?).
      // On évite quand même le double traitement.
      const { rows: [existing] } = await db.query(
        'SELECT payment_status FROM orders WHERE id = $1', [orderId]
      );
      if (!existing) {
        console.warn('[STRIPE-WEBHOOK] order_id not found:', orderId);
        await _markEventProcessed(event, { ignored: 'order_not_found', order_id: orderId });
        return res.json({ received: true, ignored: true });
      }
      if (existing.payment_status === 'paid') {
        console.log('[STRIPE-WEBHOOK] order already paid, skipping:', orderId);
        await _markEventProcessed(event, { ignored: 'already_paid', order_id: orderId });
        return res.json({ received: true, idempotent: true });
      }

      const client = await db.pool.connect();
      try {
        await client.query('BEGIN');

        // Step 1: pending → confirmed (payment received)
        const confirmResult = await transitionOrderStatus({
          orderId,
          newStatus: 'confirmed',
          actor:    { id: null, role: 'system' },
          source:   'stripe_webhook',
          note:     'Paiement Stripe reçu',
          dbClient: client,
        });
        // ── Si noop : transition déjà faite (idempotent), on COMMIT et return ──
        if (confirmResult.noop) {
          await client.query('COMMIT');
          await _markEventProcessed(event, { noop: 'confirm', order_id: orderId });
          return res.json({ received: true, idempotent: true });
        }
        if (!confirmResult.success) {
          console.error('[STRIPE] Machine rejected confirm:', confirmResult.error);
          await client.query('ROLLBACK');
          await _markEventProcessed(event, { rejected: 'confirm', error: confirmResult.error, order_id: orderId });
          return res.json({ received: true, rejected: true });
        }

        // Step 2: confirmed → ordered
        const orderResult = await transitionOrderStatus({
          orderId,
          newStatus: 'ordered',
          actor:    { id: null, role: 'system' },
          source:   'system',
          note:     'Commande lancée automatiquement après paiement Stripe',
          dbClient: client,
        });
        if (!orderResult.success && !orderResult.noop) {
          console.warn('[STRIPE] Machine rejected ordered (non-fatal):', orderResult.error);
        }

        // ── 4. STOCK GUARDED — pas de stock négatif possible ─────────────
        const { rows: stripeItems } = await client.query(
          `SELECT oi.product_id, oi.quantity, p.stock, p.name
           FROM order_items oi
           JOIN products p ON p.id = oi.product_id
           WHERE oi.order_id = $1 AND p.stock IS NOT NULL
           FOR UPDATE OF p`,
          [orderId]
        );

        const insufficientItems = [];
        for (const si of stripeItems) {
          if (si.stock < si.quantity) {
            // Stock épuisé entre commande et paiement
            insufficientItems.push({
              product_id: si.product_id,
              product_name: si.name,
              available: si.stock,
              needed: si.quantity,
            });
          }
        }

        if (insufficientItems.length > 0) {
          // ── 5. Stock insuffisant après paiement Stripe ─────────────────
          // Le paiement a été encaissé, on ne peut pas rollback la transition.
          // On marque la commande pour traitement manuel + alerte.
          stockBlocked = true;

          // Annoter la commande pour traçabilité
          const incidentNote = '\n[INCIDENT paid_but_stock_blocked] ' +
            insufficientItems.map(i => `${i.product_name}: dispo=${i.available}, besoin=${i.needed}`).join('; ');
          await client.query(
            `UPDATE orders
               SET notes = COALESCE(notes,'') || $1
             WHERE id = $2`,
            [incidentNote, orderId]
          );

          // Alerte exploitable côté admin
          try {
            await client.query(
              `INSERT INTO alerts (level, source, message, payload)
               VALUES ('critical', 'stripe_webhook', $1, $2)`,
              [
                `paid_but_stock_blocked — ${orderReference}`,
                JSON.stringify({
                  order_id: orderId,
                  order_reference: orderReference,
                  insufficient_items: insufficientItems,
                  stripe_event_id: event.id,
                  stripe_payment_intent_id: intent.id,
                }),
              ]
            );
          } catch (alertErr) {
            // Ne PAS masquer l'incident : log explicite si alerts insère échoue
            console.error('[STRIPE-WEBHOOK] ⛔ FAILED TO INSERT ALERT for', orderReference, alertErr.message);
          }

          console.error(`[STRIPE-WEBHOOK] ⛔ paid_but_stock_blocked: ${orderReference} — ${insufficientItems.length} produit(s) en rupture`);
          // Pas de décrément stock (on n'a pas le stock), pas de purchasing
        } else {
          // Stock OK partout → décrémenter
          for (const si of stripeItems) {
            await client.query(
              'UPDATE products SET stock = stock - $1 WHERE id = $2',
              [si.quantity, si.product_id]
            );
          }
        }

        // ── Western Union : émission du code secret de retrait (inchangé) ─
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
          cacheCodeForReveal(orderId, genResult.code);
        } catch(genErr) {
          console.error('[STRIPE-WEBHOOK] ⚠ génération code échouée :', genErr.message);
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
        smsContext = { order_id: orderId, order_reference: orderReference };
        if (processedOk) triggerPurchasingFor = orderId;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      // ── SMS confirmation — non bloquant ─────────────────────────────────
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
          ).catch(err => console.error('SMS webhook error:', err.message));
        } else if (order?.user_phone && stockBlocked) {
          // Notif différente : paiement reçu mais traitement spécial
          sendSMS(
            order.user_phone,
            `Komerce · Paiement reçu pour ${smsContext.order_reference}. Notre équipe vous contacte sous 24h pour finaliser.`,
            'paid_pending_review', smsContext.order_id
          ).catch(err => console.error('SMS webhook error:', err.message));
        }
        console.log(`✅ Paiement Stripe confirmé : ${smsContext.order_reference}${stockBlocked ? ' (STOCK BLOCKED)' : ''}`);

        // ── Notifications complètes (WhatsApp + Email + Facture) — uniquement si nominal ──
        if (processedOk) {
          try {
            const notifSvc = require('../services/notification-service');
            notifSvc.notifyPaymentConfirmed(smsContext.order_id, smsContext.order_reference)
              .then(result => {
                if (result?.invoice) {
                  console.log(`🧾 [STRIPE] Invoice ${result.invoice} sent for ${smsContext.order_reference}`);
                }
              })
              .catch(e => console.error('[STRIPE-NOTIF] ❌', e.message));
          } catch(e) { console.error('[STRIPE-NOTIF] require error:', e.message); }
        }
      }

      // ── Sourcing — uniquement si tout est nickel (pas de stock_blocked, pas de noop) ──
      if (triggerPurchasingFor) {
        triggerPurchasing(triggerPurchasingFor)
          .then(r => console.log('[PURCHASING] Stripe trigger OK:', smsContext?.order_reference, r))
          .catch(async (e) => {
            console.error('[PURCHASING] Stripe trigger error:', smsContext?.order_reference, e.message);
            // Trace exploitable DB pour traitement manuel admin
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
              console.error('[PURCHASING] alert insert failed:', alertErr.message);
            }
          });
      }
    }

    // ── Paiement échoué ──────────────────────────────────────────────────
    if (event.type === 'payment_intent.payment_failed') {
      const intent = event.data.object;
      const orderId = intent.metadata?.order_id;

      if (!orderId) {
        console.warn('[STRIPE-WEBHOOK] payment_failed sans order_id, ignored:', intent.id);
        await _markEventProcessed(event, { ignored: 'no_metadata_failed' });
        return res.json({ received: true, ignored: true });
      }

      // ── Guard : ne JAMAIS écraser un paid avec un failed ─────────────
      // Update conditionnel : ne touche que si payment_status est encore pending.
      const upd = await db.query(
        `UPDATE orders SET payment_status = 'failed'
         WHERE id = $1 AND payment_status = 'pending'`,
        [orderId]
      );
      if (upd.rowCount === 0) {
        console.warn(`[STRIPE-WEBHOOK] payment_failed ignored (already paid or unknown): ${intent.metadata?.order_reference}`);
      } else {
        console.log(`❌ Paiement Stripe échoué : ${intent.metadata?.order_reference}`);
      }

      await _markEventProcessed(event, { event: 'failed', order_id: orderId, applied: upd.rowCount > 0 });
    }

    res.json({ received: true });
  }
);

// Helper : marque un event Stripe traité (idempotence). Erreur loggée mais non bloquante.
async function _markEventProcessed(event, payloadSummary) {
  try {
    await db.query(
      `INSERT INTO stripe_events_processed (stripe_event_id, event_type, payload_summary)
       VALUES ($1, $2, $3)
       ON CONFLICT (stripe_event_id) DO NOTHING`,
      [event.id, event.type, JSON.stringify(payloadSummary || {})]
    );
  } catch (e) {
    console.warn('[STRIPE-WEBHOOK] _markEventProcessed failed:', e.message);
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
    // Un agent_relais ne peut valider que les paiements de SON relais.
    // Admin = exempté (peut valider n'importe quelle commande).
    //
    // P0 FIX : si users.relais_id absent ou check impossible → REFUS strict
    // pour agent_relais. Avant : laissait passer silencieusement = trou de sécurité.
    // Seul admin peut contourner.
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
        console.warn(`[CASH-CONFIRM] users.relais_id query failed: ${e.message}`);
      }

      if (!checkPossible || !agentRelaisId) {
        // P0 FIX : refus strict (avant : laissait passer)
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
        console.warn(`[CASH-CONFIRM] ⛔ Cross-relais refusé — agent ${req.user.id} (relais ${agentRelaisId}) tentait commande ${order.reference} (relais ${order.relais_id})`);
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

    // cash_paid_at — P0 FIX : COALESCE pour ne jamais réécrire un timestamp existant
    // (cohérent avec la doctrine "timestamps set ONCE" de la state machine)
    await client.query(
      'UPDATE orders SET cash_paid_at = COALESCE(cash_paid_at, NOW()) WHERE id = $1',
      [order.id]
    );

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
// Retourne les taux de change actuels (utilisés par le front pour la conversion).
// ADR-009 : getRates() lit la source de vérité finance_config.
// On ne lit PLUS exchange_rates ici (devenue table d'historique passive).
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
// Expose la clé publique Stripe au frontend (clé publique = safe to expose)
router.get('/config', (req, res) => {
  const key = process.env.STRIPE_PUBLISHABLE_KEY;
  if (!key) return res.status(500).json({ error: 'Stripe non configuré' });
  res.json({ publishable_key: key });
});

module.exports = router;
