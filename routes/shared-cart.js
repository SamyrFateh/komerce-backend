/**
 * @komerce-arch
 * @role          shared-cart-http-facade
 * @domain        shared-cart
 * @layer         route
 * @criticality   critical
 * @inputs        public_token, auth_user, estimations, contributions, stripe_webhook, creator_actions
 * @outputs       shared_cart_api, stripe_sessions, notifications, admin_views
 * @depends       services/shared-cart-engine.js, services/shared-cart-estimation-service.js, services/shared-cart-financial-guard.js, services/shared-cart-items-service.js, services/shared-cart-v41-transitions.js, services/shared-cart-queries.js
 * @used-by       server.js, public/boutique/js/b-group-view.js, public/boutique/js/b-share-cart.js, public/boutique/js/b-cart.js
 * @db-read       none
 * @db-write      none
 * @db-txn        delegated_to_shared_cart_services, stripe_webhook_idempotency
 * @doctrine      paiement_seul_acte_engageant, estimations_indicatives, participant_peut_verifier, retour_stripe_boutique, panier_ouvert_ferme
 * @impact-areas  shared-cart, checkout, participant-flow, creator-dashboard, stripe, whatsapp, boutique
 * @version       2026-06
 */

/**
 * KOMERCE — Routes Panier Partagé V4.1
 * ═══════════════════════════════════════════════════════════════════
 *
 * Doctrine V4.1 : machine d'état à 5 statuts visibles (OPEN / CLOSED /
 * AWAITING_CHOICE / ORDERED / CANCELLED) + 2 techniques (expired / archived).
 *
 * Le seul acte engageant est le paiement. Les estimations sont indicatives.
 *
 * Endpoints :
 *
 *   ── Public (lien partagé, pas d'auth) ──
 *   GET    /api/shared-carts/public/:token
 *   GET    /api/shared-carts/public/:token/estimations            ← agrégat public
 *   POST   /api/shared-carts/public/:token/estimations            ← upsert estimation
 *   DELETE /api/shared-carts/public/:token/estimations/:id        ← retrait estimation
 *   GET    /api/shared-carts/public/:token/estimations/by-phone   ← pré-remplir formulaire
 *   POST   /api/shared-carts/public/:token/contributions          ← paiement (statut CLOSED)
 *   POST   /api/shared-carts/public/:token/contributions/cash     ← paiement cash (via router cash)
 *   POST   /api/shared-carts/stripe/webhook                       ← Stripe Checkout webhook
 *
 *   ── Bénéficiaire authentifié ──
 *   POST   /api/shared-carts/from-cart-items
 *   POST   /api/shared-carts/from-basket
 *   POST   /api/shared-carts/from-order
 *   GET    /api/shared-carts/mine
 *   GET    /api/shared-carts/:id
 *   GET    /api/shared-carts/:id/as-cart-items
 *   PUT    /api/shared-carts/:id/items              (statut OPEN, aucun paiement reçu)
 *   POST   /api/shared-carts/:id/close              ← remplace open-settlement
 *   POST   /api/shared-carts/:id/finalize           (Cas A : 100% financé ou délai grâce)
 *   POST   /api/shared-carts/:id/awaiting-choice/complete   ← créateur paie le gap
 *   POST   /api/shared-carts/:id/awaiting-choice/cancel     ← créateur annule
 *   POST   /api/shared-carts/:id/cancel
 *
 *   ── Admin ──
 *   GET    /api/admin/shared-carts
 *   GET    /api/admin/shared-carts/refund-queue
 *   GET    /api/admin/shared-carts/:id
 *   POST   /api/admin/shared-carts/:id/expire
 *   POST   /api/admin/shared-carts/:id/note
 */

'use strict';

const express = require('express');
const stripe  = require('stripe')(process.env.STRIPE_SECRET_KEY);
const engine  = require('../services/shared-cart-engine');
const estimations = require('../services/shared-cart-estimation-service');
const { confirmContributionFromStripeSafely } = require('../services/shared-cart-financial-guard');
const { listManualRefundQueue } = require('../services/shared-cart-refund-queue');
const { cancelSharedCartWithRefunds } = require('../services/cancel-shared-cart-with-refunds');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { authenticateOrCreateGuest } = require('../middleware/auth-guest');
const { fromOrderHandler }           = require('./shared-cart-from-order');
const { updateOpenSharedCartItems, adjustAwaitingCartItems } = require('../services/shared-cart-items-service');
const windowRules = require('../services/shared-cart-v41-transitions');
const log = require('../utils/logger').child({ module: 'shared-cart' });
const { sendTemplateWhatsApp } = require('../services/whatsapp-meta');
const queries = require('../services/shared-cart-queries');
const { cacheCodeForReveal } = require('../services/pickup-secret-service');

const router      = express.Router();
const adminRouter = express.Router();

// ─── Configuration Stripe ─────────────────────────────────────────────
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'http://localhost:3000';
// Retour Stripe — doctrine §4/§6 : on revient TOUJOURS dans la boutique, jamais
// sur une page morte. Le front (b-group-view: consumeSharedPaymentReturn) lit
// ?shared_payment=success|cancel et recharge la vue panier partagé.
const STRIPE_RETURN_BASE = '/boutique/';

// ═══════════════════════════════════════════════════════════════════════
// ── PUBLIC : voir un panier partagé ────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════
router.get('/public/:token', async (req, res, next) => {
  try {
    const data = await engine.getSharedCartForPublic(req.params.token);
    if (!data) return res.status(404).json({ error: 'Panier introuvable' });

    engine.incrementViewCount(req.params.token).catch(err =>
      log.error({ err }, '[shared-cart] view_count fail')
    );

    res.json(data);
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════
// ── PUBLIC : estimations indicatives (statut OPEN uniquement) ──────────
// ═══════════════════════════════════════════════════════════════════════

// Agrégat public : ~38 000 KMF estimés · 4 participants
router.get('/public/:token/estimations', async (req, res, next) => {
  try {
    const data = await estimations.getPublicAggregate(req.params.token);
    res.json(data);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message, code: err.code || undefined });
    next(err);
  }
});

// Upsert estimation (create ou update by phone)
router.post('/public/:token/estimations', async (req, res, next) => {
  try {
    const result = await estimations.upsertEstimation(req.params.token, req.body || {});
    res.status(result.updated ? 200 : 201).json({
      ok: true,
      updated: !!result.updated,
      estimation: result.estimation,
      message: result.updated
        ? 'Estimation mise à jour.'
        : 'Estimation enregistrée.',
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message, code: err.code || undefined });
    next(err);
  }
});

// Retrait d'une estimation (soft-delete par téléphone pour vérification propriété)
router.delete('/public/:token/estimations/:estimationId', async (req, res, next) => {
  try {
    await estimations.deleteEstimation(
      req.params.token,
      req.params.estimationId,
      req.body || {}
    );
    res.json({ ok: true, message: 'Estimation retirée.' });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message, code: err.code || undefined });
    next(err);
  }
});

// Pré-remplissage formulaire si le participant revient
router.get('/public/:token/estimations/by-phone', async (req, res, next) => {
  try {
    const { token } = req.params;
    const phone = req.query.phone;
    if (!phone) return res.status(400).json({ error: 'phone requis', code: 'phone_required' });

    const result = await estimations.getEstimationByPhone(token, phone);
    if (!result) {
      return res.status(404).json({
        error: 'Aucune estimation trouvée pour ce numéro.',
        code: 'estimation_not_found',
      });
    }
    res.json({ estimation: result });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message, code: err.code || undefined });
    next(err);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// ── PUBLIC : payer une contribution (statut CLOSED uniquement) ─────────
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

    // V4.1 : paiement accepté uniquement si statut 'closed'
    // (guard complet effectué dans engine.startContribution via assertCartIsClosed)
    const cartCheck = await queries.getSharedCartByToken(token);
    if (!cartCheck) {
      return res.status(404).json({ error: 'Panier introuvable', code: 'shared_cart_not_found' });
    }

    if (cartCheck.status !== 'closed') {
      const msgMap = {
        open:            "Le panier n'est pas encore en phase de paiement.",
        awaiting_choice: "La fenêtre de paiement est terminée. En attente de décision du créateur.",
        ordered:         'Ce panier a déjà été converti en commande.',
        cancelled:       'Ce panier est annulé.',
        expired:         'Ce panier a expiré.',
        archived:        'Ce panier est archivé.',
      };
      return res.status(409).json({
        error: msgMap[cartCheck.status] || 'Le panier ne peut pas accepter de paiement en ce moment.',
        code: 'cart_not_closed',
        status: cartCheck.status,
      });
    }

    const remainingNow = Math.max(0, Math.round(Number(cartCheck.remaining_kmf) || 0));
    if (remainingNow <= 0) {
      return res.status(409).json({
        error: 'Ce panier est déjà entièrement financé.',
        code: 'already_fully_funded',
        remaining_kmf: 0,
      });
    }

    // Montant payable = min(montant demandé, remaining réel)
    const requestedAmount = Math.round(Number(amount_kmf) || 0);
    const payableAmount   = Math.min(requestedAmount, remainingNow);

    if (payableAmount <= 0) {
      return res.status(409).json({
        error: 'Ce panier est déjà entièrement financé.',
        code: 'already_fully_funded',
        remaining_kmf: 0,
      });
    }

    if (payableAmount < requestedAmount) {
      log.info({ token, requested: requestedAmount, payable: payableAmount, remaining: remainingNow },
        '[contribution] montant plafonné au remaining réel');
    }

    // Invalider les tentatives pending existantes du même participant (idempotence)
    if (contributor_phone) {
      await queries.invalidatePendingContributions(cartCheck.id, contributor_phone);
    }

    const fxRate    = await queries.getFxKmfToEur();
    const amountEur = Math.max(0.5, Math.round(payableAmount * fxRate * 100) / 100);

    const { contribution, cart } = await engine.startContribution(token, {
      name: contributor_name,
      email: contributor_email,
      phone: contributor_phone,
      amountKmf: payableAmount,
      amountPaid: amountEur,
      currency: 'EUR',
      fxRate,
      message,
    });

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
        amount_kmf: String(payableAmount),
      },
      success_url: `${PUBLIC_BASE_URL}${STRIPE_RETURN_BASE}?p=${cart.token}&shared_payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${PUBLIC_BASE_URL}${STRIPE_RETURN_BASE}?p=${cart.token}&shared_payment=cancel`,
      expires_at:  Math.floor(Date.now() / 1000) + 30 * 60,
    });

    await engine.attachStripeSession(contribution.id, session.id);

    res.json({
      checkout_url:        session.url,
      session_id:          session.id,
      contribution_id:     contribution.id,
      payable_amount_kmf:  payableAmount,
      capped:              payableAmount < requestedAmount,
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message, code: err.code || undefined });
    }
    if (err.message && err.message.startsWith('Le panier ne nécessite plus')) {
      return res.status(409).json({ error: err.message, code: 'already_fully_funded', remaining_kmf: 0 });
    }
    if (err.message && (
      err.message.includes('expiré') ||
      err.message.includes("n'accepte plus") ||
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

// ─── Stripe webhook helpers ───────────────────────────────────────────
const isStripeEventProcessed   = queries.isStripeEventProcessed;
const markStripeEventProcessed = queries.markStripeEventProcessed;

// ═══════════════════════════════════════════════════════════════════════
// ── WEBHOOK Stripe (montage spécial dans server.js avec express.raw)
// ═══════════════════════════════════════════════════════════════════════
async function stripeWebhookHandler(req, res) {
  const sig    = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_SHARED_CART_WEBHOOK_SECRET
              || process.env.STRIPE_WEBHOOK_SECRET;
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, secret);
  } catch (err) {
    log.error({ err }, '[shared-cart webhook] signature invalide');
    return res.status(400).send('Webhook signature invalid');
  }

  log.info(`[shared-cart webhook] event ${event.type} reçu`);

  if (await isStripeEventProcessed(event)) {
    return res.json({ received: true, idempotent: true });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        if (session.metadata?.komerce !== 'shared_cart_contribution') {
          await markStripeEventProcessed(event, { ignored: 'not_a_shared_cart_session' });
          return res.json({ received: true, ignored: 'not_a_shared_cart_session' });
        }
        const result = await confirmContributionFromStripeSafely(session);
        if (!result) {
          log.info(`[shared-cart webhook] session ${session.id} déjà traitée ou non confirmée`);
          await markStripeEventProcessed(event, {
            session_id: session.id,
            contribution: 'already_processed_or_not_confirmed',
          });
        } else {
          log.info(`[shared-cart webhook] contribution ${result.contribution.id} confirmée`);
          await markStripeEventProcessed(event, {
            session_id:      session.id,
            shared_cart_id:  result.cart?.id,
            contribution_id: result.contribution?.id,
            status:          'confirmed',
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
        await markStripeEventProcessed(event, { session_id: session.id, status: 'expired' });
        break;
      }
      default:
        await markStripeEventProcessed(event, { ignored: 'unsupported_event_type' });
        break;
    }
    res.json({ received: true });
  } catch (err) {
    log.error('[shared-cart webhook] traitement échoué', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
}

// ═══════════════════════════════════════════════════════════════════════
// ── BÉNÉFICIAIRE AUTHENTIFIÉ ─────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════

// Création depuis les items du localStorage boutique (mobile, guest possible)
router.post('/from-cart-items', authenticateOrCreateGuest, async (req, res, next) => {
  try {
    const {
      cart_items, title, message, expiration_days, target_date, delivery_relay_id,
      share_mode,
    } = req.body || {};

    if (!Array.isArray(cart_items) || cart_items.length === 0) {
      return res.status(400).json({ error: 'cart_items requis (panier vide)' });
    }
    if (!req.user?.id) {
      return res.status(401).json({
        error: 'Authentification requise. Indiquez votre numéro de téléphone (tracking_phone).',
      });
    }

    // Résolution target_date : priorité au champ explicite, fallback expiration_days
    const resolvedTargetDate = target_date || (
      expiration_days
        ? new Date(Date.now() + Number(expiration_days) * 86400 * 1000).toISOString().slice(0, 10)
        : null
    );

    const result = await engine.createSharedCartFromCartItems(req.user.id, cart_items, {
      title, message,
      targetDate: resolvedTargetDate,
      deliveryRelayId: delivery_relay_id,
      shareMode: share_mode,
    });

    res.json({
      shared_cart_id: result.sharedCart.id,
      token:          result.token,
      share_url:      `${PUBLIC_BASE_URL}/boutique/?p=${result.token}`,
      total_kmf:      result.sharedCart.total_kmf_snapshot,
      target_date:    result.sharedCart.target_date || null,
      status:         result.sharedCart.status,
      payment_window_ends_at: result.sharedCart.payment_window_ends_at || null,
      share_mode:     result.sharedCart.status === 'closed' ? 'ready_to_pay' : 'needs_validation',
      items_count:    result.items.length,
      clear_local_cart: result.clearLocalCart === true,
    });

    // S3-02 — Notification WhatsApp créateur (post-commit, best-effort)
    // Template : shared_cart_created — {{1}} URL du lien partagé
    setImmediate(async () => {
      try {
        const trackingPhone = req.user?.tracking_phone || req.user?.phone;
        if (!trackingPhone) return;
        const shareUrl = `${PUBLIC_BASE_URL}/boutique/?p=${result.token}`;
        const notif = await sendTemplateWhatsApp({
          to: trackingPhone,
          templateName: 'shared_cart_created',
          components: [{ type: 'body', parameters: [{ type: 'text', text: shareUrl }] }],
        });
        if (!notif.success && !notif.skipped) {
          log.warn({ phone: trackingPhone, error: notif.error }, '[S3-02] creator creation notification failed');
        }
      } catch (err) {
        log.error({ err }, '[S3-02] creator notification failed');
      }
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

// Création depuis un basket DB existant
router.post('/from-basket', authenticate, async (req, res, next) => {
  try {
    const { basket_id, title, message, expiration_days, target_date, delivery_relay_id } = req.body || {};
    if (!basket_id) return res.status(400).json({ error: 'basket_id requis' });

    const resolvedTargetDate = target_date || (
      expiration_days
        ? new Date(Date.now() + Number(expiration_days) * 86400 * 1000).toISOString().slice(0, 10)
        : null
    );

    const result = await engine.createSharedCartFromBasket(req.user.id, basket_id, {
      title, message,
      targetDate: resolvedTargetDate,
      deliveryRelayId: delivery_relay_id,
    });

    res.json({
      shared_cart_id: result.sharedCart.id,
      token:          result.token,
      share_url:      `${PUBLIC_BASE_URL}/boutique/?p=${result.token}`,
      total_kmf:      result.sharedCart.total_kmf_snapshot,
      target_date:    result.sharedCart.target_date || null,
      items_count:    result.items.length,
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

// LOT 4 : création depuis commande existante
router.post('/from-order', authenticate, fromOrderHandler);

router.get('/mine', authenticate, async (req, res, next) => {
  try {
    const carts = await engine.listMySharedCarts(req.user.id);
    res.json({
      carts: carts.map(c => ({
        ...c,
        share_url: `${PUBLIC_BASE_URL}/boutique/?p=${c.token}`,
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
      share_url: `${PUBLIC_BASE_URL}/boutique/?p=${data.cart.token}`,
    });
  } catch (err) { next(err); }
});

// Recharge panier créateur depuis le snapshot (pour localStorage boutique)
router.get('/:id/as-cart-items', authenticate, async (req, res, next) => {
  try {
    const data = await engine.getSharedCartForOwner(req.params.id, req.user.id);
    if (!data) return res.status(404).json({ error: 'Panier introuvable' });

    const cartItems = data.items.map(it => ({
      product_id:       it.product_id,
      quantity:         Number(it.quantity),
      unit_price_kmf:   Number(it.unit_price_kmf_snapshot),
      product_name:     it.product_name_snapshot,
      product_image:    it.product_image_snapshot,
      product_category: it.product_category_snapshot,
      line_total_kmf:   Number(it.line_total_kmf_snapshot),
    }));

    res.json({
      shared_cart_id: data.cart.id,
      title:          data.cart.title,
      total_kmf:      Number(data.cart.total_kmf_snapshot),
      cart_items:     cartItems,
    });
  } catch (err) { next(err); }
});

// S2-06 — Modifier les articles du panier (statut OPEN, aucun paiement reçu)
router.put('/:id/items', authenticate, async (req, res, next) => {
  try {
    const { cart_items } = req.body;
    if (!Array.isArray(cart_items) || cart_items.length === 0) {
      return res.status(400).json({ error: 'cart_items requis', code: 'cart_items_required' });
    }

    const { cart, items } = await updateOpenSharedCartItems(req.params.id, req.user.id, cart_items);
    res.json({ ok: true, cart, items, items_count: items.length });

    // Notifications WhatsApp aux participants ayant laissé une estimation
    // Template : shared_cart_items_updated — {{1}} prénom {{2}} titre {{3}} total KMF {{4}} URL
    setImmediate(async () => {
      try {
        const participants = await queries.getParticipantsWithEstimation(req.params.id);

        const shareUrl = `${PUBLIC_BASE_URL}/boutique/?p=${cart.token}`;
        const title    = cart.title || 'Panier groupe';
        const total    = String(Math.round(Number(cart.total_kmf_snapshot) || 0));

        for (const p of participants) {
          const result = await sendTemplateWhatsApp({
            to: p.phone,
            templateName: 'shared_cart_items_updated',
            components: [{
              type: 'body',
              parameters: [
                { type: 'text', text: p.first_name || 'Participant' },
                { type: 'text', text: title },
                { type: 'text', text: total },
                { type: 'text', text: shareUrl },
              ],
            }],
          });
          if (!result.success && !result.skipped) {
            log.warn({ phone: p.phone, error: result.error }, '[S2-06] items_update_notification_failed');
            await queries.logEvent(
              req.params.id, 'items_update_notification_failed', 'system', null,
              { phone: p.phone, error: result.error }
            ).catch(() => {});
          }
        }
        log.info({ cart_id: req.params.id, count: participants.length },
          '[S2-06] items update WhatsApp notifications attempted');
      } catch (err) {
        log.error({ err, cart_id: req.params.id }, '[S2-06] items update notification batch failed');
      }
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message, code: err.code || undefined });
    next(err);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// ── FERMETURE DU PANIER (remplace open-settlement) ─────────────────────
// ── OPEN → CLOSED, ouvre la fenêtre de paiement 48h ───────────────────
// ═══════════════════════════════════════════════════════════════════════
router.post('/:id/close', authenticate, async (req, res, next) => {
  try {
    const cart = await engine.closeCart(req.params.id, req.user.id);
    res.json({
      ok:      true,
      label:   'panier_ferme',
      message: 'Le panier est fermé. Les participants peuvent maintenant payer pendant 48 heures.',
      cart,
    });

    // Notifications WhatsApp aux participants ayant une estimation
    // Template : shared_cart_payment_open — {{1}} prénom {{2}} titre {{3}} total KMF {{4}} URL
    setImmediate(async () => {
      try {
        const estimants = await queries.getEstimants(req.params.id);

        const shareUrl = `${PUBLIC_BASE_URL}/boutique/?p=${cart.token}`;
        const title    = cart.title || 'Panier groupe';
        const total    = String(Math.round(Number(cart.total_kmf_snapshot) || 0));

        for (const e of estimants) {
          const result = await sendTemplateWhatsApp({
            to: e.phone,
            templateName: 'shared_cart_payment_open',
            components: [{
              type: 'body',
              parameters: [
                { type: 'text', text: e.first_name || 'Participant' },
                { type: 'text', text: title },
                { type: 'text', text: total },
                { type: 'text', text: shareUrl },
              ],
            }],
          });
          if (!result.success && !result.skipped) {
            log.warn({ phone: e.phone, error: result.error }, '[close] payment_open_notification_failed');
            await queries.logEvent(
              req.params.id, 'payment_open_notification_failed', 'system', null,
              { phone: e.phone, error: result.error }
            ).catch(() => {});
          }
        }
        log.info({ cart_id: req.params.id, count: estimants.length },
          '[close] payment_open WhatsApp notifications attempted');
      } catch (err) {
        log.error({ err, cart_id: req.params.id }, '[close] payment_open notification batch failed');
      }
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message, code: err.code || undefined });
    next(err);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// ── FINALISATION Cas A ─────────────────────────────────────────────────
// ── Panier 100% financé, après délai de grâce (ou appel manuel) ────────
// ═══════════════════════════════════════════════════════════════════════
router.post('/:id/finalize', authenticate, async (req, res, next) => {
  try {
    const result = await engine.convertSharedCartToOrder(
      req.params.id, req.user.id,
      {
        deliveryRelayId:  req.body?.delivery_relay_id,
        acceptStockIssues: !!req.body?.accept_stock_issues,
      }
    );
    res.json({
      order_id:           result.order.id,
      order_reference:    result.order.reference,
      prepaid_kmf:        result.prepaidKmf,
      remaining_cash_kmf: result.remainingCashKmf,
    });

    // Code de retrait Cas A (100% financé) : cache pour révélation one-shot,
    // après commit (comme Stripe/PayPal/wallet_full_payment). Null en Cas B.
    if (result.pickupCodeToCache) {
      cacheCodeForReveal(result.order.id, result.pickupCodeToCache)
        .catch(e => log.error({ err: e, cart_id: req.params.id }, '[finalize] cacheCodeForReveal error:'));
    }

    // LOY-01 — Hook fidélité gros panier (créateur du panier partagé, fire-and-forget)
    if (result.order?.id) {
      try {
        const loyaltyService = require('../services/loyalty-service');
        loyaltyService.handleOrderConfirmed({ orderId: result.order.id })
          .then(r => { if (r && !r.skipped) log.info({ orderId: result.order.id }, '[loyalty] hook OK:', r); })
          .catch(e => log.warn({ err: e }, '[loyalty] hook error:'));
      } catch (_) { /* non-bloquant */ }
    }

    // B-03 — Notification WhatsApp "commande confirmée" → tous les participants
    // ayant contribué (status = 'paid').
    // Template : shared_cart_order_confirmed — {{1}} prénom {{2}} titre {{3}} référence commande
    setImmediate(async () => {
      try {
        const contributors = await queries.getPaidContributors(req.params.id);

        const title = result.sharedCart?.title || 'Panier groupe';
        const orderRef = result.order.reference;

        for (const c of contributors) {
          const notif = await sendTemplateWhatsApp({
            to: c.phone,
            templateName: 'shared_cart_order_confirmed',
            components: [{
              type: 'body',
              parameters: [
                { type: 'text', text: c.first_name || 'Participant' },
                { type: 'text', text: title },
                { type: 'text', text: orderRef },
              ],
            }],
          });
          if (!notif.success && !notif.skipped) {
            log.warn({ phone: c.phone, error: notif.error }, '[finalize] order_confirmed_notification_failed');
            await queries.logEvent(req.params.id, 'order_confirmed_notification_failed', 'system', null, { phone: c.phone, error: notif.error }).catch(() => {});
          }
        }
        log.info({ cart_id: req.params.id, count: contributors.length },
          '[finalize] order_confirmed WhatsApp notifications attempted');
      } catch (err) {
        log.error({ err, cart_id: req.params.id }, '[finalize] order_confirmed notification batch failed');
      }
    });
  } catch (err) {
    try {
      const parsed = JSON.parse(err.message);
      if (parsed.code === 'stock_issues') return res.status(409).json({ ...parsed });
    } catch (_) {}

    if (err.message.includes('paiement') || err.message.includes('closed')) {
      return res.status(409).json({ error: err.message, code: 'cart_not_finalizable' });
    }
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

// ═══════════════════════════════════════════════════════════════════════
// ── AWAITING_CHOICE : actions créateur (Cas B) ─────────────────────────
// ═══════════════════════════════════════════════════════════════════════

/**
 * POST /:id/awaiting-choice/complete
 *
 * Le créateur complète le gap lui-même : crée une Stripe session
 * pour le montant remaining_kmf. Il paie comme n'importe quel participant.
 * Si la contribution amène le total à 100%, le cron passe à ORDERED.
 */
router.post('/:id/awaiting-choice/complete', authenticate, async (req, res, next) => {
  try {
    const cart = await queries.getCartForAwaitingChoice(req.params.id);

    if (!cart) return res.status(404).json({ error: 'Panier introuvable' });
    if (cart.beneficiary_user_id !== req.user.id) {
      return res.status(403).json({ error: 'Accès refusé' });
    }
    if (cart.status !== 'awaiting_choice') {
      return res.status(409).json({
        error: `Action non disponible en statut "${cart.status}". Le panier doit être en AWAITING_CHOICE.`,
        code: 'invalid_status',
        status: cart.status,
      });
    }

    const remainingNow = Math.max(0, Math.round(Number(cart.remaining_kmf) || 0));
    if (remainingNow <= 0) {
      return res.status(409).json({ error: 'Le panier est déjà entièrement financé.', code: 'already_fully_funded' });
    }

    const fxRate    = await queries.getFxKmfToEur();
    const amountEur = Math.max(0.5, Math.round(remainingNow * fxRate * 100) / 100);

    // Le créateur contribue via le flux standard (utilise son email et identité)
    const { contribution } = await engine.startContribution(cart.token, {
      name:      req.user.full_name || req.user.name || 'Créateur',
      email:     req.user.email,
      phone:     req.user.phone || req.user.tracking_phone || null,
      amountKmf: remainingNow,
      amountPaid: amountEur,
      currency:   'EUR',
      fxRate,
      message:    'Complément créateur',
    }, { allowAwaitingChoice: true });

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: req.user.email,
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: {
            name: `Complément panier — ${cart.title || 'Panier de ' + cart.beneficiary_name_snapshot}`,
            description: `Gap restant : ${remainingNow} KMF`,
          },
          unit_amount: Math.round(amountEur * 100),
        },
        quantity: 1,
      }],
      metadata: {
        komerce:         'shared_cart_contribution',
        shared_cart_id:  cart.id,
        contribution_id: contribution.id,
        token:           cart.token,
        amount_kmf:      String(remainingNow),
      },
      success_url: `${PUBLIC_BASE_URL}${STRIPE_RETURN_BASE}?p=${cart.token}&shared_payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${PUBLIC_BASE_URL}${STRIPE_RETURN_BASE}?p=${cart.token}&shared_payment=cancel`,
      expires_at:  Math.floor(Date.now() / 1000) + 30 * 60,
    });

    await engine.attachStripeSession(contribution.id, session.id);

    res.json({
      checkout_url:     session.url,
      session_id:       session.id,
      contribution_id:  contribution.id,
      gap_kmf:          remainingNow,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message, code: err.code || undefined });
    next(err);
  }
});

/**
 * POST /:id/awaiting-choice/cancel
 *
 * Le créateur annule le panier depuis l'état AWAITING_CHOICE.
 * Même mécanique que /cancel — guard inclusif dans cancelSharedCart.
 */
// Cas B — Ajuster : le créateur édite la liste (réduction), nouvelle fenêtre 48h.
// Doctrine : la plateforme ne choisit jamais les articles à retirer.
router.post('/:id/awaiting-choice/adjust', authenticate, async (req, res, next) => {
  try {
    const result = await adjustAwaitingCartItems(req.params.id, req.user.id, req.body?.cart_items || []);
    res.json({
      ok: true,
      label: 'panier_ajuste_paiement_rouvert',
      message: result.cart.remaining_kmf > 0
        ? 'Panier ajusté. Une nouvelle fenêtre de paiement de 48 heures est ouverte.'
        : 'Panier ajusté et entièrement couvert par les paiements reçus. Vous pouvez finaliser la commande.',
      cart: result.cart,
      items: result.items,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message, code: err.code || undefined });
    next(err);
  }
});

// Prolongation créateur — décision produit juin 2026 (amendement V4.2 doctrine) :
// une SEULE prolongation de 48h, uniquement pendant la fenêtre (statut CLOSED).
// Pas de réglage à la création : action contextuelle quand la réalité l'exige.
router.post('/:id/extend-window', authenticate, async (req, res, next) => {
  try {
    const cart = await queries.getCartByOwner(req.params.id, req.user.id);
    if (!cart) return res.status(404).json({ error: 'Panier introuvable ou non autorisé' });

    if (!windowRules.canExtendWindow(cart)) {
      return res.status(409).json({
        error: cart.status !== 'closed'
          ? `Prolongation impossible (statut : ${cart.status}). La fenêtre doit être en cours.`
          : 'La fenêtre a déjà été prolongée une fois.',
        code: 'extension_not_allowed',
      });
    }

    const updated = await queries.extendPaymentWindow(req.params.id, windowRules.WINDOW_EXTENSION_HOURS);
    if (!updated) return res.status(409).json({ error: 'Prolongation impossible (statut modifié entre-temps)', code: 'extension_not_allowed' });

    await queries.logEvent(req.params.id, 'payment_window_extended', 'user', req.user.id, {
      added_hours: windowRules.WINDOW_EXTENSION_HOURS,
      new_payment_window_ends_at: updated.payment_window_ends_at,
    });

    res.json({
      ok: true,
      message: 'Fenêtre de paiement prolongée de 48 heures.',
      cart: updated,
    });
  } catch (err) { next(err); }
});

router.post('/:id/awaiting-choice/cancel', authenticate, async (req, res, next) => {
  try {
    const { cart, refunds } = await cancelSharedCartWithRefunds(req.params.id, req.user.id, req.body?.reason);
    res.json({ ok: true, cart, refunds });
  } catch (err) {
    if (err.message.includes('Impossible') || err.message.includes('introuvable')) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

// Annulation depuis n'importe quel statut autorisé (OPEN / CLOSED / AWAITING_CHOICE)
router.post('/:id/cancel', authenticate, async (req, res, next) => {
  try {
    const { cart, refunds } = await cancelSharedCartWithRefunds(req.params.id, req.user.id, req.body?.reason);
    res.json({ ok: true, cart, refunds });
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
    const rows = await queries.adminListCarts({ status: req.query.status, user_id: req.query.user_id });
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
    const detail = await queries.adminGetCartDetail(req.params.id);
    if (!detail) return res.status(404).json({ error: 'Panier introuvable' });
    res.json(detail);
  } catch (err) { next(err); }
});

// Force-expiration admin (statuts V4.1)
adminRouter.post('/:id/expire', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const cart = await queries.adminExpireCart(req.params.id);
    if (!cart) return res.status(400).json({
      error: 'Statut incompatible. Seuls les paniers open, closed ou awaiting_choice peuvent être expirés.',
    });

    await queries.logEvent(req.params.id, 'cart_expired', 'admin', req.user.id, { manual: true, reason: req.body?.reason });
    res.json({ ok: true, cart });
  } catch (err) { next(err); }
});

// Admin — étendre la date cible d'un panier OPEN (support/SAV)
adminRouter.post('/:id/extend', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const days = Math.max(1, Math.min(90, Number(req.body?.days) || 7));
    const cart = await queries.adminExtendCartDate(req.params.id, days);
    if (!cart) return res.status(404).json({ error: 'Panier introuvable ou non ouvert' });

    await queries.logEvent(req.params.id, 'admin_extended', 'admin', req.user.id, { added_days: days, reason: req.body?.reason });
    res.json({ ok: true, cart });
  } catch (err) { next(err); }
});

adminRouter.post('/:id/note', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const note = req.body?.note;
    if (!note || !note.trim()) return res.status(400).json({ error: 'Note requise' });

    await queries.logEvent(req.params.id, 'admin_note_added', 'admin', req.user.id, { note });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = { router, adminRouter, stripeWebhookHandler };