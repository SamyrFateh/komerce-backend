/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

/**
 * KOMERCE — Tests Unitaires : routes/payments (Lot D4)
 *
 * tests/unit/payments-webhook.test.js couvre déjà en profondeur le chemin
 * heureux de POST /stripe/webhook (payment_intent.succeeded /
 * payment_intent.payment_failed). Ce fichier couvre le reste de la façade
 * (R5) qui n'était pas encore exercé au niveau HTTP :
 *
 *   - POST /stripe/intent  (auth, validation, 400/404/403, délégation)
 *   - POST /stripe/webhook : signature invalide (400) et
 *     stripe_events_processed indisponible (catch non-bloquant, ligne 101)
 *     et erreur handler → next(err) (ligne 114)
 *   - POST /cash/confirm   (guard de rôle, délégation, status dynamique)
 *   - GET  /rates          (délégation utils/rates)
 *   - GET  /config         (clé publique présente/absente)
 *
 * Run : npx jest tests/unit/payments-route.test.js
 */

'use strict';

const express = require('express');
const request = require('supertest');

// ── Mock : stripe (constructeur + instance) ──────────────────────────────
const mockConstructEvent = jest.fn();
const mockRetrieve = jest.fn();
const mockCreate = jest.fn();
jest.mock('stripe', () => jest.fn(() => ({
  webhooks: { constructEvent: (...a) => mockConstructEvent(...a) },
  paymentIntents: { retrieve: (...a) => mockRetrieve(...a), create: (...a) => mockCreate(...a) },
})));

// ── Mock : db ──────────────────────────────────────────────────────────────
const mockDbQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockDbQuery(...args) }));

jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

// ── Mock : monitoring (F4 — trace les webhooks Stripe en échec) ────────────
const mockTrackError = jest.fn();
jest.mock('../../services/monitoring', () => ({ trackError: (...a) => mockTrackError(...a) }));

// ── Mock : auth / validate ───────────────────────────────────────────────
let mockUser = { id: 'user-1', role: 'client' };
jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => {
    if (!mockUser) return res.status(401).json({ error: 'Token manquant' });
    req.user = mockUser;
    next();
  },
  requireRole: (roles) => (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Accès réservé' });
    }
    next();
  },
}));
jest.mock('../../middleware/validate', () => ({
  validate: () => (req, res, next) => next(),
}));
jest.mock('../../validators', () => ({
  payments: { stripeIntent: {}, cashConfirm: {} },
}));

// ── Mock : services délégués ─────────────────────────────────────────────
const mockCreateStripeIntent = jest.fn();
const mockHandleStripeSucceeded = jest.fn();
const mockHandleStripePaymentFailed = jest.fn();
jest.mock('../../services/payment-stripe', () => ({
  createStripeIntent: (...a) => mockCreateStripeIntent(...a),
  handleStripeSucceeded: (...a) => mockHandleStripeSucceeded(...a),
  handleStripePaymentFailed: (...a) => mockHandleStripePaymentFailed(...a),
  markStripeEventProcessed: jest.fn(),
}));

const mockConfirmCashByReference = jest.fn();
jest.mock('../../services/payment-cash-confirm', () => ({
  confirmCashByReference: (...a) => mockConfirmCashByReference(...a),
}));

const mockGetRates = jest.fn();
jest.mock('../../utils/rates', () => ({ getRates: (...a) => mockGetRates(...a) }));

const mockTriggerPurchasing = jest.fn();
jest.mock('../../routes/purchasing', () => ({ triggerPurchasing: (...a) => mockTriggerPurchasing(...a) }));

const router = require('../../routes/payments');

function buildApp() {
  const app = express();
  // Reproduit l'ordre réel de server.js : express.raw() sur le path exact du
  // webhook AVANT express.json() global (I-07 — ne pas déplacer). Sans ça,
  // express.json() consommerait le body et /stripe/intent, /cash/confirm
  // recevraient req.body undefined (express.json() ne s'applique qu'aux
  // requêtes non déjà consommées).
  app.use('/api/payments/stripe/webhook', express.raw({ type: 'application/json' }));
  app.use(express.json());
  app.use('/api/payments', router);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  return app;
}

describe('routes/payments', () => {
  beforeEach(() => {
    // resetAllMocks (pas clearAllMocks) : clearAllMocks ne vide PAS la file
    // d'attente des .mockResolvedValueOnce/.mockReturnValueOnce non consommés
    // par un test précédent (vérifié empiriquement) — avec plusieurs describe
    // partageant les mêmes jest.fn() module-level (mockDbQuery, etc.), un
    // Once oublié dans un test fuit silencieusement vers le suivant.
    jest.resetAllMocks();
    mockUser = { id: 'user-1', role: 'client' };
    delete process.env.STRIPE_PUBLISHABLE_KEY;
  });

  // ── POST /stripe/intent ──────────────────────────────────────────────
  describe('POST /stripe/intent', () => {
    test('400 si order_reference manquant', async () => {
      const res = await request(buildApp()).post('/api/payments/stripe/intent').send({});
      expect(res.status).toBe(400);
      expect(mockDbQuery).not.toHaveBeenCalled();
    });

    test('404 si commande introuvable', async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [] });
      const res = await request(buildApp()).post('/api/payments/stripe/intent').send({ order_reference: 'KOM-999' });
      expect(res.status).toBe(404);
    });

    test('403 si la commande n\'appartient pas à l\'utilisateur (rôle non privilégié)', async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'o1', user_id: 'other-user', payment_mode: 'stripe_eur', payment_status: 'pending' }] });
      const res = await request(buildApp()).post('/api/payments/stripe/intent').send({ order_reference: 'KOM-001' });
      expect(res.status).toBe(403);
      expect(mockCreateStripeIntent).not.toHaveBeenCalled();
    });

    test('un rôle privilégié (admin) peut créer un intent pour une commande qui n\'est pas la sienne', async () => {
      mockUser = { id: 'admin-1', role: 'admin' };
      mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'o1', user_id: 'other-user', payment_mode: 'stripe_eur', payment_status: 'pending' }] });
      mockCreateStripeIntent.mockResolvedValueOnce({ client_secret: 'sec_1' });
      const res = await request(buildApp()).post('/api/payments/stripe/intent').send({ order_reference: 'KOM-001' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ client_secret: 'sec_1' });
    });

    test('400 si la commande n\'utilise pas Stripe', async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'o1', user_id: 'user-1', payment_mode: 'cash', payment_status: 'pending' }] });
      const res = await request(buildApp()).post('/api/payments/stripe/intent').send({ order_reference: 'KOM-001' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/n'utilise pas Stripe/);
    });

    test('400 si la commande est déjà payée', async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'o1', user_id: 'user-1', payment_mode: 'stripe_eur', payment_status: 'paid' }] });
      const res = await request(buildApp()).post('/api/payments/stripe/intent').send({ order_reference: 'KOM-001' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/déjà payée/);
    });

    test('délègue à createStripeIntent et renvoie le résultat', async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'o1', user_id: 'user-1', payment_mode: 'stripe_eur', payment_status: 'pending' }] });
      mockCreateStripeIntent.mockResolvedValueOnce({ client_secret: 'sec_ok', amount_eur: '10.00' });
      const res = await request(buildApp()).post('/api/payments/stripe/intent').send({ order_reference: 'KOM-001' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ client_secret: 'sec_ok', amount_eur: '10.00' });
      expect(mockCreateStripeIntent).toHaveBeenCalled();
    });

    test('propage une erreur du service au middleware next(err)', async () => {
      mockDbQuery.mockRejectedValueOnce(new Error('DB down'));
      const res = await request(buildApp()).post('/api/payments/stripe/intent').send({ order_reference: 'KOM-001' });
      expect(res.status).toBe(500);
    });
  });

  // ── POST /stripe/webhook ─────────────────────────────────────────────
  describe('POST /stripe/webhook', () => {
    function sendWebhook(app, bodyObj) {
      return request(app)
        .post('/api/payments/stripe/webhook')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', 'sig_test')
        .send(Buffer.from(JSON.stringify(bodyObj)));
    }

    test('400 si la signature Stripe est invalide, et trace via monitoring', async () => {
      mockConstructEvent.mockImplementationOnce(() => { throw new Error('bad signature'); });
      const res = await sendWebhook(buildApp(), { id: 'evt_bad' });
      expect(res.status).toBe(400);
      expect(res.text).toBe('Webhook signature invalid');
      expect(mockTrackError).toHaveBeenCalledWith(expect.any(Error), { module: 'stripe_webhook', context: 'signature_invalid' });
    });

    test('idempotent si stripe_events_processed contient déjà l\'event', async () => {
      const event = { id: 'evt_seen', type: 'payment_intent.succeeded', data: { object: {} } };
      mockConstructEvent.mockReturnValueOnce(event);
      mockDbQuery.mockResolvedValueOnce({ rows: [{ stripe_event_id: 'evt_seen' }] });

      const res = await sendWebhook(buildApp(), event);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ received: true, idempotent: true });
      expect(mockHandleStripeSucceeded).not.toHaveBeenCalled();
    });

    test('stripe_events_processed indisponible (table absente) → catch non-bloquant, traitement continue', async () => {
      const event = { id: 'evt_tbl_down', type: 'payment_intent.succeeded', data: { object: {} } };
      mockConstructEvent.mockReturnValueOnce(event);
      mockDbQuery.mockRejectedValueOnce(new Error('relation "stripe_events_processed" does not exist'));
      mockHandleStripeSucceeded.mockResolvedValueOnce({ received: true });

      const res = await sendWebhook(buildApp(), event);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ received: true });
      expect(mockHandleStripeSucceeded).toHaveBeenCalledWith(event, event.data.object, expect.anything(), expect.any(Function));
    });

    test('payment_intent.succeeded → délègue à handleStripeSucceeded', async () => {
      const event = { id: 'evt_ok', type: 'payment_intent.succeeded', data: { object: { id: 'pi_1' } } };
      mockConstructEvent.mockReturnValueOnce(event);
      mockDbQuery.mockResolvedValueOnce({ rows: [] }); // pas déjà vu
      mockHandleStripeSucceeded.mockResolvedValueOnce({ received: true });

      const res = await sendWebhook(buildApp(), event);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ received: true });
    });

    test('payment_intent.payment_failed → délègue à handleStripePaymentFailed', async () => {
      const event = { id: 'evt_fail', type: 'payment_intent.payment_failed', data: { object: { id: 'pi_2' } } };
      mockConstructEvent.mockReturnValueOnce(event);
      mockDbQuery.mockResolvedValueOnce({ rows: [] });
      mockHandleStripePaymentFailed.mockResolvedValueOnce(undefined);

      const res = await sendWebhook(buildApp(), event);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ received: true });
      expect(mockHandleStripePaymentFailed).toHaveBeenCalledWith(event, event.data.object, expect.anything());
    });

    test('type d\'event non géré → { received: true } sans appel handler', async () => {
      const event = { id: 'evt_other', type: 'charge.refunded', data: { object: {} } };
      mockConstructEvent.mockReturnValueOnce(event);
      mockDbQuery.mockResolvedValueOnce({ rows: [] });

      const res = await sendWebhook(buildApp(), event);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ received: true });
      expect(mockHandleStripeSucceeded).not.toHaveBeenCalled();
      expect(mockHandleStripePaymentFailed).not.toHaveBeenCalled();
    });

    test('erreur dans le handler → next(err) → 500', async () => {
      const event = { id: 'evt_crash', type: 'payment_intent.succeeded', data: { object: {} } };
      mockConstructEvent.mockReturnValueOnce(event);
      mockDbQuery.mockResolvedValueOnce({ rows: [] });
      mockHandleStripeSucceeded.mockRejectedValueOnce(new Error('handler boom'));

      const res = await sendWebhook(buildApp(), event);
      expect(res.status).toBe(500);
    });
  });

  // ── POST /cash/confirm ────────────────────────────────────────────────
  describe('POST /cash/confirm', () => {
    test('refuse un rôle non autorisé (ni admin ni agent_relais)', async () => {
      mockUser = { id: 'u1', role: 'client' };
      const res = await request(buildApp()).post('/api/payments/cash/confirm').send({ cash_ref_code: 'ABC123' });
      expect(res.status).toBe(403);
      expect(mockConfirmCashByReference).not.toHaveBeenCalled();
    });

    test('agent_relais autorisé → délègue à confirmCashByReference et renvoie result.status/body', async () => {
      mockUser = { id: 'agent-1', role: 'agent_relais' };
      mockConfirmCashByReference.mockResolvedValueOnce({ status: 200, body: { confirmed: true } });

      const res = await request(buildApp()).post('/api/payments/cash/confirm').send({ cash_ref_code: 'ABC123' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ confirmed: true });
      expect(mockConfirmCashByReference).toHaveBeenCalledWith(expect.objectContaining({
        cashRefCode: 'ABC123',
        actor: { id: 'agent-1', role: 'agent_relais' },
      }));
    });

    test('renvoie un statut d\'erreur métier (ex: 409 double confirmation)', async () => {
      mockUser = { id: 'admin-1', role: 'admin' };
      mockConfirmCashByReference.mockResolvedValueOnce({ status: 409, body: { error: 'Déjà confirmé' } });

      const res = await request(buildApp()).post('/api/payments/cash/confirm').send({ cash_ref_code: 'XYZ' });
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: 'Déjà confirmé' });
    });

    test('propage une erreur du service au middleware next(err)', async () => {
      mockUser = { id: 'admin-1', role: 'admin' };
      mockConfirmCashByReference.mockRejectedValueOnce(new Error('DB down'));
      const res = await request(buildApp()).post('/api/payments/cash/confirm').send({ cash_ref_code: 'ABC' });
      expect(res.status).toBe(500);
    });
  });

  // ── GET /rates ────────────────────────────────────────────────────────
  describe('GET /rates', () => {
    test('délègue à getRates et ne renvoie que les 3 champs attendus', async () => {
      mockGetRates.mockResolvedValueOnce({ eur_kmf: 500, aed_kmf: 136, other_field: 'ignored' });
      const res = await request(buildApp()).get('/api/payments/rates');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ eur_kmf: 500, aed_kmf: 136, source: 'finance_config' });
    });

    test('propage une erreur au middleware next(err)', async () => {
      mockGetRates.mockRejectedValueOnce(new Error('rates unavailable'));
      const res = await request(buildApp()).get('/api/payments/rates');
      expect(res.status).toBe(500);
    });
  });

  // ── GET /config ───────────────────────────────────────────────────────
  describe('GET /config', () => {
    test('500 si STRIPE_PUBLISHABLE_KEY absent', async () => {
      delete process.env.STRIPE_PUBLISHABLE_KEY;
      const res = await request(buildApp()).get('/api/payments/config');
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Stripe non configuré' });
    });

    test('renvoie la clé publique si définie', async () => {
      process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_123';
      const res = await request(buildApp()).get('/api/payments/config');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ publishable_key: 'pk_test_123' });
    });
  });
});
