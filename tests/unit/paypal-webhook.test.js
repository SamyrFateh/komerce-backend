'use strict';

/**
 * tests/unit/paypal-webhook.test.js
 *
 * Tests du handler webhook PayPal (routes/payments-paypal.js)
 *
 * Couverture :
 *   ✓ Signature invalide → 401
 *   ✓ Event mal formé (sans id) → 400
 *   ✓ Body non-JSON → 400
 *   ✓ Event déjà traité (idempotence) → 200 + idempotent:true (pas de double process)
 *   ✓ PAYMENT.CAPTURE.COMPLETED — flow fallback (capture endpoint avait planté)
 *   ✓ PAYMENT.CAPTURE.COMPLETED — order déjà paid → noop sans cycle
 *   ✓ PAYMENT.CAPTURE.COMPLETED — order introuvable → ignored
 *   ✓ PAYMENT.CAPTURE.DENIED → alerte + processed
 *   ✓ CUSTOMER.DISPUTE.CREATED → alerte critique
 *   ✓ Event type inconnu → ignored
 */

// ─── Mocks AVANT le require de la route ─────────────────────────────────────

jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
  forModule: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

jest.mock('../../middleware/auth',       () => ({ authenticate: (req, res, next) => next(), requireAdmin: (req, res, next) => next(), requireRole: () => (req, res, next) => next() }));
jest.mock('../../middleware/auth-guest', () => ({ authenticateOrCreateGuest: (req, res, next) => next() }));

// DB mock avec accumulateur d'appels
const dbQueries = [];
jest.mock('../../db', () => {
  const mockClient = {
    query: jest.fn(async (sql, params) => {
      dbQueries.push({ sql: sql.replace(/\s+/g, ' ').trim().slice(0, 80), params });
      return { rows: [] };
    }),
    release: jest.fn(),
  };
  return {
    query: jest.fn(async (sql, params) => {
      dbQueries.push({ sql: sql.replace(/\s+/g, ' ').trim().slice(0, 80), params });
      return { rows: [] };
    }),
    pool: { connect: jest.fn(async () => mockClient) },
    _mockClient: mockClient,
  };
});

jest.mock('../../services/paypal-client', () => ({
  verifyWebhookSignature: jest.fn(),
  extractCaptureInfo:     jest.fn(),
}));

jest.mock('../../services/order-payment-confirmation', () => ({
  confirmPaymentCycle: jest.fn(),
}));

jest.mock('../../services/parcel-security', () => ({
  generateAndStoreSecret: jest.fn(async () => ({ code: 'TESTCODE' })),
  cacheCodeForReveal:     jest.fn(async () => null),
}));

// ─── Setup Express ──────────────────────────────────────────────────────────

const express = require('express');
const request = require('supertest');
const db      = require('../../db');
const paypal  = require('../../services/paypal-client');
const { confirmPaymentCycle } = require('../../services/order-payment-confirmation');

let app;

beforeEach(() => {
  jest.clearAllMocks();
  dbQueries.length = 0;

  app = express();
  // /webhook reçoit du raw body en prod — on simule avec text-parser
  app.use('/api/payments/paypal/webhook', express.raw({ type: '*/*' }));
  app.use(express.json());

  // Re-require pour reset l'état du router
  jest.isolateModules(() => {
    const router = require('../../routes/payments-paypal');
    app.use('/api/payments/paypal', router);
  });
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeEvent({ id = 'EV-1', type = 'PAYMENT.CAPTURE.COMPLETED', resource = {} } = {}) {
  return {
    id,
    event_type: type,
    resource:   { id: 'CAP-default', status: 'COMPLETED', amount: { currency_code: 'EUR', value: '100.00' }, ...resource },
  };
}

function postWebhook(payload, headers = {}) {
  return request(app)
    .post('/api/payments/paypal/webhook')
    .set('Content-Type', 'application/json')
    .set('paypal-transmission-id',   headers['paypal-transmission-id']   || 'TX-1')
    .set('paypal-transmission-sig',  headers['paypal-transmission-sig']  || 'SIG-1')
    .set('paypal-cert-url',          'https://api.paypal.com/cert.pem')
    .set('paypal-auth-algo',         'SHA256withRSA')
    .set('paypal-transmission-time', '2026-06-08T10:00:00Z')
    .send(typeof payload === 'string' ? payload : JSON.stringify(payload));
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('POST /api/payments/paypal/webhook', () => {

  test('signature invalide → 401', async () => {
    paypal.verifyWebhookSignature.mockResolvedValue(false);
    const res = await postWebhook(makeEvent());
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/signature/i);
  });

  test('body non-JSON → 400', async () => {
    const res = await postWebhook('not-json-{{');
    expect(res.status).toBe(400);
  });

  test('event sans id → 400', async () => {
    const res = await postWebhook({ event_type: 'PAYMENT.CAPTURE.COMPLETED' });
    expect(res.status).toBe(400);
  });

  test('event sans event_type → 400', async () => {
    const res = await postWebhook({ id: 'EV-X' });
    expect(res.status).toBe(400);
  });

  test('event déjà traité (idempotent) → 200 + idempotent:true, pas de cycle', async () => {
    paypal.verifyWebhookSignature.mockResolvedValue(true);
    // db.query (1er appel) retourne seen.rows.length > 0
    db.query.mockResolvedValueOnce({ rows: [{ exists: 1 }] });

    const res = await postWebhook(makeEvent({ id: 'EV-DUPL' }));
    expect(res.status).toBe(200);
    expect(res.body.idempotent).toBe(true);
    expect(confirmPaymentCycle).not.toHaveBeenCalled();
  });

  test('PAYMENT.CAPTURE.COMPLETED — order introuvable → ignored', async () => {
    paypal.verifyWebhookSignature.mockResolvedValue(true);
    paypal.extractCaptureInfo.mockReturnValue({
      paypal_capture_id: 'CAP-UNKNOWN',
      paypal_order_id:   null,
      reference_id:      null,
      amount_value:      100,
    });
    db.query.mockImplementation(async (sql, params) => {
      dbQueries.push({ sql: sql.replace(/\s+/g, ' ').trim().slice(0, 80), params });
      return { rows: [] };
    }); // toutes les recherches retournent vide

    const res = await postWebhook(makeEvent());
    expect(res.status).toBe(200);
    expect(confirmPaymentCycle).not.toHaveBeenCalled();
    // markEventProcessed avec status='ignored'
    const inserts = dbQueries.filter(q => q.sql.includes('paypal_events_processed'));
    expect(inserts.length).toBeGreaterThan(0);
  });

  test('PAYMENT.CAPTURE.COMPLETED — order déjà paid → noop sans cycle', async () => {
    paypal.verifyWebhookSignature.mockResolvedValue(true);
    paypal.extractCaptureInfo.mockReturnValue({
      paypal_capture_id: 'CAP-1', paypal_order_id: null, reference_id: 'K-1', amount_value: 100,
    });
    // Premier db.query (seen) → vide
    // Deuxième db.query (lookup capture) → vide
    // Troisième db.query (lookup order_id) → skipped (null)
    // Quatrième db.query (lookup ref) → order paid
    db.query
      .mockResolvedValueOnce({ rows: [] })                                  // seen check
      .mockResolvedValueOnce({ rows: [] })                                  // lookup by capture_id
      .mockResolvedValueOnce({ rows: [{ id: 'ord-1', payment_status: 'paid', reference: 'K-1' }] }); // lookup by reference

    const res = await postWebhook(makeEvent());
    expect(res.status).toBe(200);
    expect(confirmPaymentCycle).not.toHaveBeenCalled();
  });

  test('PAYMENT.CAPTURE.COMPLETED — flow fallback : déclenche confirmPaymentCycle si order pending', async () => {
    paypal.verifyWebhookSignature.mockResolvedValue(true);
    paypal.extractCaptureInfo.mockReturnValue({
      paypal_capture_id: 'CAP-1', paypal_order_id: 'PP-ORDER-1',
      reference_id: 'K-1', amount_value: 149.90,
    });
    confirmPaymentCycle.mockResolvedValue({ success: true, noop: false, stockBlocked: false });

    db.query
      .mockResolvedValueOnce({ rows: [] })                                  // seen
      .mockResolvedValueOnce({ rows: [] })                                  // lookup capture
      .mockResolvedValueOnce({ rows: [{ id: 'ord-1', payment_status: 'pending', reference: 'K-1' }] }); // lookup order

    const res = await postWebhook(makeEvent());
    expect(res.status).toBe(200);
    expect(confirmPaymentCycle).toHaveBeenCalledWith(expect.objectContaining({
      orderId: 'ord-1',
      source:  'paypal_capture',
    }));
    // BEGIN + COMMIT sur le mockClient
    const clientQueries = db._mockClient.query.mock.calls.map(c => c[0]);
    expect(clientQueries.some(q => /BEGIN/i.test(q))).toBe(true);
    expect(clientQueries.some(q => /COMMIT/i.test(q))).toBe(true);
  });

  test('PAYMENT.CAPTURE.COMPLETED — cycle rejected → ROLLBACK, event marqué rejected', async () => {
    paypal.verifyWebhookSignature.mockResolvedValue(true);
    paypal.extractCaptureInfo.mockReturnValue({
      paypal_capture_id: 'CAP-1', paypal_order_id: 'PP-1',
      reference_id: 'K-1', amount_value: 100,
    });
    confirmPaymentCycle.mockResolvedValue({ success: false, error: 'transition impossible' });

    db.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'ord-1', payment_status: 'pending', reference: 'K-1' }] });

    const res = await postWebhook(makeEvent());
    expect(res.status).toBe(200);
    const clientQueries = db._mockClient.query.mock.calls.map(c => c[0]);
    expect(clientQueries.some(q => /ROLLBACK/i.test(q))).toBe(true);
  });

  test('PAYMENT.CAPTURE.DENIED → insert alerte warning', async () => {
    paypal.verifyWebhookSignature.mockResolvedValue(true);
    paypal.extractCaptureInfo.mockReturnValue({ paypal_capture_id: 'CAP-X', reference_id: 'K-1' });

    const res = await postWebhook(makeEvent({ type: 'PAYMENT.CAPTURE.DENIED' }));
    expect(res.status).toBe(200);
    const inserts = dbQueries.filter(q => q.sql.includes('INSERT INTO alerts'));
    expect(inserts.length).toBeGreaterThanOrEqual(1);
    expect(inserts[0].params[0]).toBe('paypal_capture_denied');
    expect(inserts[0].params[3]).toBe('medium');
  });

  test('CUSTOMER.DISPUTE.CREATED → insert alerte critical', async () => {
    paypal.verifyWebhookSignature.mockResolvedValue(true);

    const event = {
      id: 'EV-DISP',
      event_type: 'CUSTOMER.DISPUTE.CREATED',
      resource: {
        dispute_id: 'PP-D-1',
        dispute_state: 'OPEN',
        reason: 'item_not_received',
      },
    };
    const res = await postWebhook(event);
    expect(res.status).toBe(200);
    const inserts = dbQueries.filter(q => q.sql.includes('INSERT INTO alerts'));
    expect(inserts.length).toBeGreaterThanOrEqual(1);
    expect(inserts[0].params[0]).toBe('paypal_dispute');
    expect(inserts[0].params[3]).toBe('high');
  });

  test('Event type inconnu → 200 + ignored:true', async () => {
    paypal.verifyWebhookSignature.mockResolvedValue(true);
    const res = await postWebhook(makeEvent({ type: 'BILLING.SUBSCRIPTION.CREATED' }));
    expect(res.status).toBe(200);
    expect(res.body.ignored).toBe(true);
    expect(confirmPaymentCycle).not.toHaveBeenCalled();
  });
});
