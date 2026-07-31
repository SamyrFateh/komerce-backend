'use strict';

/**
 * tests/unit/shared-cart-creator-route.test.js
 *
 * Tests des routes BÉNÉFICIAIRE AUTHENTIFIÉ + ADMIN de routes/shared-cart.js
 * (complète shared-cart-public-route.test.js → boucle le lot A1).
 *
 * Couverture :
 *   POST /from-cart-items        : 400 vide, 401 sans user, succès + notif WhatsApp,
 *                                   erreurs métier → 400, erreur inconnue → next
 *   POST /from-basket            : 400 sans basket_id, succès, erreurs métier → 400
 *   POST /from-order             : délègue à fromOrderHandler (mocké)
 *   GET  /mine                   : succès (share_url calculé)
 *   GET  /:id                    : 404, succès
 *   GET  /:id/as-cart-items      : 404, succès (mapping snapshot)
 *   PUT  /:id/items              : 400 si cart_items vide, succès + notif, erreur custom status
 *   POST /:id/close              : succès + notif, erreur custom status
 *   POST /:id/finalize           : succès + hook loyalty + notif, stock_issues → 409,
 *                                   erreurs paiement/closed → 409, erreurs diverses → 400, next
 *   POST /:id/awaiting-choice/complete : 404, 403, 409 statut invalide, 409 déjà financé,
 *                                   succès → session Stripe, erreur custom
 *   POST /:id/awaiting-choice/adjust   : succès, erreur custom
 *   POST /:id/extend-window      : 404, 409 non extensible, succès, 409 course modifiée
 *   POST /:id/awaiting-choice/cancel   : succès, erreur métier → 400
 *   POST /:id/cancel             : succès, erreur métier → 400
 *
 *   adminRouter (montée sur /api/admin/shared-carts) :
 *   GET  /                       : succès (liste + count)
 *   GET  /refund-queue           : succès
 *   GET  /:id                    : 404, succès
 *   POST /:id/expire             : 400 statut incompatible, succès
 *   POST /:id/extend             : 404, succès (clamp days)
 *   POST /:id/note               : 400 note manquante, succès
 */

jest.mock('stripe', () => {
  return jest.fn(() => ({
    checkout: { sessions: { create: jest.fn() } },
    webhooks: { constructEvent: jest.fn() },
  }));
});

jest.mock('../../services/shared-cart-engine', () => ({
  getSharedCartForPublic: jest.fn(),
  incrementViewCount: jest.fn().mockResolvedValue(undefined),
  startContribution: jest.fn(),
  attachStripeSession: jest.fn(),
  markContributionFailed: jest.fn(),
  createSharedCartFromCartItems: jest.fn(),
  createSharedCartFromBasket: jest.fn(),
  listMySharedCarts: jest.fn(),
  getSharedCartForOwner: jest.fn(),
  closeCart: jest.fn(),
  convertSharedCartToOrder: jest.fn(),
}));

jest.mock('../../services/shared-cart-estimation-service', () => ({
  getPublicAggregate: jest.fn(),
  upsertEstimation: jest.fn(),
  deleteEstimation: jest.fn(),
  getEstimationByPhone: jest.fn(),
}));

jest.mock('../../services/shared-cart-financial-guard', () => ({
  confirmContributionFromStripeSafely: jest.fn(),
}));

jest.mock('../../services/shared-cart-refund-queue', () => ({
  listManualRefundQueue: jest.fn(),
}));

jest.mock('../../services/cancel-shared-cart-with-refunds', () => ({
  cancelSharedCartWithRefunds: jest.fn(),
}));

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = req.user || { id: 'user-1', email: 'u@test.com' }; next(); },
  requireAdmin: (req, _res, next) => next(),
}));

jest.mock('../../middleware/auth-guest', () => ({
  authenticateOrCreateGuest: (req, _res, next) => { req.user = req.user || { id: 'user-1' }; next(); },
}));

jest.mock('../../routes/shared-cart-from-order', () => ({
  fromOrderHandler: (req, res) => res.json({ from: 'order' }),
}));

jest.mock('../../services/shared-cart-items-service', () => ({
  updateOpenSharedCartItems: jest.fn(),
  adjustAwaitingCartItems: jest.fn(),
}));

jest.mock('../../services/shared-cart-v41-transitions', () => ({
  canExtendWindow: jest.fn(),
  WINDOW_EXTENSION_HOURS: 48,
}));

jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
  forModule: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

jest.mock('../../services/whatsapp-meta', () => ({
  sendTemplateWhatsApp: jest.fn().mockResolvedValue({ success: true }),
}));

jest.mock('../../services/loyalty-service', () => ({
  handleOrderConfirmed: jest.fn().mockResolvedValue({ skipped: true }),
}));

jest.mock('../../services/shared-cart-queries', () => ({
  getSharedCartByToken: jest.fn(),
  invalidatePendingContributions: jest.fn().mockResolvedValue(undefined),
  getFxKmfToEur: jest.fn().mockResolvedValue(0.002),
  isStripeEventProcessed: jest.fn(),
  markStripeEventProcessed: jest.fn().mockResolvedValue(undefined),
  getParticipantsWithEstimation: jest.fn().mockResolvedValue([]),
  getEstimants: jest.fn().mockResolvedValue([]),
  getPaidContributors: jest.fn().mockResolvedValue([]),
  getCartForAwaitingChoice: jest.fn(),
  getCartByOwner: jest.fn(),
  extendPaymentWindow: jest.fn(),
  logEvent: jest.fn().mockResolvedValue(undefined),
  adminListCarts: jest.fn(),
  adminGetCartDetail: jest.fn(),
  adminExpireCart: jest.fn(),
  adminExtendCartDate: jest.fn(),
}));

const stripeFactory = require('stripe');
const engine = require('../../services/shared-cart-engine');
const refundQueue = require('../../services/shared-cart-refund-queue');
const cancelWithRefunds = require('../../services/cancel-shared-cart-with-refunds');
const itemsService = require('../../services/shared-cart-items-service');
const windowRules = require('../../services/shared-cart-v41-transitions');
const whatsapp = require('../../services/whatsapp-meta');
const loyaltyService = require('../../services/loyalty-service');
const queries = require('../../services/shared-cart-queries');

const express = require('express');
const request = require('supertest');

let app;
let stripeInstance;

beforeEach(() => {
  jest.clearAllMocks();
  stripeInstance = {
    checkout: { sessions: { create: jest.fn() } },
    webhooks: { constructEvent: jest.fn() },
  };
  stripeFactory.mockReturnValue(stripeInstance);

  app = express();
  app.use(express.json());

  jest.isolateModules(() => {
    const { router, adminRouter } = require('../../routes/shared-cart');
    app.use('/api/shared-carts', router);
    app.use('/api/admin/shared-carts', adminRouter);
  });
  app.use((err, req, res, _next) => {
    res.status(500).json({ error: err.message });
  });
});

// Petit utilitaire pour laisser passer les notifications fire-and-forget (setImmediate)
function flush() {
  return new Promise(resolve => setImmediate(resolve));
}

// ═══════════════════════════════════════════════════════════════════════
describe('POST /from-cart-items', () => {
  it('400 si cart_items vide', async () => {
    const res = await request(app).post('/api/shared-carts/from-cart-items').send({ cart_items: [] });
    expect(res.status).toBe(400);
  });

  it('succès → crée le panier + notif WhatsApp fire-and-forget', async () => {
    engine.createSharedCartFromCartItems.mockResolvedValue({
      sharedCart: { id: 'c1', total_kmf_snapshot: 5000, status: 'open', target_date: null },
      token: 'tok1',
      items: [{ id: 'it1' }],
      clearLocalCart: true,
    });
    const res = await request(app).post('/api/shared-carts/from-cart-items').send({
      cart_items: [{ product_id: 'p1', quantity: 1 }],
    });
    expect(res.status).toBe(200);
    expect(res.body.shared_cart_id).toBe('c1');
    expect(res.body.share_mode).toBe('needs_validation');
    expect(res.body.clear_local_cart).toBe(true);

    await flush();
    expect(whatsapp.sendTemplateWhatsApp).not.toHaveBeenCalled(); // pas de tracking_phone fourni
  });

  it('succès avec tracking_phone → notif WhatsApp envoyée', async () => {
    engine.createSharedCartFromCartItems.mockResolvedValue({
      sharedCart: { id: 'c1', total_kmf_snapshot: 5000, status: 'closed' },
      token: 'tok1',
      items: [],
      clearLocalCart: false,
    });

    // On surcharge req.user via un middleware custom avant authenticateOrCreateGuest mocké
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { id: 'user-1', tracking_phone: '+269111' }; next(); });
    jest.isolateModules(() => {
      const { router } = require('../../routes/shared-cart');
      app.use('/api/shared-carts', router);
    });
    app.use((err, req, res, _next) => res.status(500).json({ error: err.message }));

    const res = await request(app).post('/api/shared-carts/from-cart-items').send({
      cart_items: [{ product_id: 'p1', quantity: 1 }],
    });
    expect(res.status).toBe(200);

    await flush();
    expect(whatsapp.sendTemplateWhatsApp).toHaveBeenCalledWith(expect.objectContaining({
      to: '+269111', templateName: 'shared_cart_created',
    }));
  });

  it('erreur métier ("vide") → 400', async () => {
    engine.createSharedCartFromCartItems.mockRejectedValue(new Error('Panier vide'));
    const res = await request(app).post('/api/shared-carts/from-cart-items').send({
      cart_items: [{ product_id: 'p1', quantity: 1 }],
    });
    expect(res.status).toBe(400);
  });

  it('erreur inconnue → next(err) → 500', async () => {
    engine.createSharedCartFromCartItems.mockRejectedValue(new Error('panne totalement imprévue'));
    const res = await request(app).post('/api/shared-carts/from-cart-items').send({
      cart_items: [{ product_id: 'p1', quantity: 1 }],
    });
    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('POST /from-basket', () => {
  it('400 si basket_id manquant', async () => {
    const res = await request(app).post('/api/shared-carts/from-basket').send({});
    expect(res.status).toBe(400);
  });

  it('succès', async () => {
    engine.createSharedCartFromBasket.mockResolvedValue({
      sharedCart: { id: 'c1', total_kmf_snapshot: 7000, target_date: '2026-08-01' },
      token: 'tok1',
      items: [{ id: 'it1' }, { id: 'it2' }],
    });
    const res = await request(app).post('/api/shared-carts/from-basket').send({ basket_id: 'b1' });
    expect(res.status).toBe(200);
    expect(res.body.items_count).toBe(2);
  });

  it('erreur métier ("introuvable") → 400', async () => {
    engine.createSharedCartFromBasket.mockRejectedValue(new Error('Basket introuvable'));
    const res = await request(app).post('/api/shared-carts/from-basket').send({ basket_id: 'b1' });
    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('POST /from-order', () => {
  it('délègue à fromOrderHandler', async () => {
    const res = await request(app).post('/api/shared-carts/from-order').send({ order_id: 'o1' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ from: 'order' });
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('GET /mine', () => {
  it('succès → ajoute share_url', async () => {
    engine.listMySharedCarts.mockResolvedValue([{ id: 'c1', token: 'tok1' }]);
    const res = await request(app).get('/api/shared-carts/mine');
    expect(res.status).toBe(200);
    expect(res.body.carts[0].share_url).toMatch(/tok1$/);
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('GET /:id', () => {
  it('404 si introuvable', async () => {
    engine.getSharedCartForOwner.mockResolvedValue(null);
    const res = await request(app).get('/api/shared-carts/c1');
    expect(res.status).toBe(404);
  });

  it('succès', async () => {
    engine.getSharedCartForOwner.mockResolvedValue({ cart: { id: 'c1', token: 'tok1' }, items: [] });
    const res = await request(app).get('/api/shared-carts/c1');
    expect(res.status).toBe(200);
    expect(res.body.share_url).toMatch(/tok1$/);
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('GET /:id/as-cart-items', () => {
  it('404 si introuvable', async () => {
    engine.getSharedCartForOwner.mockResolvedValue(null);
    const res = await request(app).get('/api/shared-carts/c1/as-cart-items');
    expect(res.status).toBe(404);
  });

  it('succès → mappe le snapshot', async () => {
    engine.getSharedCartForOwner.mockResolvedValue({
      cart: { id: 'c1', title: 'Panier X', total_kmf_snapshot: '5000' },
      items: [{
        product_id: 'p1', quantity: '2', unit_price_kmf_snapshot: '1000',
        product_name_snapshot: 'Riz', product_image_snapshot: 'img.jpg',
        product_category_snapshot: 'epicerie', line_total_kmf_snapshot: '2000',
      }],
    });
    const res = await request(app).get('/api/shared-carts/c1/as-cart-items');
    expect(res.status).toBe(200);
    expect(res.body.cart_items[0]).toEqual({
      product_id: 'p1', quantity: 2, unit_price_kmf: 1000,
      product_name: 'Riz', product_image: 'img.jpg',
      product_category: 'epicerie', line_total_kmf: 2000,
    });
    expect(res.body.total_kmf).toBe(5000);
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('PUT /:id/items', () => {
  it('400 si cart_items vide', async () => {
    const res = await request(app).put('/api/shared-carts/c1/items').send({ cart_items: [] });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('cart_items_required');
  });

  it('succès → ok + notif participants', async () => {
    itemsService.updateOpenSharedCartItems.mockResolvedValue({
      cart: { id: 'c1', token: 'tok1', title: 'Panier X', total_kmf_snapshot: 6000 },
      items: [{ id: 'it1' }],
    });
    queries.getParticipantsWithEstimation.mockResolvedValue([{ phone: '+269333', first_name: 'Ali' }]);

    const res = await request(app).put('/api/shared-carts/c1/items').send({ cart_items: [{ product_id: 'p1', quantity: 1 }] });
    expect(res.status).toBe(200);
    expect(res.body.items_count).toBe(1);

    await flush();
    expect(whatsapp.sendTemplateWhatsApp).toHaveBeenCalledWith(expect.objectContaining({
      to: '+269333', templateName: 'shared_cart_items_updated',
    }));
  });

  it('erreur custom (status) → propagée', async () => {
    const err = new Error('paiement déjà reçu'); err.status = 409; err.code = 'payment_already_received';
    itemsService.updateOpenSharedCartItems.mockRejectedValue(err);
    const res = await request(app).put('/api/shared-carts/c1/items').send({ cart_items: [{ product_id: 'p1', quantity: 1 }] });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('payment_already_received');
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('POST /:id/close', () => {
  it('succès → ok + notif estimants', async () => {
    engine.closeCart.mockResolvedValue({ id: 'c1', token: 'tok1', title: 'Panier X', total_kmf_snapshot: 6000 });
    queries.getEstimants.mockResolvedValue([{ phone: '+269444', first_name: 'Soeuf' }]);

    const res = await request(app).post('/api/shared-carts/c1/close').send();
    expect(res.status).toBe(200);
    expect(res.body.label).toBe('panier_ferme');

    await flush();
    expect(whatsapp.sendTemplateWhatsApp).toHaveBeenCalledWith(expect.objectContaining({
      to: '+269444', templateName: 'shared_cart_payment_open',
    }));
  });

  it('erreur custom (status) → propagée', async () => {
    const err = new Error('panier vide'); err.status = 400;
    engine.closeCart.mockRejectedValue(err);
    const res = await request(app).post('/api/shared-carts/c1/close').send();
    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('POST /:id/finalize', () => {
  it('succès → hook loyalty + notif contributeurs', async () => {
    engine.convertSharedCartToOrder.mockResolvedValue({
      order: { id: 'o1', reference: 'KOM-1' },
      prepaidKmf: 5000,
      remainingCashKmf: 0,
      sharedCart: { title: 'Panier X' },
    });
    queries.getPaidContributors.mockResolvedValue([{ phone: '+269555', first_name: 'Nour' }]);

    const res = await request(app).post('/api/shared-carts/c1/finalize').send();
    expect(res.status).toBe(200);
    expect(res.body.order_id).toBe('o1');

    await flush();
    expect(loyaltyService.handleOrderConfirmed).toHaveBeenCalledWith({ orderId: 'o1' });
    expect(whatsapp.sendTemplateWhatsApp).toHaveBeenCalledWith(expect.objectContaining({
      to: '+269555', templateName: 'shared_cart_order_confirmed',
    }));
  });

  it('stock_issues (JSON dans message) → 409', async () => {
    const err = new Error(JSON.stringify({ code: 'stock_issues', issues: [{ product_id: 'p1' }] }));
    engine.convertSharedCartToOrder.mockRejectedValue(err);
    const res = await request(app).post('/api/shared-carts/c1/finalize').send();
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('stock_issues');
  });

  it('erreur "paiement"/"closed" → 409 cart_not_finalizable', async () => {
    engine.convertSharedCartToOrder.mockRejectedValue(new Error('Le panier doit être closed pour finaliser'));
    const res = await request(app).post('/api/shared-carts/c1/finalize').send();
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('cart_not_finalizable');
  });

  it('erreur "introuvable" → 400', async () => {
    engine.convertSharedCartToOrder.mockRejectedValue(new Error('Panier introuvable'));
    const res = await request(app).post('/api/shared-carts/c1/finalize').send();
    expect(res.status).toBe(400);
  });

  it('erreur inconnue → next(err) → 500', async () => {
    engine.convertSharedCartToOrder.mockRejectedValue(new Error('panne totalement imprévue'));
    const res = await request(app).post('/api/shared-carts/c1/finalize').send();
    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('POST /:id/awaiting-choice/complete', () => {
  it('404 si panier introuvable', async () => {
    queries.getCartForAwaitingChoice.mockResolvedValue(null);
    const res = await request(app).post('/api/shared-carts/c1/awaiting-choice/complete').send();
    expect(res.status).toBe(404);
  });

  it('403 si pas le bénéficiaire', async () => {
    queries.getCartForAwaitingChoice.mockResolvedValue({ id: 'c1', beneficiary_user_id: 'other-user', status: 'awaiting_choice' });
    const res = await request(app).post('/api/shared-carts/c1/awaiting-choice/complete').send();
    expect(res.status).toBe(403);
  });

  it('409 si statut différent de awaiting_choice', async () => {
    queries.getCartForAwaitingChoice.mockResolvedValue({ id: 'c1', beneficiary_user_id: 'user-1', status: 'closed' });
    const res = await request(app).post('/api/shared-carts/c1/awaiting-choice/complete').send();
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('invalid_status');
  });

  it('409 si déjà entièrement financé', async () => {
    queries.getCartForAwaitingChoice.mockResolvedValue({
      id: 'c1', beneficiary_user_id: 'user-1', status: 'awaiting_choice', remaining_kmf: 0,
    });
    const res = await request(app).post('/api/shared-carts/c1/awaiting-choice/complete').send();
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('already_fully_funded');
  });

  it('succès → crée la session Stripe pour le gap', async () => {
    queries.getCartForAwaitingChoice.mockResolvedValue({
      id: 'c1', token: 'tok1', beneficiary_user_id: 'user-1', status: 'awaiting_choice',
      remaining_kmf: 5000, title: 'Panier X', beneficiary_name_snapshot: 'Fatima',
    });
    engine.startContribution.mockResolvedValue({ contribution: { id: 'contrib-1' } });
    stripeInstance.checkout.sessions.create.mockResolvedValue({ id: 'sess_1', url: 'https://stripe.test/sess_1' });

    const res = await request(app).post('/api/shared-carts/c1/awaiting-choice/complete').send();
    expect(res.status).toBe(200);
    expect(res.body.checkout_url).toBe('https://stripe.test/sess_1');
    expect(res.body.gap_kmf).toBe(5000);
    expect(engine.attachStripeSession).toHaveBeenCalledWith('contrib-1', 'sess_1');
  });

  it('erreur custom (status) → propagée', async () => {
    queries.getCartForAwaitingChoice.mockResolvedValue({
      id: 'c1', token: 'tok1', beneficiary_user_id: 'user-1', status: 'awaiting_choice', remaining_kmf: 5000,
    });
    const err = new Error('Stripe indisponible'); err.status = 503;
    engine.startContribution.mockRejectedValue(err);
    const res = await request(app).post('/api/shared-carts/c1/awaiting-choice/complete').send();
    expect(res.status).toBe(503);
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('POST /:id/awaiting-choice/adjust', () => {
  it('succès', async () => {
    itemsService.adjustAwaitingCartItems.mockResolvedValue({
      cart: { id: 'c1', remaining_kmf: 1000 },
      items: [{ id: 'it1' }],
    });
    const res = await request(app).post('/api/shared-carts/c1/awaiting-choice/adjust').send({ cart_items: [] });
    expect(res.status).toBe(200);
    expect(res.body.label).toBe('panier_ajuste_paiement_rouvert');
    expect(res.body.message).toMatch(/nouvelle fenêtre/);
  });

  it('succès → couvert intégralement → message finalisable', async () => {
    itemsService.adjustAwaitingCartItems.mockResolvedValue({
      cart: { id: 'c1', remaining_kmf: 0 },
      items: [],
    });
    const res = await request(app).post('/api/shared-carts/c1/awaiting-choice/adjust').send({ cart_items: [] });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/finaliser/);
  });

  it('erreur custom (status) → propagée', async () => {
    const err = new Error('non autorisé'); err.status = 403;
    itemsService.adjustAwaitingCartItems.mockRejectedValue(err);
    const res = await request(app).post('/api/shared-carts/c1/awaiting-choice/adjust').send({ cart_items: [] });
    expect(res.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('POST /:id/extend-window', () => {
  it('404 si panier introuvable ou non autorisé', async () => {
    queries.getCartByOwner.mockResolvedValue(null);
    const res = await request(app).post('/api/shared-carts/c1/extend-window').send();
    expect(res.status).toBe(404);
  });

  it('409 si extension non autorisée (statut != closed)', async () => {
    queries.getCartByOwner.mockResolvedValue({ id: 'c1', status: 'open' });
    windowRules.canExtendWindow.mockReturnValue(false);
    const res = await request(app).post('/api/shared-carts/c1/extend-window').send();
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('extension_not_allowed');
    expect(res.body.error).toMatch(/statut/);
  });

  it('409 si déjà prolongé (statut closed)', async () => {
    queries.getCartByOwner.mockResolvedValue({ id: 'c1', status: 'closed' });
    windowRules.canExtendWindow.mockReturnValue(false);
    const res = await request(app).post('/api/shared-carts/c1/extend-window').send();
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/déjà été prolongée/);
  });

  it('succès', async () => {
    queries.getCartByOwner.mockResolvedValue({ id: 'c1', status: 'closed' });
    windowRules.canExtendWindow.mockReturnValue(true);
    queries.extendPaymentWindow.mockResolvedValue({ id: 'c1', payment_window_ends_at: '2026-07-03T00:00:00Z' });

    const res = await request(app).post('/api/shared-carts/c1/extend-window').send();
    expect(res.status).toBe(200);
    expect(res.body.cart.payment_window_ends_at).toBe('2026-07-03T00:00:00Z');
    expect(queries.logEvent).toHaveBeenCalledWith('c1', 'payment_window_extended', 'user', 'user-1', expect.any(Object));
  });

  it('409 si statut modifié entre-temps (extendPaymentWindow renvoie null)', async () => {
    queries.getCartByOwner.mockResolvedValue({ id: 'c1', status: 'closed' });
    windowRules.canExtendWindow.mockReturnValue(true);
    queries.extendPaymentWindow.mockResolvedValue(null);

    const res = await request(app).post('/api/shared-carts/c1/extend-window').send();
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('extension_not_allowed');
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('POST /:id/awaiting-choice/cancel', () => {
  it('succès', async () => {
    cancelWithRefunds.cancelSharedCartWithRefunds.mockResolvedValue({ cart: { id: 'c1', status: 'cancelled' }, refunds: [] });
    const res = await request(app).post('/api/shared-carts/c1/awaiting-choice/cancel').send({ reason: 'changement avis' });
    expect(res.status).toBe(200);
    expect(res.body.cart.status).toBe('cancelled');
  });

  it('erreur métier ("Impossible") → 400', async () => {
    cancelWithRefunds.cancelSharedCartWithRefunds.mockRejectedValue(new Error('Impossible d\'annuler ce panier'));
    const res = await request(app).post('/api/shared-carts/c1/awaiting-choice/cancel').send();
    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('POST /:id/cancel', () => {
  it('succès', async () => {
    cancelWithRefunds.cancelSharedCartWithRefunds.mockResolvedValue({ cart: { id: 'c1', status: 'cancelled' }, refunds: [{ id: 'r1' }] });
    const res = await request(app).post('/api/shared-carts/c1/cancel').send();
    expect(res.status).toBe(200);
    expect(res.body.refunds).toHaveLength(1);
  });

  it('erreur métier ("introuvable") → 400', async () => {
    cancelWithRefunds.cancelSharedCartWithRefunds.mockRejectedValue(new Error('Panier introuvable'));
    const res = await request(app).post('/api/shared-carts/c1/cancel').send();
    expect(res.status).toBe(400);
  });

  it('erreur inconnue → next(err) → 500', async () => {
    cancelWithRefunds.cancelSharedCartWithRefunds.mockRejectedValue(new Error('panne totalement imprévue'));
    const res = await request(app).post('/api/shared-carts/c1/cancel').send();
    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// ── ADMIN ─────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════
describe('GET /api/admin/shared-carts', () => {
  it('succès → liste + count', async () => {
    queries.adminListCarts.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);
    const res = await request(app).get('/api/admin/shared-carts').query({ status: 'open' });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    expect(queries.adminListCarts).toHaveBeenCalledWith({ status: 'open', user_id: undefined });
  });
});

describe('GET /api/admin/shared-carts/refund-queue', () => {
  it('succès', async () => {
    refundQueue.listManualRefundQueue.mockResolvedValue({ items: [], total: 0 });
    const res = await request(app).get('/api/admin/shared-carts/refund-queue').query({ limit: 10, offset: 0 });
    expect(res.status).toBe(200);
    expect(refundQueue.listManualRefundQueue).toHaveBeenCalledWith({ limit: '10', offset: '0' });
  });
});

describe('GET /api/admin/shared-carts/:id', () => {
  it('404 si introuvable', async () => {
    queries.adminGetCartDetail.mockResolvedValue(null);
    const res = await request(app).get('/api/admin/shared-carts/c1');
    expect(res.status).toBe(404);
  });

  it('succès', async () => {
    queries.adminGetCartDetail.mockResolvedValue({ id: 'c1', status: 'open' });
    const res = await request(app).get('/api/admin/shared-carts/c1');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('c1');
  });
});

describe('POST /api/admin/shared-carts/:id/expire', () => {
  it('400 si statut incompatible', async () => {
    queries.adminExpireCart.mockResolvedValue(null);
    const res = await request(app).post('/api/admin/shared-carts/c1/expire').send();
    expect(res.status).toBe(400);
  });

  it('succès → log event + ok', async () => {
    queries.adminExpireCart.mockResolvedValue({ id: 'c1', status: 'expired' });
    const res = await request(app).post('/api/admin/shared-carts/c1/expire').send({ reason: 'support' });
    expect(res.status).toBe(200);
    expect(queries.logEvent).toHaveBeenCalledWith('c1', 'cart_expired', 'admin', 'user-1', { manual: true, reason: 'support' });
  });
});

describe('POST /api/admin/shared-carts/:id/extend', () => {
  it('404 si introuvable ou non ouvert', async () => {
    queries.adminExtendCartDate.mockResolvedValue(null);
    const res = await request(app).post('/api/admin/shared-carts/c1/extend').send({ days: 5 });
    expect(res.status).toBe(404);
  });

  it('succès → clamp days entre 1 et 90', async () => {
    queries.adminExtendCartDate.mockResolvedValue({ id: 'c1', target_date: '2026-09-01' });
    const res = await request(app).post('/api/admin/shared-carts/c1/extend').send({ days: 999 });
    expect(res.status).toBe(200);
    expect(queries.adminExtendCartDate).toHaveBeenCalledWith('c1', 90);
  });

  it('succès → days par défaut (7) si non fourni', async () => {
    queries.adminExtendCartDate.mockResolvedValue({ id: 'c1' });
    const res = await request(app).post('/api/admin/shared-carts/c1/extend').send({});
    expect(res.status).toBe(200);
    expect(queries.adminExtendCartDate).toHaveBeenCalledWith('c1', 7);
  });
});

describe('POST /api/admin/shared-carts/:id/note', () => {
  it('400 si note manquante', async () => {
    const res = await request(app).post('/api/admin/shared-carts/c1/note').send({});
    expect(res.status).toBe(400);
  });

  it('400 si note vide (espaces)', async () => {
    const res = await request(app).post('/api/admin/shared-carts/c1/note').send({ note: '   ' });
    expect(res.status).toBe(400);
  });

  it('succès', async () => {
    const res = await request(app).post('/api/admin/shared-carts/c1/note').send({ note: 'Client recontacté' });
    expect(res.status).toBe(200);
    expect(queries.logEvent).toHaveBeenCalledWith('c1', 'admin_note_added', 'admin', 'user-1', { note: 'Client recontacté' });
  });
});
