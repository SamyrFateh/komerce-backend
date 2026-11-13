'use strict';
/** @test-kind unit @test-runner jest @test-requires none
 * F3: old PayPal admin refund writer is closed. Crash/idempotency and
 * partial/full settlement proofs live in paypal-refund-authority.test.js.
 */
const mockAuthority = jest.fn(async () => ({
  status: 403, body: { code: 'REFUND_PSP_NOT_CERTIFIED' },
}));
jest.mock('../../services/paypal-refund-authority', () => ({
  refundPaypalOrder: (...args) => mockAuthority(...args),
}));
jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));
const { refundPaypalOrder } = require('../../services/payment-paypal');

test('RC-9: deux appels au service legacy ne declenchent aucun POST PayPal direct', async () => {
  mockAuthority.mockClear();
  const paypal = { refundCapture: jest.fn() };
  const args = { orderId: 'o1', amountEur: 10, paypal, db: {} };
  const results = await Promise.all([refundPaypalOrder(args), refundPaypalOrder(args)]);
  expect(results.map(x => x.status)).toEqual([403, 403]);
  expect(mockAuthority).toHaveBeenCalledTimes(2);
  expect(paypal.refundCapture).not.toHaveBeenCalled();
});
