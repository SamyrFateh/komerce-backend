'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', '..', 'services', 'order-checkout-service.js'), 'utf8');

describe('checkout — encaissement central autorisé par marché (lot 3)', () => {
  test('la garde s’exécute après la livrabilité et avant le routage', () => {
    const delivery = source.indexOf('assertMarketDeliverable(client, relais.market_id)');
    const gate = source.indexOf('assertCentralCollectionAllowed(client, relais.market_id, payment_mode)');
    const routing = source.indexOf('resolveRoutingFromRelais(relais');
    expect(delivery).toBeGreaterThan(0);
    expect(gate).toBeGreaterThan(delivery);
    expect(routing).toBeGreaterThan(gate);
  });

  test('marché ancré serveur (relais), ROLLBACK + 409 PAYMENT_MODE_NOT_ALLOWED_FOR_MARKET, aucune autorité client', () => {
    expect(source).toMatch(/e\.code === 'PAYMENT_MODE_NOT_ALLOWED_FOR_MARKET'/);
    expect(source).toMatch(/fail\(409, \{ error: e\.message, code: e\.code \}\)/);
    expect(source).not.toMatch(/body\.market_id/);
  });

  test('aucune branche par pays dans le gate', () => {
    const gate = fs.readFileSync(path.join(__dirname, '..', '..', 'services', 'market-payment-collection-gate.js'), 'utf8');
    expect(gate).not.toMatch(/(===|!==|==)\s*'(KM|CM|CG|DJ)'|country_code|countryCode/);
  });
});
