/**
 * KOMERCE — Routes Panier Partagé (MVP Niveau 1)
 * ═══════════════════════════════════════════════════════════════════
 *
 * Doctrine v4 : panier ouvert = engagements indicatifs uniquement.
 * Un participant ne peut payer qu'après l'action créateur "Passer au règlement".
 *
 * Endpoints :
 *
 *   ── Public (lien partagé, pas d'auth) ──
 *   GET    /api/shared-carts/public/:token
 *   POST   /api/shared-carts/public/:token/contributions
 *   POST   /api/shared-carts/stripe/webhook   (Stripe Checkout webhook)
 *
 *   ── Bénéficiaire authentifié ──
 *   POST   /api/shared-carts/from-basket
 *   GET    /api/shared-carts/mine
 *   GET    /api/shared-carts/:id
 *   POST   /api/shared-carts/:id/open-settlement
 *   POST   /api/shared-carts/:id/finalize
 *   POST   /api/shared-carts/:id/cancel
 *
 *   ── Admin ──
 *   GET    /api/admin/shared-carts
 *   GET    /api/admin/shared-carts/refund-queue
 *   GET    /api/admin/shared-carts/:id
 *   POST   /api/admin/shared-carts/:id/expire
 *   POST   /api/admin/shared-carts/:id/extend
 *   POST   /api/admin/shared-carts/:id/note
 */

'use strict';

const express = require('express');
const stripe  = require('stripe')(process.env.STRIPE_SECRET_KEY);
const db      = require('../db');
const engine  = require('../services/shared-cart-engine');
const settlement = require('../services/shared-cart-v4-settlement');
const { confirmContributionFromStripeSafely } = require('../services/shared-cart-financial-guard');
const { listManualRefundQueue } = require('../services/shared-cart-refund-queue');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { authenticateOrCreateGuest } = require('../middleware/auth-guest');
const { fromOrderHandler }           = require('./shared-cart-from-order'); // LOT 4: route from-order
const log = require('../utils/logger').child({ module: 'shared-cart' });

const router      = express.Router();
const adminRouter = express.Router();

// ─── Configuration Stripe ─────────────────────────────────────────────
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'http://localhost:3000';
const STRIPE_RETURN_SUCCESS = '/cart/shared/success';
const STRIPE_RETURN_CANCEL  = '/cart/shared/cancel';

// Conversion KMF → EUR pour Stripe (Stripe ne supporte pas KMF nativement)
// On stocke une estimation conservatrice. À calibrer avec finance_config.
const DEFAULT_FX_KMF_TO_EUR = 1 / 491.97; // ~0.00203 EUR/KMF

async function getFxKmfToEur() {
  try {
    const { rows } = await db.query(
      `SELECT eur_to_kmf FROM finance_config WHERE id = 1 LIMIT 1`
    );
    if (rows.length && rows[0].eur_to_kmf) {
      return 1 / Number(rows[0].eur_to_kmf);
    }
  } catch (e) { /* fallback */ }
  return DEFAULT_FX_KMF_TO_EUR;
}

// ═══════════════════════════════════════════════════════════════════════
// ── PUBLIC : voir un panier partagé ────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════
router.get('/public/:token', async (req, res, next) => {
  try {
    const data = await engine.getSharedCartForPublic(req.params.token);
    if (!data) return res.status(404).json({ error: 'Panier introuvable' });

    // Tracker la vue (best-effort, n'échoue pas silencieusement)
    engine.incrementViewCount(req.params.token).catch(err =>
      log.error('[shared-cart] view_count fail', err.message)
    );

    res.json(data);
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════
// ── PUBLIC : payer une contribution après passage au règlement ─────────
// ═══════════════════════════════════════════════════════════════════════
router.post('/public/:token/contributions', async (req, res, next) => {
  try {
    const { token } = req.params;
    const {
      amount_kmf,
      contributor_name,
      contributor_email,
      contributor_phone,
      message,
    } = req.body || {};

    if (!amount_kmf || !contributor_name || !contributor_email) {
      return res.status(400).json({
        error: 'Champs requis : amount_kmf, contributor_name, contributor_email',
      });
    }

    // Doctrine v4 : un panier ouvert accepte des engagements, pas des paiements.
    // Le créateur doit d'abord "Passer au règlement".
    await settlement.assertCanAcceptParticipantPaymentByToken(token);

    // Conversion KMF → EUR pour Stripe
    const fxRate = await getFxKmfToEur();
    const amountEur = Math.max(0.5, Math.round(Number(amount_kmf) * fxRate * 100) / 100);

    // 1. Créer la contribution en pending
    const { contribution, cart } = await engine.startContribution(token, {
      name: contributor_name,
      email: contributor_email,
      phone: contributor_phone,
      amountKmf: amount_kmf,
      amountPaid: amountEur,
      currency: 'EUR',
      fxRate,
      message,
    });

    // 2. Créer la Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: contributor_email,
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: {
            name: `Paiement Komerce — ${cart.title || 'Panier de ' + cart.beneficiary_name_snapshot}`,
            description: `Règlement du panier partagé de ${cart.beneficiary_name_snapshot}`,
          },
          unit_amount: Math.round(amountEur * 100),
        },
        quantity: 1,
      }],
      metadata: {
        komerce: 'shared_cart_contribution',
        shared_cart_id: cart.id,
        contribution_id: contribution.id,
        token: cart.token,
        amount_kmf: String(amount_kmf),
      },
      success_url: `${PUBLIC_BASE_URL}${STRIPE_RETURN_SUCCESS}?token=${cart.token}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${PUBLIC_BASE_URL}${STRIPE_RETURN_CANCEL}?token=${cart.token}`,
      // Expiration de la session Stripe (30 min, défaut)
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
    });

    // 3. Lier la session au contribution row
    await engine.attachStripeSession(contribution.id, session.id);

    res.json({
      checkout_url: session.url,
      session_id: session.id,
      contribution_id: contribution.id,
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message, code: err.code || undefined });
    }
    if (err.message && err.message.startsWith('Le panier ne nécessite plus')) {
      return res.status(400).json({ error: err.message, code: 'amount_exceeds_remaining' });
    }
    if (err.message && (
      err.message.includes('expiré') ||
      err.message.includes('n\'accepte plus') ||
      err.message.includes('introuvable') ||
      err.message.includes('minimum') ||
      err.message.includes('maximum') ||
      err.message.includes('invalide')
    )) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});


// ─── Stripe webhook idempotency helpers ─────────────────────────────────
async function isStripeEventProcessed(event) {
  try {
    const { rows } = await db.query(
      'SELECT 1 FROM stripe_events_processed WHERE stripe_event_id = $1',
      [event.id]
    );
    return rows.length > 0;
  } catch (e) {
    log.warn('[shared-cart webhook] stripe_events_processed unavailable:', e.message);
    return false;
  }
}

async function markStripeEventProcessed(event, payloadSummary = {}) {
  try {
    await db.query(
      `INSERT INTO stripe_events_processed (stripe_event_id, event_type, payload_summary)
       VALUES ($1, $2, $3)
       ON CONFLICT (stripe_event_id) DO NOTHING`,
      [event.id, event.type, JSON.stringify(payloadSummary || {})]
    );
  } catch (e) {
    log.warn('[shared-cart webhook] mark event processed failed:', e.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// ── WEBHOOK Stripe (montage spécial dans server.js avec express.raw)
// ═══════════════════════════════════════════════════════════════════════
// ATTENTION : cette route est mountée à part dans server.js avec
// `express.raw({ type: 'application/json' })` AVANT le express.json()
async function stripeWebhookHandler(req, res) {
  const sig = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_SHARED_CART_WEBHOOK_SECRET
              || process.env.STRIPE_WEBHOOK_SECRET;
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, secret);
  } catch (err) {
    log.error('[shared-cart webhook] signature invalide :', err.message);
    return res.status(400).send(`Webhook signature invalid: ${err.message}`);
  }

  log.info(`[shared-cart webhook] event ${event.type} reçu`);

  if (await isStripeEventProcessed(event)) {
    return res.json({ received: true, idempotent: true });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        // Filtrer : ne traiter QUE nos sessions (metadata.komerce='shared_cart_contribution')
        if (session.metadata?.komerce !== 'shared_cart_contribution') {
          await markStripeEventProcessed(event, { ignored: 'not_a_shared_cart_session' });
          return res.json({ received: true, ignored: 'not_a_shared_cart_session' });
        }
        const result = await confirmContributionFromStripeSafely(session);
        if (!result) {
          log.info(`[shared-cart webhook] session ${session.id} déjà traitée, non confirmée ou payée tardivement`);
          await markStripeEventProcessed(event, {
            session_id: session.id,
            contribution: 'already_processed_not_confirmed_or_not_counted',
          });
        } else {
          log.info(`[shared-cart webhook] contribution ${result.contribution.id} confirmée`);
          await markStripeEventProcessed(event, {
            session_id: session.id,
            shared_cart_id: result.cart?.id,
            contribution_id: result.contribution?.id,
            status: 'confirmed',
          });
        }
        break;
      }
      case 'checkout.session.expired': {
        const session = event.data.object;
        if (session.metadata?.komerce !== 'shared_cart_contribution') {
          return res.json({ received: true, ignored: 'not_a_shared_cart_session' });
        }
        await engine.markContributionFailed(session.id, 'session_expired');
        await markStripeEventProcessed(event, {
          session_id: session.id,
          status: 'expired',
        });
        break;
      }
      default:
        // Ignorer les autres events
        await markStripeEventProcessed(event, { ignored: 'unsupported_event_type' });
        break;
    }
    res.json({ received: true });
  } catch (err) {
    log.error('[shared-cart webhook] traitement échoué', err);
    // 500 pour que Stripe retry
    res.status(500).json({ error: 'Webhook processing failed' });
  }
}

// ═══════════════════════════════════════════════════════════════════════
// ── BÉNÉFICIAIRE AUTHENTIFIÉ ─────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════

// Refresh 28/04/26 — Création depuis les items du localStorage boutique.
// Le panier mobile boutique n'est PAS sync avec une table baskets DB —
// il vit en localStorage. Cette route accepte les items en clair et
// utilise authenticateOrCreateGuest pour créer un user à la volée si
// l'utilisateur n'est pas connecté (sur la base de tracking_phone).
//
// Différence avec /from-basket : pas besoin de basket_id, juste les items.
// La route ré-vérifie les prix côté DB (jamais confiance au client).
router.post('/from-cart-items', authenticateOrCreateGuest, async (req, res, next) => {
  try {
    const {
      cart_items, title, message, expiration_days, delivery_relay_id,
    } = req.body || {};

    if (!Array.isArray(cart_items) || cart_items.length === 0) {
      return res.status(400).json({ error: 'cart_items requis (panier vide)' });
    }
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        error: 'Authentification requise. Indiquez votre numéro de téléphone (tracking_phone) pour créer un panier famille.',
      });
    }

    const result = await engine.createSharedCartFromCartItems(req.user.id, cart_items, {
      title, message,
      expirationDays: expiration_days,
      deliveryRelayId: delivery_relay_id,
    });

    res.json({
      shared_cart_id: result.sharedCart.id,
      token: result.token,
      share_url: `${PUBLIC_BASE_URL}/cart/shared/${result.token}`,
      total_kmf: result.sharedCart.total_kmf_snapshot,
      expires_at: result.sharedCart.expires_at,
      items_count: result.items.length,
    });
  } catch (err) {
    if (err.message.includes('Limite atteinte') ||
        err.message.includes('vide') ||
        err.message.includes('valide') ||
        err.message.includes('introuvable')) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

// LOT 4: Créer un panier partagé depuis une commande existante (pending)
router.post('/from-order', authenticate, fromOrderHandler);

router.post('/from-basket', authenticate, async (req, res, next) => {
  try {
    const { basket_id, title, message, expiration_days, delivery_relay_id } = req.body || {};
    if (!basket_id) return res.status(400).json({ error: 'basket_id requis' });

    const result = await engine.createSharedCartFromBasket(req.user.id, basket_id, {
      title, message,
      expirationDays: expiration_days,
      deliveryRelayId: delivery_relay_id,
    });

    res.json({
      shared_cart_id: result.sharedCart.id,
      token: result.token,
      share_url: `${PUBLIC_BASE_URL}/cart/shared/${result.token}`,
      total_kmf: result.sharedCart.total_kmf_snapshot,
      expires_at: result.sharedCart.expires_at,
      items_count: result.items.length,
    });
  } catch (err) {
    if (err.message.includes('Limite atteinte') ||
        err.message.includes('vide') ||
        err.message.includes('introuvable')) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

router.get('/mine', authenticate, async (req, res, next) => {
  try {
    const carts = await engine.listMySharedCarts(req.user.id);
    res.json({
      carts: carts.map(c => ({
        ...c,
        share_url: `${PUBLIC_BASE_URL}/cart/shared/${c.token}`,
      })),
    });
  } catch (err) { next(err); }
});

router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const data = await engine.getSharedCartForOwner(req.params.id, req.user.id);
    if (!data) return res.status(404).json({ error: 'Panier introuvable' });
    res.json({
      ...data,
      share_url: `${PUBLIC_BASE_URL}/cart/shared/${data.cart.token}`,
    });
  } catch (err) { next(err); }
});

router.post('/:id/open-settlement', authenticate, async (req, res, next) => {
  try {
    const cart = await settlement.openSettlement(req.params.id, req.user.id, {
      settlement_window_hours: req.body?.settlement_window_hours,
    });
    res.json({
      ok: true,
      label: 'panier_en_reglement',
      message: 'Le panier est passé au règlement. Les participants peuvent maintenant payer.',
      cart,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message, code: err.code || undefined });
    next(err);
  }
});

router.post('/:id/finalize', authenticate, async (req, res, next) => {
  try {
    const result = await engine.convertSharedCartToOrder(
      req.params.id, req.user.id,
      {
        deliveryRelayId: req.body?.delivery_relay_id,
        acceptStockIssues: !!req.body?.accept_stock_issues,
      }
    );
    res.json({
      order_id: result.order.id,
      order_reference: result.order.reference,
      prepaid_kmf: result.prepaidKmf,
      remaining_cash_kmf: result.remainingCashKmf,
    });
  } catch (err) {
    // Détection erreur stock structurée
    try {
      const parsed = JSON.parse(err.message);
      if (parsed.code === 'stock_issues') {
        return res.status(409).json({ ...parsed });
      }
    } catch (_) {}

    if (err.message.includes('expiré') ||
        err.message.includes('introuvable') ||
        err.message.includes('Impossible') ||
        err.message.includes('déjà') ||
        err.message.includes('requis')) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

router.post('/:id/cancel', authenticate, async (req, res, next) => {
  try {
    const cart = await engine.cancelSharedCart(req.params.id, req.user.id, req.body?.reason);
    res.json({ ok: true, cart });
  } catch (err) {
    if (err.message.includes('Impossible') || err.message.includes('introuvable')) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// ── ADMIN ─────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════

adminRouter.get('/', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const conditions = [];
    const params = [];
    let i = 1;

    if (req.query.status) {
      conditions.push(`sc.status = $${i++}`);
      params.push(req.query.status);
    }
    if (req.query.user_id) {
      conditions.push(`sc.beneficiary_user_id = $${i++}`);
      params.push(req.query.user_id);
    }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const { rows } = await db.query(
      `SELECT sc.*,
              u.full_name AS beneficiary_full_name,
              u.email AS beneficiary_email,
              (SELECT COUNT(*) FROM shared_cart_contributions
                WHERE shared_cart_id = sc.id AND status = 'paid')::int AS contributors_count,
              (SELECT COUNT(*) FROM shared_cart_contributions
                WHERE shared_cart_id = sc.id)::int AS contributions_total_count
         FROM shared_carts sc
         LEFT JOIN users u ON u.id = sc.beneficiary_user_id
         ${where}
        ORDER BY sc.created_at DESC
        LIMIT 200`,
      params
    );
    res.json({ carts: rows, count: rows.length });
  } catch (err) { next(err); }
});

adminRouter.get('/refund-queue', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const data = await listManualRefundQueue({
      limit: req.query?.limit,
      offset: req.query?.offset,
    });
    res.json(data);
  } catch (err) { next(err); }
});

adminRouter.get('/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { rows: cartRows } = await db.query(
      `SELECT * FROM shared_carts WHERE id = $1`, [req.params.id]
    );
    if (!cartRows.length) return res.status(404).json({ error: 'Panier introuvable' });

    const [items, contribs, events] = await Promise.all([
      db.query(`SELECT * FROM shared_cart_items WHERE shared_cart_id = $1 ORDER BY created_at`, [req.params.id]),
      db.query(`SELECT * FROM shared_cart_contributions WHERE shared_cart_id = $1 ORDER BY created_at DESC`, [req.params.id]),
      db.query(`SELECT * FROM shared_cart_events WHERE shared_cart_id = $1 ORDER BY created_at DESC LIMIT 100`, [req.params.id]),
    ]);

    res.json({
      cart: cartRows[0],
      items: items.rows,
      contributions: contribs.rows,
      events: events.rows,
    });
  } catch (err) { next(err); }
});

adminRouter.post('/:id/expire', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `UPDATE shared_carts SET status = 'expired', updated_at = NOW()
        WHERE id = $1 AND status IN ('active', 'partially_funded')
       RETURNING *`,
      [req.params.id]
    );
    if (!rows.length) return res.status(400).json({ error: 'Statut incompatible' });

    await db.query(
      `INSERT INTO shared_cart_events (shared_cart_id, event_type, actor_type, actor_id, payload)
         VALUES ($1, 'cart_expired', 'admin', $2, $3)`,
      [req.params.id, req.user.id, { manual: true, reason: req.body?.reason }]
    );
    res.json({ ok: true, cart: rows[0] });
  } catch (err) { next(err); }
});

adminRouter.post('/:id/extend', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const days = Math.max(1, Math.min(90, Number(req.body?.days) || 7));
    const { rows } = await db.query(
      `UPDATE shared_carts
          SET expires_at = expires_at + ($1 || ' days')::INTERVAL,
              updated_at = NOW()
        WHERE id = $2
       RETURNING *`,
      [String(days), req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Panier introuvable' });

    await db.query(
      `INSERT INTO shared_cart_events (shared_cart_id, event_type, actor_type, actor_id, payload)
         VALUES ($1, 'admin_extended', 'admin', $2, $3)`,
      [req.params.id, req.user.id, { added_days: days, reason: req.body?.reason }]
    );
    res.json({ ok: true, cart: rows[0] });
  } catch (err) { next(err); }
});

adminRouter.post('/:id/note', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const note = req.body?.note;
    if (!note || !note.trim()) return res.status(400).json({ error: 'Note requise' });

    await db.query(
      `INSERT INTO shared_cart_events (shared_cart_id, event_type, actor_type, actor_id, payload)
         VALUES ($1, 'admin_note_added', 'admin', $2, $3)`,
      [req.params.id, req.user.id, { note }]
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = { router, adminRouter, stripeWebhookHandler };
