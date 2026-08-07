'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/shared-cart-public-route.test.js
 *
 * Tests de la route PUBLIQUE de routes/shared-cart.js (pas d'auth).
 *
 * Boutique First : la route publique n'a plus de webhook Stripe propre
 * (checkout canonique), plus d'estimations, plus de contributions, plus
 * de compteur de vues. Il ne reste que la lecture de la liste.
 */

jest.mock('../../services/shared-cart-engine', () => ({
  getSharedCartForPublic: jest.fn(),
}));

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, _res, next) => next(),
  requireAdmin: (req, _res, next) => next(),
}));

jest.mock('../../middleware/auth-guest', () => ({
  authenticateOrCreateGuest: (req, _res, next) => next(),
}));

jest.mock('../../middleware/soft-auth', () => ({
  // Neutre par défaut (req.user reste undefined). Un test peut simuler un
  // visiteur authentifié en envoyant l'en-tête `x-test-user-id`.
  softAuthenticate: (req, _res, next) => {
    const testUserId = req.headers['x-test-user-id'];
    if (testUserId) req.user = { id: testUserId };
    next();
  },
}));


jest.mock('../../services/shared-cart-queries', () => ({
  getSharedCartByToken: jest.fn(),
  getCartByOwner: jest.fn(),
  logEvent: jest.fn(),
  adminListCarts: jest.fn(),
  adminGetCartDetail: jest.fn(),
}));

jest.mock('../../services/whatsapp-meta', () => ({
  sendTemplateWhatsApp: jest.fn().mockResolvedValue({ success: true }),
}));

jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const engine = require('../../services/shared-cart-engine');

const express = require('express');
const request = require('supertest');

let app;

beforeEach(() => {
  jest.clearAllMocks();

  app = express();
  app.use(express.json());

  jest.isolateModules(() => {
    const { router } = require('../../routes/shared-cart');
    app.use('/api/shared-carts', router);
  });
  app.use((err, req, res, _next) => {
    res.status(500).json({ error: err.message });
  });
});

describe('GET /public/:token', () => {
  it('404 si liste introuvable', async () => {
    engine.getSharedCartForPublic.mockResolvedValue(null);
    const res = await request(app).get('/api/shared-carts/public/tok1');
    expect(res.status).toBe(404);
  });

  it('succès → retourne la liste avec statut de claim par article', async () => {
    engine.getSharedCartForPublic.mockResolvedValue({
      cart: { token: 'tok1', title: 'Liste' },
      items: [{ id: 'sci-1', claimed: false }, { id: 'sci-2', claimed: true }],
    });
    const res = await request(app).get('/api/shared-carts/public/tok1');
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0].claimed).toBe(false);
    expect(res.body.items[1].claimed).toBe(true);
  });

  it('erreur → next(err) → 500', async () => {
    engine.getSharedCartForPublic.mockRejectedValue(new Error('db down'));
    const res = await request(app).get('/api/shared-carts/public/tok1');
    expect(res.status).toBe(500);
  });

  it('Contrat API §5 point 2 : transmet req.user.id au service si le visiteur est authentifié', async () => {
    engine.getSharedCartForPublic.mockResolvedValue({ cart: { token: 'tok1' }, items: [], is_creator: true });
    await request(app).get('/api/shared-carts/public/tok1').set('x-test-user-id', 'user-organizer');
    expect(engine.getSharedCartForPublic).toHaveBeenCalledWith('tok1', 'user-organizer');
  });

  it('Contrat API §5 point 2 : transmet undefined si le visiteur est anonyme (jamais bloquant)', async () => {
    engine.getSharedCartForPublic.mockResolvedValue({ cart: { token: 'tok1' }, items: [], is_creator: false });
    const res = await request(app).get('/api/shared-carts/public/tok1');
    expect(res.status).toBe(200);
    expect(engine.getSharedCartForPublic).toHaveBeenCalledWith('tok1', undefined);
  });
});

describe('routes de contribution/estimation supprimées (Boutique First)', () => {
  it('POST /public/:token/contributions n\'existe plus', async () => {
    const res = await request(app).post('/api/shared-carts/public/tok1/contributions').send({});
    expect(res.status).toBe(404);
  });

  it('GET /public/:token/estimations n\'existe plus', async () => {
    const res = await request(app).get('/api/shared-carts/public/tok1/estimations');
    expect(res.status).toBe(404);
  });
});
