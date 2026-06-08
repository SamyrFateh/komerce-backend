'use strict';

/**
 * KOMERCE — routes/payments-paypal.js
 *
 * Endpoints PayPal pour la diaspora France (et au-delà).
 *
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  CONTRAT — invariants critiques                                       ║
 * ║                                                                      ║
 * ║  I-01  : Toute transition de statut passe par order-status-machine.  ║
 * ║          Aucun UPDATE orders SET status direct dans ce fichier.      ║
 * ║  I-02  : Toute confirmation paiement passe par confirmPaymentCycle   ║
 * ║          avec source='paypal_capture'.                               ║
 * ║  I-07  : Webhook idempotent via paypal_events_processed avant TOUT   ║
 * ║          traitement métier.                                          ║
 * ║                                                                      ║
 * ║  Validation montant (anti-manipulation client) :                     ║
 * ║  Le montant transmis par le front est IGNORÉ — on relit orders.     ║
 * ║  total_eur côté serveur pour créer la PayPal Order.                  ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * Endpoints :
 *   POST /api/payments/paypal/create-order              — auth required
 *   POST /api/payments/paypal/capture/:paypalOrderId    — auth required
 *   POST /api/payments/paypal/webhook                   — pas d'auth, signature PayPal
 *   POST /api/payments/paypal/refund/:orderId           — auth + admin
 */

const express = require('express');
const router  = express.Router();

const db                = require('../db');
const log               = require('../utils/logger').child({ module: 'payments-paypal' });
const { authenticate }  = require('../middleware/auth');
const { authenticateOrCreateGuest: authGuest } = require('../middleware/auth-guest');
const paypal            = require('../services/paypal-client');
const { confirmPaymentCycle } = require('../services/order-payment-confirmation');
const { generateAndStoreSecret, cacheCodeForReveal } = require('../services/parcel-security');

// ─────────────────────────────────────────────────────────────────────────────
// 1. POST /api/payments/paypal/create-order
// ─────────────────────────────────────────────────────────────────────────────
// Body attendu : { order_reference } OU { order_id }
// L'authentification accepte les guests (panier non-loggué) via auth-guest.
//
// Retour : { paypal_order_id, status }
// ─────────────────────────────────────────────────────────────────────────────

router.post('/create-order', authGuest, async (req, res) => {
  const { order_reference, order_id } = req.body || {};

  if (!order_reference && !order_id) {
    return res.status(400).json({ error: 'order_reference ou order_id requis' });
  }

  try {
    // 1. Récupérer la commande côté serveur (anti-manipulation client)
    const where = order_id ? 'id = $1' : 'reference = $1';
    const param = order_id || order_reference;

    const { rows } = await db.query(
      `SELECT id, reference, total_eur, payment_status, payment_mode, user_id, guest_token
         FROM orders WHERE ${where}`,
      [param]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Commande introuvable' });
    }

    const order = rows[0];

    // 2. Vérification ownership (user authentifié OU guest avec le bon token)
    if (req.user?.id && order.user_id && order.user_id !== req.user.id) {
      log.warn({ order_id: order.id, requested_by: req.user.id }, '[PAYPAL] tentative create-order sur commande d\'autrui');
      return res.status(403).json({ error: 'Accès refusé à cette commande' });
    }

    // 3. Garde paiement déjà effectué
    if (order.payment_status === 'paid') {
      return res.status(409).json({ error: 'Commande déjà payée' });
    }

    // 4. Garde montant EUR
    const amountEur = Number(order.total_eur);
    if (!amountEur || amountEur <= 0) {
      log.error({ order_id: order.id, total_eur: order.total_eur },
        '[PAYPAL] total_eur manquant ou invalide');
      return res.status(409).json({ error: 'Montant EUR non disponible pour cette commande' });
    }

    // 5. Créer la PayPal Order
    // FIX: application_context requis pour que la popup PayPal s'affiche correctement
    // (sans return_url/cancel_url le SDK ouvre une page vide en sandbox et prod).
    // shipping_preference=NO_SHIPPING : retrait relais, pas d'adresse de livraison.
    // landing_page=BILLING : évite la page de login PayPal vide avant le formulaire de carte.
    // user_action=PAY_NOW : libellé "Payer maintenant" au lieu de "Continuer".
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

    // 6. Persister le paypal_order_id côté Komerce
    //    (on ne touche pas status — c'est le webhook capture qui le fera via confirmPaymentCycle)
    await db.query(
      `UPDATE orders SET paypal_order_id = $1 WHERE id = $2`,
      [ppOrder.id, order.id]
    );

    log.info({ order_id: order.id, paypal_order_id: ppOrder.id, amount_eur: amountEur },
      '[PAYPAL] order créée');

    return res.json({
      paypal_order_id: ppOrder.id,
      status:          ppOrder.status,
    });

  } catch (err) {
    log.error({ err: err.message, stack: err.stack }, '[PAYPAL] create-order failed');
    return res.status(500).json({ error: 'Erreur création PayPal Order', detail: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. POST /api/payments/paypal/capture/:paypalOrderId
// ─────────────────────────────────────────────────────────────────────────────
// Appelé par le front après onApprove du bouton PayPal.
//
// Le flow critique :
//   a. Lookup orders by paypal_order_id (anti-spoof)
//   b. Capture côté PayPal
//   c. Validation amount renvoyé == orders.total_eur (anti-tampering)
//   d. confirmPaymentCycle({ source: 'paypal_capture' }) — hub I-02
//   e. Génération code secret retrait
//   f. Réponse 200 avec details
//
// Note : ce endpoint NE remplace PAS le webhook. Le webhook PAYMENT.CAPTURE.COMPLETED
// arrivera ensuite et sera ignoré (idempotent via paypal_events_processed +
// payment_status='paid' check).
// ─────────────────────────────────────────────────────────────────────────────

router.post('/capture/:paypalOrderId', authGuest, async (req, res) => {
  const { paypalOrderId } = req.params;
  if (!paypalOrderId) return res.status(400).json({ error: 'paypalOrderId requis' });

  // Lookup côté Komerce d'abord (anti-spoof : on s'assure que cet ID est lié à UNE commande nôtre)
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

  // Ownership
  if (req.user?.id && order.user_id && order.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Accès refusé' });
  }

  // Déjà payé → idempotence (le webhook a peut-être déjà fait le job)
  if (order.payment_status === 'paid') {
    return res.json({ already_paid: true, order_id: order.id, order_reference: order.reference });
  }

  let captureResult;
  try {
    captureResult = await paypal.captureOrder(paypalOrderId);
  } catch (err) {
    log.error({ err: err.message, paypal_order_id: paypalOrderId },
      '[PAYPAL] capture failed');
    return res.status(502).json({ error: 'Échec capture PayPal', detail: err.message });
  }

  const info = paypal.extractCaptureInfo(captureResult);
  if (!info || info.status !== 'COMPLETED') {
    log.warn({ captureResult }, '[PAYPAL] capture non-COMPLETED');
    return res.status(409).json({
      error:  'Capture PayPal non-COMPLETED',
      status: info?.status || 'unknown',
    });
  }

  // ── Validation montant (anti-tampering) ────────────────────────────────────
  const expectedEur = Number(order.total_eur);
  const actualEur   = info.amount_value;
  // Tolérance arrondi 1 centime
  if (Math.abs(expectedEur - actualEur) > 0.01) {
    log.error({
      order_id:    order.id,
      expected:    expectedEur,
      actual:      actualEur,
      capture_id:  info.paypal_capture_id,
    }, '[PAYPAL] MISMATCH montant — capture rejetée');

    // Alerte critique : la capture a été faite mais le montant ne correspond pas.
    // On ne lance PAS le cycle de paiement — l'admin doit traiter manuellement.
    try {
      await db.query(
        `INSERT INTO alerts (level, source, message, payload)
         VALUES ('critical', 'paypal_capture', $1, $2)`,
        [
          `paypal_amount_mismatch — ${order.reference}`,
          JSON.stringify({
            order_id:          order.id,
            order_reference:   order.reference,
            expected_eur:      expectedEur,
            actual_eur:        actualEur,
            paypal_capture_id: info.paypal_capture_id,
            paypal_order_id:   paypalOrderId,
          }),
        ]
      );
    } catch (e) {
      log.error({ err: e.message }, '[PAYPAL] alert insert failed');
    }

    return res.status(409).json({
      error:    'Montant capturé incohérent avec la commande — admin contacté',
      expected: expectedEur,
      actual:   actualEur,
    });
  }

  // ── Cycle paiement (transaction) ──────────────────────────────────────────
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Hub I-02 : pending → confirmed + stock check + ordered
    const cycleResult = await confirmPaymentCycle({
      orderId:  order.id,
      actor:    { id: null, role: 'system' },
      source:   'paypal_capture',
      dbClient: client,
      note:     `Paiement PayPal reçu (capture ${info.paypal_capture_id})`,
    });

    // a. noop : déjà confirmé (race condition avec webhook)
    if (cycleResult.noop) {
      // On enregistre quand même les infos capture pour traçabilité
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
      return res.json({ already_paid: true, order_id: order.id, order_reference: order.reference });
    }

    // b. cycle rejeté (transition impossible)
    if (!cycleResult.success) {
      log.error({ cycle_error: cycleResult.error, order_id: order.id }, '[PAYPAL] cycle rejected');
      await client.query('ROLLBACK');
      // /!\ La capture PayPal est faite — l'argent est encaissé.
      // On alerte et on retourne 502.
      try {
        await db.query(
          `INSERT INTO alerts (level, source, message, payload)
           VALUES ('critical', 'paypal_capture', $1, $2)`,
          [
            `paypal_paid_but_cycle_failed — ${order.reference}`,
            JSON.stringify({
              order_id:          order.id,
              cycle_error:       cycleResult.error,
              paypal_capture_id: info.paypal_capture_id,
            }),
          ]
        );
      } catch (e) { /* log only */ }
      return res.status(502).json({ error: 'Cycle paiement rejeté — admin contacté' });
    }

    // c. Stock bloqué : argent encaissé, stock indispo → COMMIT + alerte
    let stockBlocked = false;
    if (cycleResult.stockBlocked) {
      stockBlocked = true;
      const items = cycleResult.insufficientItems;
      const note  = '\n[INCIDENT paid_but_stock_blocked] ' +
        items.map(i => `${i.product_name}: dispo=${i.available}, besoin=${i.needed}`).join('; ');
      await client.query(
        `UPDATE orders SET notes = COALESCE(notes, '') || $1 WHERE id = $2`,
        [note, order.id]
      );
      try {
        await client.query(
          `INSERT INTO alerts (level, source, message, payload)
           VALUES ('critical', 'paypal_capture', $1, $2)`,
          [
            `paid_but_stock_blocked — ${order.reference}`,
            JSON.stringify({
              order_id:           order.id,
              order_reference:    order.reference,
              insufficient_items: items,
              paypal_capture_id:  info.paypal_capture_id,
            }),
          ]
        );
      } catch (e) {
        log.error({ err: e.message }, '[PAYPAL] alert insert failed (stockBlocked)');
      }
    }

    // 2. Persister les infos PayPal (capture_id, payer, pay-in-4)
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

    // 3. Génération code secret retrait (idem flow Stripe)
    const { rows: [orderRow] } = await client.query(
      'SELECT relais_id FROM orders WHERE id = $1', [order.id]
    );
    let pickupCode = null;
    try {
      const genResult = await generateAndStoreSecret({
        orderId:   order.id,
        relaisId:  orderRow?.relais_id || null,
        channel:   'paypal',
        dbClient:  client,
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

    log.info({
      order_id:         order.id,
      order_reference:  order.reference,
      paypal_capture_id: info.paypal_capture_id,
      pay_in_4:         info.pay_in_4,
      stock_blocked:    stockBlocked,
    }, '[PAYPAL] capture OK');

    return res.json({
      success:         true,
      order_id:        order.id,
      order_reference: order.reference,
      pay_in_4_used:   info.pay_in_4,
      stock_blocked:   stockBlocked,
    });

  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    log.error({ err: err.message, stack: err.stack, order_id: order.id },
      '[PAYPAL] capture handler crashed');
    return res.status(500).json({ error: 'Erreur interne', detail: err.message });
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. POST /api/payments/paypal/webhook
// ─────────────────────────────────────────────────────────────────────────────
// Webhook PayPal. Le body est lu en RAW (mounté avant express.json dans server.js).
// Idempotence via paypal_events_processed (I-07).
//
// Events traités :
//   PAYMENT.CAPTURE.COMPLETED — confirme un paiement (fallback si capture
//                              endpoint n'a pas pu joindre la DB)
//   PAYMENT.CAPTURE.DENIED    — rejet (rare, log + alerte)
//   PAYMENT.CAPTURE.REFUNDED  — refund reçu (info-only, traçabilité)
//   CUSTOMER.DISPUTE.CREATED  — litige créé (alerte admin)
//
// Tous les autres events sont enregistrés ignored=true.
// ─────────────────────────────────────────────────────────────────────────────

router.post('/webhook', async (req, res) => {
  // 1. Récupérer le body brut (rawBody injecté par express.raw)
  let rawBody = req.body;
  if (Buffer.isBuffer(rawBody)) rawBody = rawBody.toString('utf8');

  // 2. Parse JSON
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

  // 3. Vérifier la signature
  const signatureValid = await paypal.verifyWebhookSignature(req.headers, rawBody);
  if (!signatureValid) {
    log.warn({ event_id: event.id, event_type: event.event_type },
      '[PAYPAL-WEBHOOK] signature invalide — rejet');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // 4. Idempotence (I-07) — check + insert SOUS verrouillage léger
  try {
    const seen = await db.query(
      'SELECT 1 FROM paypal_events_processed WHERE event_id = $1',
      [event.id]
    );
    if (seen.rows.length) {
      log.info({ event_id: event.id }, '[PAYPAL-WEBHOOK] déjà traité — idempotent');
      return res.json({ received: true, idempotent: true });
    }
  } catch (e) {
    log.warn({ err: e.message }, '[PAYPAL-WEBHOOK] paypal_events_processed unavailable');
  }

  // 5. Dispatch
  try {
    switch (event.event_type) {
      case 'PAYMENT.CAPTURE.COMPLETED':
        await _handleCaptureCompleted(event);
        break;
      case 'PAYMENT.CAPTURE.DENIED':
      case 'PAYMENT.CAPTURE.DECLINED':
        await _handleCaptureDenied(event);
        break;
      case 'PAYMENT.CAPTURE.REFUNDED':
      case 'PAYMENT.CAPTURE.REVERSED':
        await _handleCaptureRefunded(event);
        break;
      case 'CUSTOMER.DISPUTE.CREATED':
      case 'CUSTOMER.DISPUTE.UPDATED':
        await _handleDispute(event);
        break;
      default:
        await _markEventProcessed(event, 'ignored', { reason: 'not_handled' });
        return res.json({ received: true, ignored: true });
    }
  } catch (err) {
    log.error({ err: err.message, event_id: event.id, event_type: event.event_type },
      '[PAYPAL-WEBHOOK] handler error');
    // On répond 200 pour éviter le retry PayPal qui amplifie le souci.
    // L'erreur est tracée et l'event N'EST PAS marqué processed → un opérateur peut rejouer.
    return res.json({ received: true, error: err.message });
  }

  return res.json({ received: true });
});

// ─── Webhook handlers internes ─────────────────────────────────────────────

async function _handleCaptureCompleted(event) {
  const info = paypal.extractCaptureInfo(event);
  if (!info?.paypal_capture_id) {
    log.warn({ event_id: event.id }, '[PAYPAL-WEBHOOK] capture event sans capture_id');
    await _markEventProcessed(event, 'ignored', { reason: 'no_capture_id' });
    return;
  }

  // Lookup order : 1) par paypal_capture_id (capture endpoint a peut-être déjà tagué)
  //                2) par paypal_order_id parent
  //                3) par reference (custom_id ou invoice_id)
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
    await _markEventProcessed(event, 'ignored', { reason: 'order_not_found', capture_id: info.paypal_capture_id });
    return;
  }

  // Si déjà payé (le capture endpoint a fait le job), on enregistre juste l'event
  if (order.payment_status === 'paid') {
    log.info({ order_id: order.id, event_id: event.id },
      '[PAYPAL-WEBHOOK] order déjà paid — idempotent');
    await _markEventProcessed(event, 'noop', { order_id: order.id, reason: 'already_paid' });
    return;
  }

  // Sinon : on déclenche le cycle paiement (cas de fallback si capture endpoint a planté)
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
      await _markEventProcessed(event, 'noop', { order_id: order.id });
      return;
    }
    if (!cycleResult.success) {
      await client.query('ROLLBACK');
      await _markEventProcessed(event, 'rejected', { order_id: order.id, error: cycleResult.error });
      return;
    }

    // Persister infos PayPal
    await client.query(
      `UPDATE orders SET
         paypal_capture_id    = COALESCE(paypal_capture_id, $1),
         payment_mode         = COALESCE(payment_mode, 'paypal_eur'::payment_mode)
       WHERE id = $2`,
      [info.paypal_capture_id, order.id]
    );

    // Marquer event traité DANS la même transaction
    await client.query(
      `INSERT INTO paypal_events_processed (event_id, event_type, payload_summary, status)
       VALUES ($1, $2, $3, 'processed')
       ON CONFLICT (event_id) DO NOTHING`,
      [event.id, event.event_type, JSON.stringify({
        order_id:          order.id,
        order_reference:   order.reference,
        paypal_capture_id: info.paypal_capture_id,
        stock_blocked:     !!cycleResult.stockBlocked,
      })]
    );

    await client.query('COMMIT');

    log.info({
      order_id:          order.id,
      paypal_capture_id: info.paypal_capture_id,
      source:            'webhook_fallback',
    }, '[PAYPAL-WEBHOOK] capture traitée via webhook (capture endpoint avait probablement échoué)');

  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw err;
  } finally {
    client.release();
  }
}

async function _handleCaptureDenied(event) {
  const info = paypal.extractCaptureInfo(event);
  log.warn({ event_id: event.id, capture_id: info?.paypal_capture_id },
    '[PAYPAL-WEBHOOK] capture DENIED');
  try {
    await db.query(
      `INSERT INTO alerts (level, source, message, payload)
       VALUES ('warning', 'paypal_webhook', $1, $2)`,
      [
        `paypal_capture_denied — ${info?.reference_id || event.id}`,
        JSON.stringify({ event_id: event.id, capture_info: info }),
      ]
    );
  } catch (_) { /* non-bloquant */ }
  await _markEventProcessed(event, 'processed', { reason: 'denied_logged' });
}

async function _handleCaptureRefunded(event) {
  log.info({ event_id: event.id },
    '[PAYPAL-WEBHOOK] capture REFUNDED — info enregistrée');
  // Pas d'action métier (le refund a été initié côté Komerce, donc orders est déjà à jour).
  // Si le refund vient d'une dispute auto-resolved côté PayPal, l'admin sera prévenu via dispute event.
  await _markEventProcessed(event, 'processed', { reason: 'refund_acknowledged' });
}

async function _handleDispute(event) {
  log.warn({ event_id: event.id, event_type: event.event_type },
    '[PAYPAL-WEBHOOK] litige reçu');
  try {
    const r = event.resource || {};
    await db.query(
      `INSERT INTO alerts (level, source, message, payload)
       VALUES ('critical', 'paypal_dispute', $1, $2)`,
      [
        `paypal_dispute — ${r.dispute_id || event.id}`,
        JSON.stringify({
          event_id:        event.id,
          dispute_id:      r.dispute_id,
          dispute_state:   r.dispute_state,
          reason:          r.reason,
          dispute_amount:  r.dispute_amount,
          disputed_transactions: r.disputed_transactions,
        }),
      ]
    );
  } catch (e) {
    log.error({ err: e.message }, '[PAYPAL-WEBHOOK] dispute alert insert failed');
  }
  await _markEventProcessed(event, 'processed', { dispute_alert_created: true });
}

async function _markEventProcessed(event, status, payloadSummary = {}) {
  try {
    await db.query(
      `INSERT INTO paypal_events_processed (event_id, event_type, payload_summary, status)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (event_id) DO NOTHING`,
      [event.id, event.event_type, JSON.stringify(payloadSummary), status]
    );
  } catch (e) {
    log.error({ err: e.message, event_id: event.id }, '[PAYPAL-WEBHOOK] markEventProcessed failed');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. POST /api/payments/paypal/refund/:orderId
// ─────────────────────────────────────────────────────────────────────────────
// Refund initié côté admin. Pas accessible aux clients (ils passent par /api/admin/orders/:id/refund).
//
// Body : { amount_eur?, reason? }   (omettre amount_eur = refund total)
// ─────────────────────────────────────────────────────────────────────────────

router.post('/refund/:orderId', authenticate, async (req, res) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin uniquement' });
  }

  const { orderId } = req.params;
  const { amount_eur, reason } = req.body || {};

  const { rows: [order] } = await db.query(
    `SELECT id, reference, total_eur, payment_status, payment_mode, paypal_capture_id
       FROM orders WHERE id = $1`,
    [orderId]
  );
  if (!order)                       return res.status(404).json({ error: 'Commande introuvable' });
  if (!order.paypal_capture_id)     return res.status(409).json({ error: 'Pas de capture PayPal liée à cette commande' });
  if (order.payment_status !== 'paid') return res.status(409).json({ error: 'Commande non payée' });

  try {
    const refundResult = await paypal.refundCapture(order.paypal_capture_id, {
      amountEur: typeof amount_eur === 'number' ? amount_eur : undefined,
      reason:    reason || `Refund commande ${order.reference}`,
      invoiceId: order.reference,
    });

    log.info({
      order_id:    order.id,
      reference:   order.reference,
      refund_id:   refundResult?.id,
      amount_eur:  amount_eur ?? order.total_eur,
      admin_id:    req.user.id,
    }, '[PAYPAL] refund initié');

    return res.json({
      success:    true,
      refund_id:  refundResult?.id,
      status:     refundResult?.status,
      order_id:   order.id,
    });

  } catch (err) {
    log.error({ err: err.message, order_id: order.id }, '[PAYPAL] refund failed');
    return res.status(502).json({ error: 'Refund PayPal échoué', detail: err.message });
  }
});

module.exports = router;
