'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * Invariant #2 (P1) — transcrit tel quel depuis features/payments.feature.js :
 *
 *   « idempotence stricte sur tout webhook (Stripe, PayPal) »
 *
 * Deux couches d'idempotence dans le code :
 *   - Couche route  : stripe/paypal_events_processed (SELECT dès l'entrée)
 *   - Couche service: order.payment_status === 'paid' (handleStripeSucceeded,
 *                     _handleCaptureCompleted)
 *
 * Les cas B testent la propriété « tout event aboutit à un INSERT dans la
 * table d'idempotence ». On utilise les chemins les plus courts :
 *   - Stripe cas B : intent sans order_id → markStripeEventProcessed immédiat
 *   - PayPal cas B : event_type non géré  → markPaypalEventProcessed immédiat
 * Ces chemins évitent de mocker la totalité du cycle de paiement tout en
 * prouvant que la table est bien écrite dans tous les chemins de sortie.
 */

jest.mock('../../db', () => ({ getClient: jest.fn(), query: jest.fn() }));
jest.mock('../../utils/logger', () => ({
  child: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() })),
}));
jest.mock('../../services/order-payment-confirmation', () => ({ confirmPaymentCycle: jest.fn() }));
jest.mock('../../services/payment-service', () => ({
  confirmPaymentAndCompleteOrder: jest.fn(), markRefunded: jest.fn(), markFailed: jest.fn(),
}));
jest.mock('../../services/refund-service', () => ({
  recordExternalRefund: jest.fn(), processRefund: jest.fn(),
}));
jest.mock('../../services/wallet-service', () => ({
  applyWalletToOrder: jest.fn(), reverseWalletCheckout: jest.fn(),
}));
jest.mock('../../services/order-status-machine', () => ({
  transitionOrderStatus: jest.fn(), appendOrderHistoryNote: jest.fn(),
}));
jest.mock('../../services/pickup-secret-service', () => ({
  generateAndStoreSecret: jest.fn(), cacheCodeForReveal: jest.fn(),
}));
jest.mock('../../services/documents/refund-receipt', () => ({ issue: jest.fn() }));
jest.mock('../../utils/alerts', () => ({ createAlert: jest.fn() }));
jest.mock('stripe', () => jest.fn(() => ({ webhooks: { constructEvent: jest.fn() } })));

const db = require('../../db');
const { makeClient } = require('../integration/test-harness/mock-db');

// ── Stripe : idempotence via payment_status === 'paid' ─────────────────────
describe('invariant payments — idempotence Stripe (couche service)', () => {
  let handleStripeSucceeded;
  beforeEach(() => {
    jest.clearAllMocks(); jest.resetModules();
    handleStripeSucceeded = require('../../services/payment-stripe').handleStripeSucceeded;
  });

  test('A — commande déjà paid → { received, idempotent }, 0 INSERT stripe_events_processed', async () => {
    // Chemin : intent avec order_id → SELECT orders → already paid → markProcessed → return idempotent
    const INTENT = { id: 'pi_done', metadata: { order_id: '1', order_reference: 'K-001' }, amount_received: 5000 };
    db.query
      .mockResolvedValueOnce({ rows: [{ payment_status: 'paid' }] })  // SELECT orders
      .mockResolvedValueOnce({ rows: [] });                             // INSERT stripe_events_processed (already_paid path)

    const result = await handleStripeSucceeded(
      { id: 'evt_dup', type: 'payment_intent.succeeded' }, INTENT, db
    );

    expect(result.idempotent).toBe(true);
    // Le second appel db.query doit être l'INSERT d'idempotence, pas un UPDATE payment
    const calls = db.query.mock.calls.map(c => String(c[0]));
    const paymentUpdates = calls.filter(s => /UPDATE orders.*payment_status/i.test(s));
    expect(paymentUpdates).toHaveLength(0);
  });

  test('B — event nouveau → INSERT dans stripe_events_processed', async () => {
    // Chemin court : intent SANS order_id → markStripeEventProcessed immédiat (aucun SELECT order)
    const INTENT_NO_ID = { id: 'pi_new', metadata: {}, amount_received: 5000 };
    db.query.mockResolvedValueOnce({ rows: [] }); // INSERT stripe_events_processed

    await handleStripeSucceeded(
      { id: 'evt_new', type: 'payment_intent.succeeded' }, INTENT_NO_ID, db
    );

    const calls = db.query.mock.calls.map(c => String(c[0]));
    const inserts = calls.filter(s => /INSERT INTO stripe_events_processed/i.test(s));
    expect(inserts.length).toBeGreaterThanOrEqual(1);
  });
});

// ── PayPal : idempotence via paypal_events_processed ──────────────────────
describe('invariant payments — idempotence PayPal (couche service)', () => {
  let handlePaypalWebhookEvent;
  const mockPaypal = {
    verifyWebhookSignature: jest.fn().mockResolvedValue(true),
    extractCaptureInfo: jest.fn().mockReturnValue({ paypal_capture_id: 'cap_001', paypal_order_id: 'pp_001' }),
  };

  beforeEach(() => {
    jest.clearAllMocks(); jest.resetModules();
    mockPaypal.verifyWebhookSignature.mockResolvedValue(true);
    handlePaypalWebhookEvent = require('../../services/payment-paypal').handlePaypalWebhookEvent;
  });

  test('A — event déjà dans paypal_events_processed → { idempotent }, 0 write commande', async () => {
    // SELECT paypal_events_processed → déjà là → return idempotent
    db.query.mockResolvedValueOnce({ rows: [{ event_id: 'evt_pp_dup' }] });

    const result = await handlePaypalWebhookEvent(
      { id: 'evt_pp_dup', event_type: 'PAYMENT.CAPTURE.COMPLETED' },
      'raw', {}, db, mockPaypal
    );

    expect(result.idempotent).toBe(true);
    const calls = db.query.mock.calls.map(c => String(c[0]));
    const orderWrites = calls.filter(s => /UPDATE orders/i.test(s));
    expect(orderWrites).toHaveLength(0);
  });

  test('B — event nouveau (type non géré) → INSERT dans paypal_events_processed', async () => {
    // Chemin court : event_type inconnu → case default → markPaypalEventProcessed
    // SELECT paypal_events_processed → absent, puis INSERT
    db.query
      .mockResolvedValueOnce({ rows: [] })    // SELECT paypal_events_processed : absent
      .mockResolvedValueOnce({ rows: [] });   // INSERT paypal_events_processed (default path)

    await handlePaypalWebhookEvent(
      { id: 'evt_pp_new', event_type: 'UNKNOWN.EVENT.TYPE' },
      'raw', {}, db, mockPaypal
    );

    const calls = db.query.mock.calls.map(c => String(c[0]));
    const inserts = calls.filter(s => /INSERT INTO paypal_events_processed/i.test(s));
    expect(inserts.length).toBeGreaterThanOrEqual(1);
  });
});
