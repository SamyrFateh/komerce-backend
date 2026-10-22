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
    expect(source).toMatch(/SELECT lifecycle_status, code, currency FROM markets WHERE id=\$1::uuid LIMIT 1/);
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
  test('lot 3 — encaissement central autorisé par marché, après livrabilité et avant routage', () => {
    const delivery = source.indexOf('assertMarketDeliverable(client, relais.market_id)');
    const gate = source.indexOf('assertCentralCollectionAllowed(client, relais.market_id, payment_mode)');
    const routing = source.indexOf('resolveRoutingFromRelais(relais');
    expect(gate).toBeGreaterThan(delivery);
    expect(routing).toBeGreaterThan(gate);
    expect(source).toMatch(/e\.code === 'PAYMENT_MODE_NOT_ALLOWED_FOR_MARKET'/);
  });
  test('lot 4 — tarif de transport global refusé hors devise du tarif, avant le devis', () => {
    const gate = source.indexOf('assertTransportTariffApplicable({');
    const quote = source.indexOf('quoteTransportPriceForOrder({');
    expect(gate).toBeGreaterThan(0);
    expect(quote).toBeGreaterThan(gate);
    expect(source).toMatch(/SELECT lifecycle_status, code, currency FROM markets/);
    expect(source).toMatch(/MARKET_TRANSPORT_TARIFF_MISSING/);
  });
  test('lot 7 — aucun taux de repli : taux canonique strict, refus 503 fx_rate_unavailable', () => {
    expect(source).toMatch(/require\('\.\.\/utils\/rates'\)/);
    expect(source).toMatch(/await getAuthoritativeRates\(\)/);
    expect(source).not.toMatch(/\|\|\s*492/);
    expect(source).not.toMatch(/\bgetRates\(/);
    expect(source).toMatch(/fail\(503, \{ error: 'Taux de change temporairement indisponible', code: 'fx_rate_unavailable' \}\)/);
    const rate = source.indexOf('await getAuthoritativeRates()');
    const items = source.indexOf('resolveCheckoutItems({');
    expect(items).toBeGreaterThan(rate);
  });
});
