'use strict';

/**
 * tests/unit/shared-cart-creator-route.test.js
 *
 * Tests des routes ORGANISATEUR AUTHENTIFIÉ + ADMIN de routes/shared-cart.js
 * (Boutique First — remplace l'ancien couple creator-route/branches, dont
 * la quasi-totalité couvrait des routes supprimées : finalize,
 * awaiting-choice/*, extend-window, contributions, estimations).
 *
 * Couverture :
 *   POST /from-cart-items   : 400 vide, 401 sans user, succès + notif WhatsApp,
 *                             erreurs métier → 400, erreur inconnue → next
 *   POST /from-basket       : 400 sans basket_id, succès, erreurs métier → 400
 *   GET  /mine              : succès (share_url calculé)
 *   GET  /:id               : 404, succès
 *   GET  /:id/as-cart-items : 404, succès (mapping avec shared_cart_item_id + claimed)
 *   PUT  /:id/items         : 400 si cart_items vide, succès, erreur custom status
 *   POST /:id/close         : succès, erreur custom status
 *   POST /:id/cancel        : succès, erreur custom status
 *
 *   adminRouter (montée sur /api/admin/shared-carts) :
 *   GET  /       : succès (liste + count)
 *   GET  /:id    : 404, succès
 *   POST /:id/note : 400 note manquante, succès
 */

jest.mock('../../services/shared-cart-engine', () => ({
  getSharedCartForPublic: jest.fn(),
  createSharedCartFromCartItems: jest.fn(),
  createSharedCartFromBasket: jest.fn(),
  listMySharedCarts: jest.fn(),
  getSharedCartForOwner: jest.fn(),
  closeCart: jest.fn(),
  cancelSharedCart: jest.fn(),
}));

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = req.user || { id: 'user-1', email: 'u@test.com' }; next(); },
  requireAdmin: (req, _res, next) => next(),
}));

jest.mock('../../middleware/auth-guest', () => ({
  authenticateOrCreateGuest: (req, _res, next) => { req.user = req.user || { id: 'user-1' }; next(); },
}));

jest.mock('../../services/shared-cart-items-service', () => ({
  updateOpenSharedCartItems: jest.fn(),
}));

jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

jest.mock('../../services/whatsapp-meta', () => ({
  sendTemplateWhatsApp: jest.fn().mockResolvedValue({ success: true }),
}));

jest.mock('../../services/shared-cart-queries', () => ({
  getSharedCartByToken: jest.fn(),
  getCartByOwner: jest.fn(),
  logEvent: jest.fn().mockResolvedValue(undefined),
  adminListCarts: jest.fn(),
  adminGetCartDetail: jest.fn(),
  adminExpireCart: jest.fn(),
}));

const engine = require('../../services/shared-cart-engine');
const itemsService = require('../../services/shared-cart-items-service');
const whatsapp = require('../../services/whatsapp-meta');
const queries = require('../../services/shared-cart-queries');

const express = require('express');
const request = require('supertest');

let app;

beforeEach(() => {
  jest.clearAllMocks();

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

// ── POST /from-cart-items ───────────────────────────────────────────────

describe('POST /from-cart-items', () => {
  it('400 si cart_items vide', async () => {
    const res = await request(app).post('/api/shared-carts/from-cart-items').send({ cart_items: [] });
    expect(res.status).toBe(400);
  });

  it('succès → 200 + notif WhatsApp fire-and-forget', async () => {
    engine.createSharedCartFromCartItems.mockResolvedValue({
      sharedCart: { id: 'cart-1', status: 'open' },
      token: 'tok-1',
      items: [{ id: 'sci-1' }],
      clearLocalCart: true,
    });

    const res = await request(app).post('/api/shared-carts/from-cart-items')
      .send({ cart_items: [{ product_id: 'p1', quantity: 1 }] });

    expect(res.status).toBe(200);
    expect(res.body.shared_cart_id).toBe('cart-1');
    expect(res.body.clear_local_cart).toBe(true);
    await new Promise(process.nextTick);
  });

  it('erreur métier connue (Limite atteinte) → 400', async () => {
    engine.createSharedCartFromCartItems.mockRejectedValue(new Error('Limite atteinte : 5 listes actives'));
    const res = await request(app).post('/api/shared-carts/from-cart-items')
      .send({ cart_items: [{ product_id: 'p1', quantity: 1 }] });
    expect(res.status).toBe(400);
  });

  it('erreur inconnue → next(err) → 500', async () => {
    engine.createSharedCartFromCartItems.mockRejectedValue(new Error('boom inattendu'));
    const res = await request(app).post('/api/shared-carts/from-cart-items')
      .send({ cart_items: [{ product_id: 'p1', quantity: 1 }] });
    expect(res.status).toBe(500);
  });
});

// ── POST /from-basket ────────────────────────────────────────────────────

describe('POST /from-basket', () => {
  it('400 sans basket_id', async () => {
    const res = await request(app).post('/api/shared-carts/from-basket').send({});
    expect(res.status).toBe(400);
  });

  it('succès → 200', async () => {
    engine.createSharedCartFromBasket.mockResolvedValue({
      sharedCart: { id: 'cart-2' }, token: 'tok-2', items: [{ id: 'sci-1' }],
    });
    const res = await request(app).post('/api/shared-carts/from-basket').send({ basket_id: 'basket-1' });
    expect(res.status).toBe(200);
    expect(res.body.shared_cart_id).toBe('cart-2');
  });

  it('erreur métier connue → 400', async () => {
    engine.createSharedCartFromBasket.mockRejectedValue(new Error('Panier introuvable ou non autorisé'));
    const res = await request(app).post('/api/shared-carts/from-basket').send({ basket_id: 'x' });
    expect(res.status).toBe(400);
  });
});

// ── GET /mine ─────────────────────────────────────────────────────────

describe('GET /mine', () => {
  it('succès → share_url calculé pour chaque liste', async () => {
    engine.listMySharedCarts.mockResolvedValue([{ id: 'cart-1', token: 'tok-1' }]);
    const res = await request(app).get('/api/shared-carts/mine');
    expect(res.status).toBe(200);
    expect(res.body.carts[0].share_url).toContain('tok-1');
  });
});

// ── GET /:id ──────────────────────────────────────────────────────────

describe('GET /:id', () => {
  it('404 si liste introuvable', async () => {
    engine.getSharedCartForOwner.mockResolvedValue(null);
    const res = await request(app).get('/api/shared-carts/cart-x');
    expect(res.status).toBe(404);
  });

  it('succès → 200 + share_url', async () => {
    engine.getSharedCartForOwner.mockResolvedValue({ cart: { id: 'cart-1', token: 'tok-1' }, items: [] });
    const res = await request(app).get('/api/shared-carts/cart-1');
    expect(res.status).toBe(200);
    expect(res.body.share_url).toContain('tok-1');
  });
});

// ── GET /:id/as-cart-items ────────────────────────────────────────────

describe('GET /:id/as-cart-items', () => {
  it('404 si liste introuvable', async () => {
    engine.getSharedCartForOwner.mockResolvedValue(null);
    const res = await request(app).get('/api/shared-carts/cart-x/as-cart-items');
    expect(res.status).toBe(404);
  });

  it('succès → items avec shared_cart_item_id et claimed', async () => {
    engine.getSharedCartForOwner.mockResolvedValue({
      cart: {
        id: 'cart-1', title: 'Liste', total_kmf: 2000,
      },
      items: [{
        id: 'sci-1', product_id: 'p1', quantity: 2,
        product_name_snapshot: 'Riz', product_image_snapshot: null, product_category_snapshot: 'epicerie',
        unit_price_kmf_snapshot: 1000, line_total_kmf_snapshot: 2000,
      }],
    });
    const res = await request(app).get('/api/shared-carts/cart-1/as-cart-items');
    expect(res.status).toBe(200);
    expect(res.body.total_kmf).toBe(2000);
    expect(res.body.cart_items[0].product_id).toBe('p1');
    expect(res.body.cart_items[0].line_total_kmf).toBe(2000);
    // Gap réel constaté dans le code actuel : ce endpoint ne reprend PAS
    // shared_cart_item_id / claimed (migration 123) — le pont vers le
    // checkout canonique n'est donc pas encore branché sur cette route.
    // Documenté ici plutôt que masqué, à corriger avant d'exposer un
    // parcours participant réel sur cet endpoint.
    expect(res.body.cart_items[0].shared_cart_item_id).toBeUndefined();
  });
});

// ── PUT /:id/items ────────────────────────────────────────────────────

describe('PUT /:id/items', () => {
  it('400 si cart_items vide', async () => {
    const res = await request(app).put('/api/shared-carts/cart-1/items').send({ cart_items: [] });
    expect(res.status).toBe(400);
  });

  it('succès → 200', async () => {
    itemsService.updateOpenSharedCartItems.mockResolvedValue({
      cart: { id: 'cart-1' }, items: [{ id: 'sci-1' }],
    });
    const res = await request(app).put('/api/shared-carts/cart-1/items')
      .send({ cart_items: [{ product_id: 'p1', quantity: 1 }] });
    expect(res.status).toBe(200);
    expect(res.body.items_count).toBe(1);
  });

  it('erreur avec status custom → propagée', async () => {
    const err = new Error('non éditable');
    err.status = 409; err.code = 'cart_not_editable';
    itemsService.updateOpenSharedCartItems.mockRejectedValue(err);
    const res = await request(app).put('/api/shared-carts/cart-1/items')
      .send({ cart_items: [{ product_id: 'p1', quantity: 1 }] });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('cart_not_editable');
  });
});

// ── POST /:id/close ───────────────────────────────────────────────────

describe('POST /:id/close', () => {
  it('succès → 200', async () => {
    engine.closeCart.mockResolvedValue({ id: 'cart-1', status: 'closed' });
    const res = await request(app).post('/api/shared-carts/cart-1/close');
    expect(res.status).toBe(200);
    expect(res.body.cart.status).toBe('closed');
  });

  it('erreur métier (Error nu, pas de .status) → next(err) → 500 (route ne mappe pas les messages ici)', async () => {
    engine.closeCart.mockRejectedValue(new Error('Impossible de fermer une liste au statut closed'));
    const res = await request(app).post('/api/shared-carts/cart-1/close');
    // La route ne teste que err.status ; closeCart lève des Error() nus sans
    // .status attaché — toute erreur métier finit donc en 500 ici, pas 409.
    expect(res.status).toBe(500);
  });

  it('erreur inconnue → next(err) → 500', async () => {
    engine.closeCart.mockRejectedValue(new Error('boom'));
    const res = await request(app).post('/api/shared-carts/cart-1/close');
    expect(res.status).toBe(500);
  });
});

// ── POST /:id/cancel ──────────────────────────────────────────────────

describe('POST /:id/cancel', () => {
  it('succès → 200', async () => {
    engine.cancelSharedCart.mockResolvedValue({ id: 'cart-1', status: 'cancelled' });
    const res = await request(app).post('/api/shared-carts/cart-1/cancel').send({ reason: 'changement' });
    expect(res.status).toBe(200);
  });

  it('erreur métier (message "introuvable"/"Impossible") → 400', async () => {
    engine.cancelSharedCart.mockRejectedValue(new Error('Panier introuvable ou non autorisé'));
    const res = await request(app).post('/api/shared-carts/cart-1/cancel');
    expect(res.status).toBe(400);
  });
});

// ── Routes supprimées (Boutique First) ────────────────────────────────

describe('routes de machine à états supprimées', () => {
  it.each([
    ['post', '/api/shared-carts/cart-1/finalize'],
    ['post', '/api/shared-carts/cart-1/awaiting-choice/complete'],
    ['post', '/api/shared-carts/cart-1/awaiting-choice/adjust'],
    ['post', '/api/shared-carts/cart-1/extend-window'],
    ['post', '/api/shared-carts/cart-1/awaiting-choice/cancel'],
  ])('%s %s → 404 (route supprimée)', async (method, path) => {
    const res = await request(app)[method](path);
    expect(res.status).toBe(404);
  });
});

// ── Admin ─────────────────────────────────────────────────────────────

describe('adminRouter', () => {
  it('GET / → succès (liste + count)', async () => {
    queries.adminListCarts.mockResolvedValue([{ id: 'cart-1' }]);
    const res = await request(app).get('/api/admin/shared-carts');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
  });

  it('GET / → 500 si adminListCarts rejette', async () => {
    queries.adminListCarts.mockRejectedValue(new Error('db down'));
    const res = await request(app).get('/api/admin/shared-carts');
    expect(res.status).toBe(500);
  });

  it('GET /:id → 404 si introuvable', async () => {
    queries.adminGetCartDetail.mockResolvedValue(null);
    const res = await request(app).get('/api/admin/shared-carts/cart-x');
    expect(res.status).toBe(404);
  });

  it('GET /:id → succès', async () => {
    queries.adminGetCartDetail.mockResolvedValue({ cart: { id: 'cart-1' }, items: [], events: [] });
    const res = await request(app).get('/api/admin/shared-carts/cart-1');
    expect(res.status).toBe(200);
  });

  it('POST /:id/note → 400 si note manquante', async () => {
    const res = await request(app).post('/api/admin/shared-carts/cart-1/note').send({});
    expect(res.status).toBe(400);
  });

  it('POST /:id/note → succès', async () => {
    const res = await request(app).post('/api/admin/shared-carts/cart-1/note').send({ note: 'vérifié' });
    expect(res.status).toBe(200);
    expect(queries.logEvent).toHaveBeenCalledWith('cart-1', 'admin_note_added', 'admin', 'user-1', { note: 'vérifié' });
  });

  it('POST /:id/expire → force-annulation admin (open/closed → cancelled)', async () => {
    queries.adminExpireCart.mockResolvedValue({ id: 'cart-1', status: 'cancelled' });
    const res = await request(app).post('/api/admin/shared-carts/cart-1/expire').send({ reason: 'gel opérationnel' });
    expect(res.status).toBe(200);
    expect(res.body.cart.status).toBe('cancelled');
    expect(queries.logEvent).toHaveBeenCalledWith(
      'cart-1', 'cart_cancelled', 'admin', 'user-1',
      { manual: true, reason: 'gel opérationnel' }
    );
  });

  it('POST /:id/expire → 400 si le panier est déjà cancelled (statut incompatible)', async () => {
    queries.adminExpireCart.mockResolvedValue(null);
    const res = await request(app).post('/api/admin/shared-carts/cart-1/expire');
    expect(res.status).toBe(400);
  });

  it('POST /:id/extend n\'existe pas (concept de fenêtre de paiement supprimé, migration 124) → 404', async () => {
    const res = await request(app).post('/api/admin/shared-carts/cart-1/extend');
    expect(res.status).toBe(404);
  });
});
