/**
 * @komerce-arch
 * @role          shared-cart-http-facade
 * @domain        shared-cart
 * @layer         route
 * @criticality   critical
 * @inputs        public_token, auth_user, creator_actions
 * @outputs       shared_cart_api, admin_views
 * @depends       services/shared-cart-engine.js, services/shared-cart-items-service.js, services/shared-cart-queries.js, middleware/soft-auth.js
 * @used-by       server.js, public/boutique/js/b-group-view.js, public/boutique/js/b-share-cart.js, public/boutique/js/b-cart.js
 * @db-read       none
 * @db-write      none
 * @db-txn        delegated_to_shared_cart_services
 * @doctrine      domaine_minimal_boutique_first, participant_achete_individuellement, panier_ouvert_ferme
 * @impact-areas  shared-cart, checkout, participant-flow, creator-dashboard, boutique
 * @version       2026-08
 */

/**
 * KOMERCE — Routes Panier Partagé (Boutique First, domaine minimal)
 * ═══════════════════════════════════════════════════════════════════
 *
 * Doctrine Boutique First (migrations 123 + 124) : la liste partagée n'a
 * plus de checkout propre. Le seul acte engageant reste le paiement,
 * mais il passe désormais TOUJOURS par POST /api/orders — un participant
 * réclame un article de liste en l'achetant normalement, en référençant
 * shared_cart_item_id dans sa ligne de commande. La rareté est arbitrée
 * par un index unique en base (migration 123), pas ici.
 *
 * La liste partagée n'a plus que 3 statuts : open / closed / cancelled.
 *
 * Endpoints :
 *
 *   ── Public (lien partagé, pas d'auth) ──
 *   GET    /api/shared-carts/public/:token
 *
 *   ── Créateur authentifié ──
 *   POST   /api/shared-carts/from-cart-items
 *   POST   /api/shared-carts/from-basket
 *   GET    /api/shared-carts/mine
 *   GET    /api/shared-carts/:id
 *   GET    /api/shared-carts/:id/as-cart-items
 *   PUT    /api/shared-carts/:id/items    (statut OPEN uniquement)
 *   POST   /api/shared-carts/:id/close    (OPEN → CLOSED)
 *   POST   /api/shared-carts/:id/cancel   (OPEN|CLOSED → CANCELLED)
 *
 *   ── Admin ──
 *   GET    /api/admin/shared-carts
 *   GET    /api/admin/shared-carts/:id
 *   POST   /api/admin/shared-carts/:id/expire   (force-annulation)
 *   POST   /api/admin/shared-carts/:id/note
 *
 * SUPPRIMÉ vs V4.1 (voir migrations 123/124 pour le détail doctrine) :
 *   estimations (table shared_cart_estimations supprimée), contributions
 *   + webhook Stripe (table shared_cart_contributions supprimée),
 *   from-order, finalize, awaiting-choice/complete, awaiting-choice/adjust,
 *   awaiting-choice/cancel, extend-window, admin refund-queue, admin extend.
 */

'use strict';

const express = require('express');
const engine  = require('../services/shared-cart-engine');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { authenticateOrCreateGuest } = require('../middleware/auth-guest');
const { softAuthenticate } = require('../middleware/soft-auth');
const { updateOpenSharedCartItems, addSharedCartItem, removeSharedCartItem } = require('../services/shared-cart-items-service');
const log = require('../utils/logger').child({ module: 'shared-cart' });
const { sendTemplateWhatsApp } = require('../services/whatsapp-meta');
const queries = require('../services/shared-cart-queries');

const router      = express.Router();
const adminRouter = express.Router();

const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'http://localhost:3000';

// ═══════════════════════════════════════════════════════════════════════
// ── PUBLIC : voir un panier partagé ────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════
router.get('/public/:token', softAuthenticate, async (req, res, next) => {
  try {
    const data = await engine.getSharedCartForPublic(req.params.token, req.user?.id);
    if (!data) return res.status(404).json({ error: 'Panier introuvable' });
    res.json(data);
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════
// ── CRÉATEUR AUTHENTIFIÉ ─────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════

// Création depuis les items du localStorage boutique (mobile, guest possible)
router.post('/from-cart-items', authenticateOrCreateGuest, async (req, res, next) => {
  try {
    const { cart_items, title, message, delivery_relay_id } = req.body || {};

    if (!Array.isArray(cart_items) || cart_items.length === 0) {
      return res.status(400).json({ error: 'cart_items requis (panier vide)' });
    }
    if (!req.user?.id) {
      return res.status(401).json({
        error: 'Authentification requise. Indiquez votre numéro de téléphone (tracking_phone).',
      });
    }

    const result = await engine.createSharedCartFromCartItems(req.user.id, cart_items, {
      title, message,
      deliveryRelayId: delivery_relay_id,
    });

    res.json({
      shared_cart_id:    result.sharedCart.id,
      token:              result.token,
      share_url:          `${PUBLIC_BASE_URL}/boutique/?p=${result.token}`,
      status:             result.sharedCart.status,
      items_count:        result.items.length,
      clear_local_cart:   result.clearLocalCart === true,
    });

    // S3-02 — Notification WhatsApp créateur (post-commit, best-effort)
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
    const { basket_id, title, message, delivery_relay_id } = req.body || {};
    if (!basket_id) return res.status(400).json({ error: 'basket_id requis' });

    const result = await engine.createSharedCartFromBasket(req.user.id, basket_id, {
      title, message,
      deliveryRelayId: delivery_relay_id,
    });

    res.json({
      shared_cart_id: result.sharedCart.id,
      token:          result.token,
      share_url:      `${PUBLIC_BASE_URL}/boutique/?p=${result.token}`,
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
      total_kmf:      Number(data.cart.total_kmf),
      cart_items:     cartItems,
    });
  } catch (err) { next(err); }
});

// S2-06 — Modifier les articles du panier (statut OPEN uniquement)
// Sémantique historique inchangée : remplace la liste entière. Conservé
// tel quel — Contrat API §5 point 4, option A. Sera retiré quand il n'aura
// plus d'utilité, pas réinterprété.
router.put('/:id/items', authenticate, async (req, res, next) => {
  try {
    const { cart_items } = req.body;
    if (!Array.isArray(cart_items) || cart_items.length === 0) {
      return res.status(400).json({ error: 'cart_items requis', code: 'cart_items_required' });
    }

    const { cart, items } = await updateOpenSharedCartItems(req.params.id, req.user.id, cart_items);
    res.json({ ok: true, cart, items, items_count: items.length });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message, code: err.code || undefined });
    next(err);
  }
});

// Une intention, un appel, écriture immédiate (Invariant 20). Capacité
// nouvelle, pas une réinterprétation de PUT /:id/items ci-dessus.
router.post('/:id/items', authenticate, async (req, res, next) => {
  try {
    const { product_id, quantity } = req.body || {};
    const { cart, item } = await addSharedCartItem(req.params.id, req.user.id, product_id, quantity);
    res.json({ ok: true, cart, item });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message, code: err.code || undefined });
    next(err);
  }
});

// Confirmation exigée côté client avant l'appel (Invariant 21) ; côté
// serveur, exécution immédiate dès réception, sans confirmation
// supplémentaire.
router.delete('/:id/items/:itemId', authenticate, async (req, res, next) => {
  try {
    const { cart } = await removeSharedCartItem(req.params.id, req.user.id, req.params.itemId);
    res.json({ ok: true, cart });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message, code: err.code || undefined });
    next(err);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// ── FERMETURE DU PANIER : OPEN → CLOSED ─────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════
router.post('/:id/close', authenticate, async (req, res, next) => {
  try {
    const cart = await engine.closeCart(req.params.id, req.user.id);
    res.json({
      ok:      true,
      label:   'panier_ferme',
      message: "Le panier est fermé. Les articles restent réclamables via l'achat individuel.",
      cart,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message, code: err.code || undefined });
    next(err);
  }
});

// Annulation depuis OPEN ou CLOSED. Aucun remboursement ici : aucune
// contribution n'est jamais stockée sur la liste (voir shared-cart-lifecycle.js).
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
    const rows = await queries.adminListCarts({ status: req.query.status, user_id: req.query.user_id });
    res.json({ carts: rows, count: rows.length });
  } catch (err) { next(err); }
});

adminRouter.get('/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const detail = await queries.adminGetCartDetail(req.params.id);
    if (!detail) return res.status(404).json({ error: 'Panier introuvable' });
    res.json(detail);
  } catch (err) { next(err); }
});

// Force-annulation admin (open/closed → cancelled — voir note shared-cart-queries.js)
adminRouter.post('/:id/expire', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const cart = await queries.adminExpireCart(req.params.id);
    if (!cart) return res.status(400).json({
      error: 'Statut incompatible. Seuls les paniers open ou closed peuvent être annulés.',
    });

    await queries.logEvent(req.params.id, 'cart_cancelled', 'admin', req.user.id, { manual: true, reason: req.body?.reason });
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

module.exports = { router, adminRouter };
