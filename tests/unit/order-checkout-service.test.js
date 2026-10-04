'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(
  path.join(__dirname, '..', '..', 'services', 'order-checkout-service.js'),
  'utf8'
);

describe('order-checkout-service market lifecycle', () => {
  test('fails closed unless the relay market is ACTIVE', () => {
    expect(source).toMatch(/SELECT lifecycle_status FROM markets WHERE id=\$1::uuid LIMIT 1/);
    expect(source).toMatch(/checkoutMarket\.lifecycle_status !== 'ACTIVE'/);
    expect(source).toMatch(/MARKET_SUSPENDED/);
    expect(source).toMatch(/MARKET_NOT_ACTIVE/);
  });
});
