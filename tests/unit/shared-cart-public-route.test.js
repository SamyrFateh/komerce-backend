'use strict';

/**
 * tests/unit/shared-cart-public-route.test.js
 *
 * Tests des routes PUBLIQUES de routes/shared-cart.js (pas d'auth) et du
 * webhook Stripe.
 *
 * Couverture :
 *   GET    /public/:token                          : 404, succès + incrementViewCount fire-and-forget
 *   GET    /public/:token/estimations               : agrégat, erreur custom (status/code)
 *   POST   /public/:token/estimations               : upsert (201 création / 200 update)
 *   DELETE /public/:token/estimations/:estimationId : succès, erreur custom
 *   GET    /public/:token/estimations/by-phone      : 400 si phone manquant, 404, succès
 *   POST   /public/:token/contributions             : validations, statuts non-closed (msgMap),
 *     déjà financé, plafonnement, idempotence, succès Stripe checkout,
 *     mapping des erreurs (already_fully_funded / 400 / next)
 *   stripeWebhookHandler : signature invalide, idempotence, checkout.session.completed
 *     (ignoré si pas shared_cart / confirmé / déjà traité), checkout.session.expired,
 *     event par défaut, erreur de traitement → 500
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
  authenticate: (req, _res, next) => next(),
  requireAdmin: (req, _res, next) => next(),
}));

jest.mock('../../middleware/auth-guest', () => ({
  authenticateOrCreateGuest: (req, _res, next) => next(),
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
const estimations = require('../../services/shared-cart-estimation-service');
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
    const { router } = require('../../routes/shared-cart');
    app.use('/api/shared-carts', router);
  });
  app.use((err, req, res, _next) => {
    res.status(500).json({ error: err.message });
  });
});

describe('GET /public/:token', () => {
  it('404 si panier introuvable', async () => {
    engine.getSharedCartForPublic.mockResolvedValue(null);
    const res = await request(app).get('/api/shared-carts/public/tok1');
    expect(res.status).toBe(404);
  });

  it('succès → incrémente le compteur de vues (fire-and-forget)', async () => {
    engine.getSharedCartForPublic.mockResolvedValue({ id: 'c1', token: 'tok1' });
    const res = await request(app).get('/api/shared-carts/public/tok1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 'c1', token: 'tok1' });
    await new Promise(process.nextTick);
    expect(engine.incrementViewCount).toHaveBeenCalledWith('tok1');
  });

  it('erreur → next(err) → 500', async () => {
    engine.getSharedCartForPublic.mockRejectedValue(new Error('db down'));
    const res = await request(app).get('/api/shared-carts/public/tok1');
    expect(res.status).toBe(500);
  });
});

describe('GET /public/:token/estimations', () => {
  it('succès → agrégat public', async () => {
    estimations.getPublicAggregate.mockResolvedValue({ total_kmf: 38000, count: 4 });
    const res = await request(app).get('/api/shared-carts/public/tok1/estimations');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ total_kmf: 38000, count: 4 });
  });

  it('erreur custom (status/code) propagée', async () => {
    const err = new Error('panier introuvable');
    err.status = 404; err.code = 'shared_cart_not_found';
    estimations.getPublicAggregate.mockRejectedValue(err);
    const res = await request(app).get('/api/shared-carts/public/tok1/estimations');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'panier introuvable', code: 'shared_cart_not_found' });
  });
});

describe('POST /public/:token/estimations', () => {
  it('201 si création', async () => {
    estimations.upsertEstimation.mockResolvedValue({ updated: false, estimation: { id: 'e1' } });
    const res = await request(app).post('/api/shared-carts/public/tok1/estimations').send({ phone: '+269111' });
    expect(res.status).toBe(201);
    expect(res.body.message).toMatch(/enregistrée/);
  });

  it('200 si mise à jour', async () => {
    estimations.upsertEstimation.mockResolvedValue({ updated: true, estimation: { id: 'e1' } });
    const res = await request(app).post('/api/shared-carts/public/tok1/estimations').send({});
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/mise à jour/);
  });

  it('erreur custom → status/code propagés', async () => {
    const err = new Error('montant invalide');
    err.status = 400;
    estimations.upsertEstimation.mockRejectedValue(err);
    const res = await request(app).post('/api/shared-carts/public/tok1/estimations').send({});
    expect(res.status).toBe(400);
  });
});

describe('DELETE /public/:token/estimations/:estimationId', () => {
  it('succès', async () => {
    estimations.deleteEstimation.mockResolvedValue(undefined);
    const res = await request(app).delete('/api/shared-carts/public/tok1/estimations/e1').send({ phone: '+269111' });
    expect(res.status).toBe(200);
    expect(estimations.deleteEstimation).toHaveBeenCalledWith('tok1', 'e1', { phone: '+269111' });
  });

  it('erreur custom propagée', async () => {
    const err = new Error('non autorisé'); err.status = 403;
    estimations.deleteEstimation.mockRejectedValue(err);
    const res = await request(app).delete('/api/shared-carts/public/tok1/estimations/e1').send({});
    expect(res.status).toBe(403);
  });
});

describe('GET /public/:token/estimations/by-phone', () => {
  it('400 si phone manquant', async () => {
    const res = await request(app).get('/api/shared-carts/public/tok1/estimations/by-phone');
    expect(res.status).toBe(400);
  });

  it('404 si aucune estimation trouvée', async () => {
    estimations.getEstimationByPhone.mockResolvedValue(null);
    const res = await request(app).get('/api/shared-carts/public/tok1/estimations/by-phone').query({ phone: '+269111' });
    expect(res.status).toBe(404);
  });

  it('succès', async () => {
    estimations.getEstimationByPhone.mockResolvedValue({ id: 'e1' });
    const res = await request(app).get('/api/shared-carts/public/tok1/estimations/by-phone').query({ phone: '+269111' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ estimation: { id: 'e1' } });
  });
});

describe('POST /public/:token/contributions', () => {
  function validBody(overrides = {}) {
    return { amount_kmf: 5000, contributor_name: 'Ali', contributor_email: 'ali@test.com', ...overrides };
  }

  it('400 si champs requis manquants', async () => {
    const res = await request(app).post('/api/shared-carts/public/tok1/contributions').send({});
    expect(res.status).toBe(400);
  });

  it('404 si panier introuvable', async () => {
    queries.getSharedCartByToken.mockResolvedValue(null);
    const res = await request(app).post('/api/shared-carts/public/tok1/contributions').send(validBody());
    expect(res.status).toBe(404);
  });

  it.each([
    ['open', "n'est pas encore en phase"],
    ['awaiting_choice', 'attente de décision'],
    ['ordered', 'déjà été convertie'.replace('convertie', 'convertie')],
    ['cancelled', 'annulé'],
    ['expired', 'expiré'],
  ])('409 si statut %s (message attendu)', async (status) => {
    queries.getSharedCartByToken.mockResolvedValue({ id: 'c1', status, remaining_kmf: 5000 });
    const res = await request(app).post('/api/shared-carts/public/tok1/contributions').send(validBody());
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('cart_not_closed');
    expect(res.body.status).toBe(status);
  });

  it('409 si déjà entièrement financé (remaining = 0)', async () => {
    queries.getSharedCartByToken.mockResolvedValue({ id: 'c1', status: 'closed', remaining_kmf: 0 });
    const res = await request(app).post('/api/shared-carts/public/tok1/contributions').send(validBody());
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('already_fully_funded');
  });

  it('succès → crée la session Stripe, plafonne au remaining si nécessaire', async () => {
    queries.getSharedCartByToken.mockResolvedValue({ id: 'c1', status: 'closed', remaining_kmf: 3000 });
    engine.startContribution.mockResolvedValue({
      contribution: { id: 'contrib-1' },
      cart: { id: 'c1', token: 'tok1', title: 'Panier X', beneficiary_name_snapshot: 'Fatima' },
    });
    stripeInstance.checkout.sessions.create.mockResolvedValue({ id: 'sess_1', url: 'https://stripe.test/sess_1' });

    const res = await request(app).post('/api/shared-carts/public/tok1/contributions').send(validBody({ amount_kmf: 5000 }));

    expect(res.status).toBe(200);
    expect(res.body.payable_amount_kmf).toBe(3000); // plafonné au remaining
    expect(res.body.capped).toBe(true);
    expect(res.body.checkout_url).toBe('https://stripe.test/sess_1');
    expect(engine.attachStripeSession).toHaveBeenCalledWith('contrib-1', 'sess_1');
  });

  it('invalide les contributions pending existantes si contributor_phone fourni', async () => {
    queries.getSharedCartByToken.mockResolvedValue({ id: 'c1', status: 'closed', remaining_kmf: 5000 });
    engine.startContribution.mockResolvedValue({
      contribution: { id: 'contrib-1' },
      cart: { id: 'c1', token: 'tok1', beneficiary_name_snapshot: 'Fatima' },
    });
    stripeInstance.checkout.sessions.create.mockResolvedValue({ id: 'sess_1', url: 'https://stripe.test/sess_1' });

    await request(app).post('/api/shared-carts/public/tok1/contributions').send(validBody({ contributor_phone: '+269222' }));

    expect(queries.invalidatePendingContributions).toHaveBeenCalledWith('c1', '+269222');
  });

  it('erreur custom (status) propagée', async () => {
    queries.getSharedCartByToken.mockResolvedValue({ id: 'c1', status: 'closed', remaining_kmf: 5000 });
    const err = new Error('montant minimum non atteint'); err.status = 422;
    engine.startContribution.mockRejectedValue(err);
    const res = await request(app).post('/api/shared-carts/public/tok1/contributions').send(validBody());
    expect(res.status).toBe(422);
  });

  it('erreur "Le panier ne nécessite plus" → 409 already_fully_funded', async () => {
    queries.getSharedCartByToken.mockResolvedValue({ id: 'c1', status: 'closed', remaining_kmf: 5000 });
    engine.startContribution.mockRejectedValue(new Error('Le panier ne nécessite plus de paiement'));
    const res = await request(app).post('/api/shared-carts/public/tok1/contributions').send(validBody());
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('already_fully_funded');
  });

  it('erreur "expiré" → 400', async () => {
    queries.getSharedCartByToken.mockResolvedValue({ id: 'c1', status: 'closed', remaining_kmf: 5000 });
    engine.startContribution.mockRejectedValue(new Error('Le panier a expiré'));
    const res = await request(app).post('/api/shared-carts/public/tok1/contributions').send(validBody());
    expect(res.status).toBe(400);
  });

  it('erreur générique inconnue → next(err) → 500', async () => {
    queries.getSharedCartByToken.mockResolvedValue({ id: 'c1', status: 'closed', remaining_kmf: 5000 });
    engine.startContribution.mockRejectedValue(new Error('panne stripe totalement inattendue'));
    const res = await request(app).post('/api/shared-carts/public/tok1/contributions').send(validBody());
    expect(res.status).toBe(500);
  });
});

describe('stripeWebhookHandler', () => {
  let stripeWebhookHandler;
  let financialGuard;

  beforeEach(() => {
    jest.isolateModules(() => {
      ({ stripeWebhookHandler } = require('../../routes/shared-cart'));
    });
    financialGuard = require('../../services/shared-cart-financial-guard');
  });

  function fakeReqRes(body = {}, sig = 'sig123') {
    const req = { headers: { 'stripe-signature': sig }, body };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn(), send: jest.fn() };
    return { req, res };
  }

  it('signature invalide → 400', async () => {
    stripeInstance.webhooks.constructEvent.mockImplementation(() => { throw new Error('bad sig'); });
    const { req, res } = fakeReqRes();

    await stripeWebhookHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith('Webhook signature invalid');
  });

  it('événement déjà traité (idempotent) → 200 idempotent', async () => {
    stripeInstance.webhooks.constructEvent.mockReturnValue({ type: 'checkout.session.completed', data: { object: {} } });
    queries.isStripeEventProcessed.mockResolvedValue(true);
    const { req, res } = fakeReqRes();

    await stripeWebhookHandler(req, res);

    expect(res.json).toHaveBeenCalledWith({ received: true, idempotent: true });
  });

  it('checkout.session.completed ignoré si pas une session shared-cart', async () => {
    const session = { id: 'sess_1', metadata: { komerce: 'other_thing' } };
    stripeInstance.webhooks.constructEvent.mockReturnValue({ type: 'checkout.session.completed', data: { object: session } });
    queries.isStripeEventProcessed.mockResolvedValue(false);
    const { req, res } = fakeReqRes();

    await stripeWebhookHandler(req, res);

    expect(queries.markStripeEventProcessed).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'checkout.session.completed' }), { ignored: 'not_a_shared_cart_session' }
    );
    expect(res.json).toHaveBeenCalledWith({ received: true, ignored: 'not_a_shared_cart_session' });
  });

  it('checkout.session.completed confirmé → marque traité avec succès', async () => {
    const session = { id: 'sess_1', metadata: { komerce: 'shared_cart_contribution' } };
    stripeInstance.webhooks.constructEvent.mockReturnValue({ type: 'checkout.session.completed', data: { object: session } });
    queries.isStripeEventProcessed.mockResolvedValue(false);
    financialGuard.confirmContributionFromStripeSafely.mockResolvedValue({
      contribution: { id: 'contrib-1' }, cart: { id: 'cart-1' },
    });
    const { req, res } = fakeReqRes();

    await stripeWebhookHandler(req, res);

    expect(queries.markStripeEventProcessed).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'confirmed', contribution_id: 'contrib-1' })
    );
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });

  it('checkout.session.completed non confirmé (déjà traité ailleurs)', async () => {
    const session = { id: 'sess_1', metadata: { komerce: 'shared_cart_contribution' } };
    stripeInstance.webhooks.constructEvent.mockReturnValue({ type: 'checkout.session.completed', data: { object: session } });
    queries.isStripeEventProcessed.mockResolvedValue(false);
    financialGuard.confirmContributionFromStripeSafely.mockResolvedValue(null);
    const { req, res } = fakeReqRes();

    await stripeWebhookHandler(req, res);

    expect(queries.markStripeEventProcessed).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ contribution: 'already_processed_or_not_confirmed' })
    );
  });

  it('checkout.session.expired ignoré si pas shared-cart', async () => {
    const session = { id: 'sess_2', metadata: {} };
    stripeInstance.webhooks.constructEvent.mockReturnValue({ type: 'checkout.session.expired', data: { object: session } });
    queries.isStripeEventProcessed.mockResolvedValue(false);
    const { req, res } = fakeReqRes();

    await stripeWebhookHandler(req, res);

    expect(res.json).toHaveBeenCalledWith({ received: true, ignored: 'not_a_shared_cart_session' });
  });

  it('checkout.session.expired → markContributionFailed', async () => {
    const session = { id: 'sess_2', metadata: { komerce: 'shared_cart_contribution' } };
    stripeInstance.webhooks.constructEvent.mockReturnValue({ type: 'checkout.session.expired', data: { object: session } });
    queries.isStripeEventProcessed.mockResolvedValue(false);
    const { req, res } = fakeReqRes();

    await stripeWebhookHandler(req, res);

    expect(engine.markContributionFailed).toHaveBeenCalledWith('sess_2', 'session_expired');
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });

  it('event type non supporté → marqué ignoré', async () => {
    stripeInstance.webhooks.constructEvent.mockReturnValue({ type: 'payment_intent.succeeded', data: { object: {} } });
    queries.isStripeEventProcessed.mockResolvedValue(false);
    const { req, res } = fakeReqRes();

    await stripeWebhookHandler(req, res);

    expect(queries.markStripeEventProcessed).toHaveBeenCalledWith(
      expect.anything(), { ignored: 'unsupported_event_type' }
    );
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });

  it('erreur pendant le traitement → 500', async () => {
    stripeInstance.webhooks.constructEvent.mockReturnValue({ type: 'checkout.session.completed', data: { object: { metadata: { komerce: 'shared_cart_contribution' } } } });
    queries.isStripeEventProcessed.mockResolvedValue(false);
    financialGuard.confirmContributionFromStripeSafely.mockRejectedValue(new Error('db down'));
    const { req, res } = fakeReqRes();

    await stripeWebhookHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Webhook processing failed' });
  });
});
