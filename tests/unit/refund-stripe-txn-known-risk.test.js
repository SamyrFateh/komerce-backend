'use strict';

/**
 * @test-kind unit @test-runner jest @test-requires none
 *
 * RC-5 — characterisation of the durable-refund gap. Stripe is always
 * fake; no network or financial write. A test.failing records the expected
 * safe behaviour, and a positive witness proves it fails for the real reason.
 * Do NOT convert to a green regular test without changing the service.
 */
const mockStripeRefundCreate = jest.fn();
jest.mock('stripe', () => jest.fn(() => ({ refunds: { create: mockStripeRefundCreate } })));
jest.mock('../../services/wallet-service', () => ({ credit: jest.fn() }));
jest.mock('../../services/order-fx-snapshot', () => ({
  assertRefundWithinCaptured: jest.fn().mockResolvedValue(undefined),
  assertRefundRecordCompatible: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../services/documents/refund-receipt', () => ({ issue: jest.fn() }));
jest.mock('../../services/cost-allocation/canonical-margin-writer', () => ({
  refreshCanonicalMarginForOrders: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const { processRefund } = require('../../services/refund-service');

function scenario() {
  const order = {
    id: 'test-order', reference: 'TEST-ORDER',
    payment_mode: 'stripe_eur', stripe_payment_id: 'pi_fake_1',
    user_id: 'fake-user', market_id: null,
  };
  const statements = [];
  const client = {
    query: jest.fn(async (sql) => {
      statements.push(sql);
      if (String(sql).includes('INSERT INTO refunds')) {
        return { rows: [{ id: 'pending-refund-1' }] };
      }
      return { rows: [] };
    }),
  };
  return { client, order, statements };
}
beforeEach(() => {
  jest.clearAllMocks();
  mockStripeRefundCreate.mockResolvedValue({ id: 're_fake_1', status: 'succeeded' });
});

test.failing('RC-5 — aucun appel externe ne précède le COMMIT de l intention persistée', async () => {
  const { client, order, statements } = scenario();
  await processRefund(client, order, 5000, 10, 'full', 'test', 'admin');
  expect(statements.some(x => String(x).includes('COMMIT'))).toBe(true);
});

test('RC-5 — témoin positif : Stripe factice a été appelé malgré absence de COMMIT', async () => {
  const { client, order, statements } = scenario();
  const result = await processRefund(client, order, 5000, 10, 'full', 'test', 'admin');
  expect(result.stripeRefundId).toBe('re_fake_1');
  expect(mockStripeRefundCreate).toHaveBeenCalledTimes(1);
  expect(statements.some(x => String(x).includes('INSERT INTO refunds'))).toBe(true);
  expect(statements.some(x => String(x).includes('COMMIT'))).toBe(false);

  // Simulation du rollback par le caller : la requête Stripe factice est
  // déjà partie. Ce test NE démontre PAS un remboursement réel.
  await client.query('ROLLBACK');
  expect(mockStripeRefundCreate).toHaveBeenCalledTimes(1);
});
