'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
const { fmtMarketAmount, fmtLocalProductPrice, fmtLocalLinesTotal } =
  require('../../js/b-market-price-format.js');

describe('M02 CG buyer price labels: exact approved local currency', () => {
  const product = {
    id: 'KPR-000235', price_kmf: 4991,
    market_price_source: 'LOCAL_ACTIVE',
    market_price_amount: 6654,
    market_price_effective_amount: 6654,
    market_price_currency: 'XAF',
  };
  test('catalog and basket never reconstruct 6655 XAF from 4991 KMF', () => {
    const unit = fmtLocalProductPrice(product);
    const sum = fmtLocalLinesTotal([{ product, price: 4991, qty: 1 }]);
    expect(unit).toBe(fmtMarketAmount(6654, 'XAF'));
    expect(sum).toBe(fmtMarketAmount(6654, 'XAF'));
    expect(unit).not.toContain('6\u202f655');
    expect(unit).not.toContain('6 655');
  });

  test('multiple quantities and promotions stay in exact XAF', () => {
    expect(fmtLocalProductPrice(product, 2)).toBe(fmtMarketAmount(13308, 'XAF'));
    const promo = { ...product, market_price_effective_amount: 5989 };
    expect(fmtLocalProductPrice(promo)).toBe(fmtMarketAmount(5989, 'XAF'));
  });
});
