/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

/**
 * KOMERCE — Tests Unitaires : routes/pickup-pay-cash (P0 payments)
 *
 * Couvre POST /:orderId : garde de rôle (agent_relais/admin uniquement),
 * délégation à confirmPickupCashPayment, et propagation des erreurs.
 *
 * Run : npx jest tests/unit/pickup-pay-cash.test.js
 */

'use strict';

const express = require('express');
const request = require('supertest');

let mockUser = { id: 'agent-1', role: 'agent_relais' };

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => {
    req.user = mockUser;
    next();
  },
}));

const mockConfirmPickupCashPayment = jest.fn();
jest.mock('../../services/confirm-pickup-cash-payment', () => ({
  confirmPickupCashPayment: (...args) => mockConfirmPickupCashPayment(...args),
}));

// O7.2 (Cycle B) : routes/pickup-pay-cash.js importe désormais directement
// services/pickup-secret-service.js (plus routes/pickup-secret.js).
jest.mock('../../services/pickup-secret-service', () => ({
  generateAndStoreSecret: jest.fn().mockResolvedValue({ code: 'TEST-CODE' }),
}));

const router = require('../../routes/pickup-pay-cash');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/pickup-pay-cash', router);
  // Error handler minimal pour capter next(err)
  app.use((err, req, res, next) => {
    res.status(500).json({ error: err.message });
  });
  return app;
}

describe('routes/pickup-pay-cash', () => {
  beforeEach(() => {
    mockConfirmPickupCashPayment.mockReset();
    mockUser = { id: 'agent-1', role: 'agent_relais' };
  });

  test('refuse l\'accès à un rôle non autorisé (client)', async () => {
    mockUser = { id: 'user-1', role: 'client' };

    const res = await request(buildApp())
      .post('/api/pickup-pay-cash/order-1')
      .send({ amount: 50 });

    expect(res.status).toBe(403);
    expect(mockConfirmPickupCashPayment).not.toHaveBeenCalled();
  });

  test('autorise un agent_relais et délègue au service', async () => {
    mockConfirmPickupCashPayment.mockResolvedValueOnce({
      status: 200,
      body: { ok: true },
    });

    const res = await request(buildApp())
      .post('/api/pickup-pay-cash/order-1')
      .send({ amount: 50 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(mockConfirmPickupCashPayment).toHaveBeenCalledTimes(1);
    const callArg = mockConfirmPickupCashPayment.mock.calls[0][0];
    expect(callArg.orderId).toBe('order-1');
    expect(callArg.user).toEqual(mockUser);
    expect(callArg.payload).toEqual({ amount: 50 });
    expect(typeof callArg.generateAndStoreSecret).toBe('function');
  });

  test('autorise un admin', async () => {
    mockUser = { id: 'admin-1', role: 'admin' };
    mockConfirmPickupCashPayment.mockResolvedValueOnce({ status: 200, body: { ok: true } });

    const res = await request(buildApp())
      .post('/api/pickup-pay-cash/order-2')
      .send({});

    expect(res.status).toBe(200);
  });

  test('propage le status d\'erreur métier renvoyé par le service', async () => {
    mockConfirmPickupCashPayment.mockResolvedValueOnce({
      status: 400,
      body: { error: 'Commande déjà réglée' },
    });

    const res = await request(buildApp())
      .post('/api/pickup-pay-cash/order-3')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Commande déjà réglée');
  });

  test('transmet à next(err) si le service lève une exception', async () => {
    mockConfirmPickupCashPayment.mockRejectedValueOnce(new Error('boom'));

    const res = await request(buildApp())
      .post('/api/pickup-pay-cash/order-4')
      .send({});

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('boom');
  });
});
