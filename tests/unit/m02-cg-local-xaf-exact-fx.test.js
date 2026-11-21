'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
// M02/CG approved 6654 XAF must be the same amount in the market/cash
// snapshot, regardless of the rounded 4991 KMF accounting pivot.
jest.mock('../../services/fx-authority', () => ({
  convert: jest.fn(async ({ amount, from, to }) => {
    const value = Number(amount);
    return {
      amount: to === 'EUR' ? Math.round(value / 655.957 * 100) / 100 : value,
      amount_text: String(to === 'EUR' ? Math.round(value / 655.957 * 100) / 100 : value),
      rounding: { minor_unit: to === 'EUR' ? 2 : 0 },
      legs: from === to ? [] : [{ source: 'currency_parities', pair: 'EUR/XAF' }],
    };
  }),
}));

const fx = require('../../services/fx-authority');
const { buildOrderFxSnapshot } = require('../../services/order-fx-snapshot');
const { resolveCollectAmount } = require('../../services/relay-collect-amount');

describe('M02 CG: cash amount comes from approved LOCAL_ACTIVE, not KMF round trip', () => {
  beforeEach(() => fx.convert.mockClear());

  test('6654 XAF in FX snapshot, relay collection and immutable order-360 view', async () => {
    const order = await buildOrderFxSnapshot({
      totalKmf: 4991, marketId: 'cg-market', marketCurrency: 'XAF',
      client: { query: jest.fn() }, exactMarketAmount: 6654,
    });
    expect(order.marketAmount).toBe(6654);
    expect(order.snapshot.origin).toMatchObject({ currency: 'KMF', amount: 4991 });
    expect(order.snapshot.market).toMatchObject({
      currency: 'XAF', amount: 6654, price_authority: 'LOCAL_ACTIVE_MARKET_AMOUNT',
    });
    expect(fx.convert).toHaveBeenCalledWith(expect.objectContaining({
      amount: '6654', from: 'XAF', to: 'XAF',
    }));
    expect(fx.convert).toHaveBeenCalledWith(expect.objectContaining({
      amount: '6654', from: 'XAF', to: 'EUR',
    }));
    expect(resolveCollectAmount({
      total_kmf: 4991, display_total_amount: 6654,
      display_currency: 'XAF', market_currency: 'XAF',
    })).toEqual({ amount: 6654, currency: 'XAF', available: true });
  });
});
