'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 *
 * KartaPay webhook boundary:
 * - transaction inconnue => aucune réconciliation
 * - signature invalide => 401, aucune réconciliation
 * - signature valide => relecture provider via reconcileMobileMoneyTransaction
 */

const mockDbQuery = jest.fn();
const mockVerifyWebhook = jest.fn();
const mockGetWebhookReference = jest.fn();
const mockReconcile = jest.fn();

jest.mock('../../db', () => ({
  query: (...args) => mockDbQuery(...args),
}));

jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

jest.mock('../../middleware/auth-guest', () => ({
  authenticateOrCreateGuest: (req, res, next) => next(),
}));

jest.mock('../../services/mobile-money/registry', () => ({
  getAdapter: jest.fn((provider) => {
    if (provider !== 'kartapay') {
      const err = new Error('unknown provider');
      err.code = 'mobile_money_provider_unknown';
      throw err;
    }
    return {
      getWebhookReference: (...args) => mockGetWebhookReference(...args),
      verifyWebhook: (...args) => mockVerifyWebhook(...args),
    };
  }),
}));

jest.mock('../../services/payment-mobile-money', () => {
  class MobileMoneyError extends Error {
    constructor(code, message, statusCode = 400) {
      super(message);
      this.name = 'MobileMoneyError';
      this.code = code;
      this.statusCode = statusCode;
    }
  }
  return {
    MobileMoneyError,
    getAvailability: jest.fn(),
    loadOrderForPayment: jest.fn(),
    initiateMobileMoney: jest.fn(),
    reconcileMobileMoneyTransaction: (...args) => mockReconcile(...args),
    getTransaction: jest.fn(),
  };
});

const express = require('express');
const request = require('supertest');

let app;

beforeEach(() => {
  jest.clearAllMocks();
  app = express();
  app.use(express.json());
  jest.isolateModules(() => {
    const router = require('../../routes/payments-mobile-money');
    app.use('/api/payments/mobile-money', router);
  });

  mockGetWebhookReference.mockReturnValue({
    externalTransactionId: 'kp-pay-001',
    clientId: 'client-001',
  });
});

function postWebhook(payload = {}) {
  return request(app)
    .post('/api/payments/mobile-money/webhook/kartapay')
    .set('Content-Type', 'application/json')
    .set('KartaPay-Signature', 'a'.repeat(64))
    .send(payload);
}

describe('POST /api/payments/mobile-money/webhook/kartapay', () => {
  test('référence provider absente => 400', async () => {
    mockGetWebhookReference.mockReturnValue({ externalTransactionId: '' });

    const res = await postWebhook({ topic: 'payment.completed', data: {} });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('provider_webhook_reference_missing');
    expect(mockDbQuery).not.toHaveBeenCalled();
    expect(mockReconcile).not.toHaveBeenCalled();
  });

  test('transaction externe inconnue => 404 sans réconciliation', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const res = await postWebhook({ topic: 'payment.completed', data: { id: 'kp-pay-001' } });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('mobile_money_transaction_not_found');
    expect(mockVerifyWebhook).not.toHaveBeenCalled();
    expect(mockReconcile).not.toHaveBeenCalled();
  });

  test('signature invalide => 401 sans croire le body provider', async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [{
        id: '11111111-1111-4111-8111-111111111111',
        external_transaction_id: 'kp-pay-001',
        provider_payload: { provider: { client_id: 'client-001' } },
      }],
    });
    mockVerifyWebhook.mockReturnValue(false);

    const res = await postWebhook({
      topic: 'payment.completed',
      data: { id: 'kp-pay-001', clientId: 'client-001', status: 'completed' },
    });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('provider_webhook_signature_invalid');
    expect(mockVerifyWebhook).toHaveBeenCalledWith(expect.objectContaining({
      expectedClientId: 'client-001',
      expectedExternalTransactionId: 'kp-pay-001',
    }));
    expect(mockReconcile).not.toHaveBeenCalled();
  });

  test('signature valide => réconciliation canonique qui relit le provider', async () => {
    const txId = '11111111-1111-4111-8111-111111111111';
    mockDbQuery.mockResolvedValueOnce({
      rows: [{
        id: txId,
        external_transaction_id: 'kp-pay-001',
        provider_payload: { provider: { client_id: 'client-001' } },
      }],
    });
    mockVerifyWebhook.mockReturnValue(true);
    mockReconcile.mockResolvedValue({
      transaction: { id: txId, provider: 'kartapay', status: 'succeeded' },
      reconciled: true,
    });

    const res = await postWebhook({
      topic: 'payment.completed',
      data: { id: 'kp-pay-001', clientId: 'client-001', status: 'completed' },
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true, status: 'succeeded' });
    expect(mockReconcile).toHaveBeenCalledTimes(1);
    expect(mockReconcile).toHaveBeenCalledWith(txId, { expectedProvider: 'kartapay' });
  });
});
