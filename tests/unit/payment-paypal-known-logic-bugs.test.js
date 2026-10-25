'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 *
 * Reproduction RC-9 from the Opus transcript, using the REAL refundPaypalOrder
 * function with a FAKE PayPal client. No remote PayPal call, no money movement.
 *
 * The explicit "normal" mode MUST fail on the business assertion itself.
 * After a fix, convert these test.failing to permanent standard tests.
 */
jest.mock('../../services/documents/refund-receipt', () => ({ issue: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../services/order-payment-confirmation', () => ({ confirmPaymentCycle: jest.fn() }));
jest.mock('../../services/payment-service', () => ({ markRefunded: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../services/order-mutation-service', () => ({
  setPaypalOrderId: jest.fn(), setPaypalCaptureMetadata: jest.fn(),
  setPaypalCaptureId: jest.fn(), appendOrderNote: jest.fn(),
}));
jest.mock('../../services/refund-service', () => ({ recordExternalRefund: jest.fn().mockResolvedValue('local-refund-id') }));
jest.mock('../../services/order-status-machine', () => ({
  appendOrderHistoryNote: jest.fn().mockResolvedValue(undefined),
  transitionOrderStatus: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../services/pickup-secret-service', () => ({
  generateAndStoreSecret: jest.fn(), cacheCodeForReveal: jest.fn(),
}));
jest.mock('../../utils/alerts', () => ({ createAlert: jest.fn() }));

const { refundPaypalOrder } = require('../../services/payment-paypal');
const { markRefunded } = require('../../services/payment-service');
const { transitionOrderStatus } = require('../../services/order-status-machine');
const knownBug = process.env.KMC_KNOWN_BUGS_AS_TESTS === '1' ? test : test.failing;

function fixtures() {
  const order = {
    id: 'fake-order-1', paypal_capture_id: 'cap-test-1', payment_status: 'paid',
    total_eur: 100, total_kmf: 50000,
  };
  const db = { query: jest.fn().mockResolvedValue({ rows: [order] }) };
  const calls = [];
  const paypal = {
    calls,
    refundCapture: jest.fn().mockImplementation(async (captureId, args) => {
      calls.push({ captureId, amountEur: args.amountEur });
      return { id: 'refund-' + calls.length, status: 'COMPLETED' };
    }),
  };
  return { db, paypal };
}
beforeEach(() => jest.clearAllMocks());

knownBug('RC-9 — deux demandes simultanées pour la même capture ne produisent qu un appel PayPal', async () => {
  const { db, paypal } = fixtures();
  await Promise.all([
    refundPaypalOrder({ orderId: 'fake-order-1', amountEur: 10, paypal, db }),
    refundPaypalOrder({ orderId: 'fake-order-1', amountEur: 10, paypal, db }),
  ]);
  expect(paypal.calls).toHaveLength(1);
});

knownBug('RC-9 — remboursement PayPal partiel ne clôture pas une commande comme totalement remboursée', async () => {
  const { db, paypal } = fixtures();
  const result = await refundPaypalOrder({ orderId: 'fake-order-1', amountEur: 10, paypal, db });
  expect(result.status).toBe(200);
  expect(markRefunded).not.toHaveBeenCalled();
  expect(transitionOrderStatus).not.toHaveBeenCalledWith(
    expect.objectContaining({ newStatus: 'refunded' })
  );
});

test('RC-9 — la reproduction prouve bien deux appels au client PayPal factice', async () => {
  const { db, paypal } = fixtures();
  const responses = await Promise.all([
    refundPaypalOrder({ orderId: 'fake-order-1', amountEur: 10, paypal, db }),
    refundPaypalOrder({ orderId: 'fake-order-1', amountEur: 10, paypal, db }),
  ]);
  expect(responses.map(r => r.status)).toEqual([200, 200]);
  expect(paypal.calls.map(c => c.amountEur)).toEqual([10, 10]);
});

test('RC-9 — la reproduction prouve que le remboursement partiel clôture à tort le cycle de paiement', async () => {
  const { db, paypal } = fixtures();
  const response = await refundPaypalOrder({ orderId: 'fake-order-1', amountEur: 10, paypal, db });
  expect(response.status).toBe(200);
  expect(paypal.calls).toHaveLength(1);
  expect(markRefunded).toHaveBeenCalledTimes(1);
  expect(transitionOrderStatus).toHaveBeenCalledWith(
    expect.objectContaining({ newStatus: 'refunded' })
  );
});
