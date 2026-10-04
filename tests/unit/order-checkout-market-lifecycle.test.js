'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

describe('orders checkout — market lifecycle guard', () => {
  const source = fs.readFileSync(path.join(ROOT, 'services', 'order-checkout-service.js'), 'utf8');

  test('checkout resolves lifecycle from the server-owned relay market', () => {
    expect(source).toMatch(/SELECT lifecycle_status FROM markets WHERE id=\$1::uuid LIMIT 1/);
    expect(source).toMatch(/\[relais\.market_id\]/);
    expect(source).not.toMatch(/body\.market_id/);
  });

  test('SUSPENDED explicitly refuses order creation and all non-ACTIVE states fail closed', () => {
    expect(source).toMatch(/checkoutMarket\.lifecycle_status !== 'ACTIVE'/);
    expect(source).toMatch(/MARKET_SUSPENDED/);
    expect(source).toMatch(/MARKET_NOT_ACTIVE/);
  });

  test('guard executes before pricing and order persistence', () => {
    const guard = source.indexOf("SELECT lifecycle_status FROM markets");
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(source.indexOf('applyActiveMarketPricesToCheckoutItems'));
    expect(guard).toBeLessThan(source.indexOf('insertOrderRow(client'));
  });
});
