'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/payments-paypal.test.js
 * Couvre routes/payments-paypal.js — endpoints create-order, capture, refund.
 * (Le endpoint /webhook est déjà couvert par tests/unit/paypal-webhook.test.js)
 */

jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

jest.mock('../../db', () => ({ query: jest.fn(), getClient: jest.fn() }));

jest.mock('../../services/paypal-client', () => ({}));

jest.mock('../../services/payment-paypal', () => ({
  createPaypalOrder: jest.fn(),
  capturePaypalOrder: jest.fn(),
  handlePaypalWebhookEvent: jest.fn(),
  refundPaypalOrder: jest.fn(),
}));

// authGuest/authenticate mockés dynamiquement par test (voir setAuth ci-dessous)
let mockUser = null;
jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => {
    if (!mockUser) return res.status(401).json({ error: 'Non authentifié' });
    req.user = mockUser;
    next();
  },
}));
jest.mock('../../middleware/auth-guest', () => ({
  authenticateOrCreateGuest: (req, res, next) => {
    if (mockUser) req.user = mockUser;
    next();
  },
}));

const express = require('express');
const request = require('supertest');
const db = require('../../db');
const paymentPaypal = require('../../services/payment-paypal');

let app;

function setAuth(user) { mockUser = user; }

beforeEach(() => {
  jest.clearAllMocks();
  setAuth(null);
  app = express();
  app.use(express.json());
  jest.isolateModules(() => {
    const router = require('../../routes/payments-paypal');
    app.use('/api/payments/paypal', router);
  });
});

describe('POST /api/payments/paypal/create-order', () => {
  it('ni order_reference ni order_id → 400', async () => {
    const res = await request(app).post('/api/payments/paypal/create-order').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/order_reference ou order_id requis/);
  });

  it('commande introuvable → 404', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/api/payments/paypal/create-order').send({ order_reference: 'K-X' });
    expect(res.status).toBe(404);
  });

  it('commande appartenant a un autre utilisateur → 403', async () => {
    setAuth({ id: 'user-1' });
    db.query.mockResolvedValueOnce({ rows: [{ id: 'o1', user_id: 'user-2', total_eur: 10, payment_status: 'pending' }] });
    const res = await request(app).post('/api/payments/paypal/create-order').send({ order_id: 'o1' });
    expect(res.status).toBe(403);
  });

  it('commande deja payee → 409', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'o1', user_id: null, total_eur: 10, payment_status: 'paid' }] });
    const res = await request(app).post('/api/payments/paypal/create-order').send({ order_id: 'o1' });
    expect(res.status).toBe(409);
  });

  it('total_eur manquant ou invalide → 409', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'o1', user_id: null, total_eur: 0, payment_status: 'pending' }] });
    const res = await request(app).post('/api/payments/paypal/create-order').send({ order_id: 'o1' });
    expect(res.status).toBe(409);
  });

  it('nominal → 200 et delegue a createPaypalOrder', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'o1', user_id: null, total_eur: 49.9, payment_status: 'pending' }] });
    paymentPaypal.createPaypalOrder.mockResolvedValue({ paypal_order_id: 'PP-1', approve_url: 'https://paypal.com/x' });

    const res = await request(app).post('/api/payments/paypal/create-order').send({ order_id: 'o1' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ paypal_order_id: 'PP-1', approve_url: 'https://paypal.com/x' });
    expect(paymentPaypal.createPaypalOrder).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'o1' }), expect.anything(), expect.anything()
    );
  });
});

describe('POST /api/payments/paypal/capture/:paypalOrderId', () => {
  it('commande paypal inconnue cote Komerce → 404', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/api/payments/paypal/capture/PP-X').send({});
    expect(res.status).toBe(404);
  });

  it('commande appartenant a un autre utilisateur → 403', async () => {
    setAuth({ id: 'user-1' });
    db.query.mockResolvedValueOnce({ rows: [{ id: 'o1', user_id: 'user-2', total_eur: 10, payment_status: 'pending' }] });
    const res = await request(app).post('/api/payments/paypal/capture/PP-1').send({});
    expect(res.status).toBe(403);
  });

  it('capture non-COMPLETED → 409', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'o1', user_id: null }] });
    paymentPaypal.capturePaypalOrder.mockResolvedValue({ capture_not_completed: true, status: 'PENDING' });
    const res = await request(app).post('/api/payments/paypal/capture/PP-1').send({});
    expect(res.status).toBe(409);
    expect(res.body.status).toBe('PENDING');
  });

  it('montant capture incoherent → 409 amount_mismatch', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'o1', user_id: null }] });
    paymentPaypal.capturePaypalOrder.mockResolvedValue({ amount_mismatch: true, expected: 100, actual: 50 });
    const res = await request(app).post('/api/payments/paypal/capture/PP-1').send({});
    expect(res.status).toBe(409);
    expect(res.body).toEqual(expect.objectContaining({ expected: 100, actual: 50 }));
  });

  it('cycle de paiement rejete → 502', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'o1', user_id: null }] });
    paymentPaypal.capturePaypalOrder.mockResolvedValue({ cycle_rejected: true });
    const res = await request(app).post('/api/payments/paypal/capture/PP-1').send({});
    expect(res.status).toBe(502);
  });

  it('echec capture PayPal (erreur taggee _paypalCaptureFailed) → 502', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'o1', user_id: null }] });
    const err = new Error('PayPal API down');
    err._paypalCaptureFailed = true;
    paymentPaypal.capturePaypalOrder.mockRejectedValue(err);
    const res = await request(app).post('/api/payments/paypal/capture/PP-1').send({});
    expect(res.status).toBe(502);
  });

  it('deja payee (already_paid) → 200 idempotent', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'o1', user_id: null }] });
    paymentPaypal.capturePaypalOrder.mockResolvedValue({ already_paid: true });
    const res = await request(app).post('/api/payments/paypal/capture/PP-1').send({});
    expect(res.status).toBe(200);
    expect(res.body.already_paid).toBe(true);
  });

  it('nominal → 200 et delegue a capturePaypalOrder', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'o1', user_id: null }] });
    paymentPaypal.capturePaypalOrder.mockResolvedValue({ success: true });
    const res = await request(app).post('/api/payments/paypal/capture/PP-1').send({});
    expect(res.status).toBe(200);
    expect(paymentPaypal.capturePaypalOrder).toHaveBeenCalledWith(
      'PP-1', expect.objectContaining({ id: 'o1' }), expect.anything(), expect.anything()
    );
  });
});

describe('POST /api/payments/paypal/refund/:orderId', () => {
  it('sans authentification → 401', async () => {
    const res = await request(app).post('/api/payments/paypal/refund/o1').send({});
    expect(res.status).toBe(401);
  });

  it('authentifie mais pas admin → 403', async () => {
    setAuth({ id: 'user-1', role: 'client' });
    const res = await request(app).post('/api/payments/paypal/refund/o1').send({});
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Admin uniquement/);
  });

  it('admin nominal → delegue a refundPaypalOrder et reflete son status/body', async () => {
    setAuth({ id: 'admin-1', role: 'admin' });
    paymentPaypal.refundPaypalOrder.mockResolvedValue({ status: 200, body: { success: true, refund_id: 'R-1' } });

    const res = await request(app).post('/api/payments/paypal/refund/o1').send({ amount_eur: 10, reason: 'client request' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, refund_id: 'R-1' });
    expect(paymentPaypal.refundPaypalOrder).toHaveBeenCalledWith(expect.objectContaining({
      orderId: 'o1', amountEur: 10, reason: 'client request', adminUser: { id: 'admin-1', role: 'admin' },
    }));
  });

  it('admin, refund refuse par le service → reflete le code d\'erreur du service (ex: 409)', async () => {
    setAuth({ id: 'admin-1', role: 'admin' });
    paymentPaypal.refundPaypalOrder.mockResolvedValue({ status: 409, body: { error: 'Commande non remboursable' } });

    const res = await request(app).post('/api/payments/paypal/refund/o1').send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Commande non remboursable');
  });
});
