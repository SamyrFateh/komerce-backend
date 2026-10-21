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
    expect(source).toMatch(/SELECT lifecycle_status, code FROM markets WHERE id=\$1::uuid LIMIT 1/);
    expect(source).toMatch(/checkoutMarket\.lifecycle_status !== 'ACTIVE'/);
    expect(source).toMatch(/MARKET_SUSPENDED/);
    expect(source).toMatch(/MARKET_NOT_ACTIVE/);
  });
  test('RCT1 is staging-only and scoped inside checkout transaction, not public body', () => {
    expect(source).toMatch(/internalSimulation = null/);
    expect(source).toMatch(/process\.env\.KOMERCE_ENV !== 'staging'/);
    expect(source).toMatch(/internalSimulation\.scope !== 'RCT1'/);
    expect(source).toMatch(/assignOrderSimulationScope\(client, \{/);
    const scopeAt = source.indexOf('await assignOrderSimulationScope(client, {');
    const commitAt = source.indexOf("await client.query('COMMIT')", scopeAt);
    expect(scopeAt).toBeGreaterThan(0);
    expect(commitAt).toBeGreaterThan(scopeAt);
  });
  test('serializes RCT1 E1/G references and refuses duplicate checkout', () => {
    expect(source).toMatch(/reserveRct1OrderReference\(client, internalSimulation.reference\)/);
    expect(source).toMatch(/RCT1_ORDER_ALREADY_EXISTS/);
    expect(source).toMatch(/internalSimulation \? internalSimulation.reference : await getUniqueRef\(db\)/);
    expect(source).toMatch(/isAllowedRct1Reference/);
  });
  test('E1 refuses checkout total mismatch before inserting order', () => {
    expect(source).toMatch(/RCT1_CHECKOUT_TOTAL_MISMATCH/);
    expect(source).toMatch(/Number\(total_kmf\) - Number\(transport_price_kmf\) !== expectedProductTotal/);
    const totalGate = source.indexOf('RCT1_CHECKOUT_TOTAL_MISMATCH');
    const insertAt = source.indexOf('const order = await insertOrderRow(client, {');
    expect(totalGate).toBeGreaterThan(0);
    expect(insertAt).toBeGreaterThan(totalGate);
  });
});

describe('order-checkout-service — livrabilité du marché', () => {
  test('le checkout importe la garde de livrabilité (preuve : tests/unit/order-checkout-delivery-proof.test.js)', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../services/order-checkout-service.js'), 'utf8');
    expect(src).toMatch(/require\('\.\/market-delivery-proof-service'\)/);
    expect(src).toMatch(/assertMarketDeliverable\(client, relais\.market_id\)/);
  });
});
