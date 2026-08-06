'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * Invariant #3 (P1) — transcrit tel quel depuis features/payments.feature.js :
 *
 *   « un paiement confirme ne peut etre confirme deux fois »
 *
 * Testé via handleStripeSucceeded et capturePaypalOrder :
 * quand order.payment_status === 'paid', le handler retourne sans
 * émettre de second UPDATE orders SET payment_status = 'paid'.
 */

jest.mock('../../db', () => ({ getClient: jest.fn(), query: jest.fn() }));
jest.mock('../../utils/logger', () => ({
  child: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() })),
}));
jest.mock('../../services/order-payment-confirmation', () => ({ confirmPaymentCycle: jest.fn() }));
jest.mock('../../services/payment-service', () => ({ confirmPaymentAndCompleteOrder: jest.fn(), markRefunded: jest.fn(), markFailed: jest.fn() }));
jest.mock('../../services/refund-service', () => ({ recordExternalRefund: jest.fn(), processRefund: jest.fn() }));
jest.mock('../../services/wallet-service', () => ({ applyWalletToOrder: jest.fn(), reverseWalletCheckout: jest.fn() }));
jest.mock('../../services/order-status-machine', () => ({ transitionOrderStatus: jest.fn(), appendOrderHistoryNote: jest.fn() }));
jest.mock('../../services/pickup-secret-service', () => ({ generateAndStoreSecret: jest.fn(), cacheCodeForReveal: jest.fn() }));
jest.mock('../../services/documents/refund-receipt', () => ({ issue: jest.fn() }));
jest.mock('../../utils/alerts', () => ({ createAlert: jest.fn() }));
jest.mock('stripe', () => jest.fn(() => ({ webhooks: { constructEvent: jest.fn() } })));

const db = require('../../db');
const { makeClient } = require('../integration/test-harness/mock-db');

function alreadyPaid() {
  return { id: 1, reference: 'K-PAID', payment_status: 'paid', user_id: 1,
           stripe_payment_id: 'pi_done', total_kmf: 25000, total_eur: 50 };
}

// ── Stripe ──────────────────────────────────────────────────────────────────
describe('invariant payments — pas de double confirmation Stripe', () => {
  let handleStripeSucceeded;
  beforeEach(() => {
    jest.clearAllMocks(); jest.resetModules();
    handleStripeSucceeded = require('../../services/payment-stripe').handleStripeSucceeded;
  });

  test('payment_intent sur commande déjà paid → 0 écriture payment_status', async () => {
    const client = makeClient([{ rows: [alreadyPaid()] }]);
    db.getClient.mockResolvedValue(client);
    const INTENT = { id: 'pi_done', metadata: { order_reference: 'K-PAID' }, amount_received: 5000 };

    await handleStripeSucceeded({ id: 'evt_dup', type: 'payment_intent.succeeded' }, INTENT, db).catch(() => {});

    const paymentWrites = client.calls.filter(c =>
      /UPDATE orders/i.test(c.sql) && /payment_status/i.test(c.sql)
    );
    expect(paymentWrites).toHaveLength(0);
  });
});

// ── PayPal ───────────────────────────────────────────────────────────────────
describe('invariant payments — pas de double confirmation PayPal', () => {
  let capturePaypalOrder;
  beforeEach(() => {
    jest.clearAllMocks(); jest.resetModules();
    capturePaypalOrder = require('../../services/payment-paypal').capturePaypalOrder;
  });

  test('capture sur commande déjà paid → { already_paid } ou 0 écriture payment_status', async () => {
    const client = makeClient([{ rows: [alreadyPaid()] }]);
    db.getClient.mockResolvedValue(client);

    const result = await capturePaypalOrder({ orderId: 1, paypalOrderId: 'pp_dup', dbClient: client })
      .catch(e => ({ error: String(e) }));

    const paymentWrites = client.calls.filter(c =>
      /UPDATE orders/i.test(c.sql) && /payment_status/i.test(c.sql)
    );
    expect(paymentWrites).toHaveLength(0);
  });
});
