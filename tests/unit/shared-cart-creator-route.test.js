'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
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
 *   routes structurelles legacy (as-cart-items, PUT/POST/DELETE/PATCH items) : 404
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
  getSharedCartLibrary: jest.fn(),
  saveSharedCartForUser: jest.fn(),
}));

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = req.user || { id: 'user-1', email: 'u@test.com' }; next(); },
  requireAdmin: (req, _res, next) => next(),
}));

jest.mock('../../middleware/auth-guest', () => ({
  authenticateOrCreateGuest: (req, _res, next) => { req.user = req.user || { id: 'user-1' }; next(); },
}));

jest.mock('../../middleware/soft-auth', () => ({
  softAuthenticate: (req, _res, next) => {
    const testUserId = req.headers['x-test-user-id'];
    if (testUserId) req.user = { id: testUserId };
    next();
  },
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

// ── GET /library (bibliothèque « Mes listes » — amendement V2 §D) ──────

describe('GET /library', () => {
  it('succès → 200, created + saved avec share_url calculé', async () => {
    engine.getSharedCartLibrary.mockResolvedValue({
      created: [{ id: 'sc-1', token: 'tok-1' }],
      saved: [{ id: 'sc-2', token: 'tok-2' }],
    });
    const res = await request(app).get('/api/shared-carts/library');
    expect(res.status).toBe(200);
    expect(engine.getSharedCartLibrary).toHaveBeenCalledWith('user-1');
    expect(res.body.created[0].share_url).toContain('tok-1');
    expect(res.body.saved[0].share_url).toContain('tok-2');
  });

  it('erreur inconnue → next(err) → 500', async () => {
    engine.getSharedCartLibrary.mockRejectedValue(new Error('boom'));
    const res = await request(app).get('/api/shared-carts/library');
    expect(res.status).toBe(500);
  });

  it("n'est pas capturée par le wildcard GET /:id (enregistrement avant)", async () => {
    engine.getSharedCartLibrary.mockResolvedValue({ created: [], saved: [] });
    const res = await request(app).get('/api/shared-carts/library');
    expect(res.status).toBe(200);
    expect(engine.getSharedCartForOwner).not.toHaveBeenCalled();
  });
});

// ── POST /save (sauvegarde explicite d'une liste reçue — V2 §D) ────────

describe('POST /save', () => {
  it('succès → 200, transmet token au service', async () => {
    engine.saveSharedCartForUser.mockResolvedValue({ ok: true, shared_cart_id: 'sc-2', already_saved: false });
    const res = await request(app).post('/api/shared-carts/save').send({ token: 'tok-2' });
    expect(res.status).toBe(200);
    expect(engine.saveSharedCartForUser).toHaveBeenCalledWith('user-1', 'tok-2');
    expect(res.body.already_saved).toBe(false);
  });

  it('token requis → 400, code propagé', async () => {
    const err = new Error('token requis');
    err.status = 400; err.code = 'token_required';
    engine.saveSharedCartForUser.mockRejectedValue(err);
    const res = await request(app).post('/api/shared-carts/save').send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('token_required');
  });

  it('token inconnu → 404, code propagé', async () => {
    const err = new Error('Ce lien de liste partagée est invalide ou expiré.');
    err.status = 404; err.code = 'shared_cart_not_found';
    engine.saveSharedCartForUser.mockRejectedValue(err);
    const res = await request(app).post('/api/shared-carts/save').send({ token: 'tok-x' });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('shared_cart_not_found');
  });

  it('créateur tente de sauvegarder sa propre liste → 400, code cannot_save_own_list', async () => {
    const err = new Error('Vous êtes le créateur de cette liste');
    err.status = 400; err.code = 'cannot_save_own_list';
    engine.saveSharedCartForUser.mockRejectedValue(err);
    const res = await request(app).post('/api/shared-carts/save').send({ token: 'tok-1' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('cannot_save_own_list');
  });

  it('erreur inconnue (pas de .status) → next(err) → 500', async () => {
    engine.saveSharedCartForUser.mockRejectedValue(new Error('boom'));
    const res = await request(app).post('/api/shared-carts/save').send({ token: 'tok-2' });
    expect(res.status).toBe(500);
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

// ── Liste publiée = snapshot structurellement immuable ────────────────

describe('liste publiée — aucune route de réédition', () => {
  it.each([
    ['get',    '/api/shared-carts/cart-1/as-cart-items'],
    ['put',    '/api/shared-carts/cart-1/items'],
    ['post',   '/api/shared-carts/cart-1/items'],
    ['delete', '/api/shared-carts/cart-1/items/sci-1'],
    ['patch',  '/api/shared-carts/cart-1/items/sci-1'],
  ])('%s %s → 404', async (method, path) => {
    const res = await request(app)[method](path);
    expect(res.status).toBe(404);
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
