'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', '..', 'services', 'order-checkout-service.js'), 'utf8');

describe('checkout — livrabilité prouvée avant toute commande payante', () => {
  test('la garde s’exécute après le gate lifecycle et avant le routage', () => {
    const lifecycle = source.indexOf("code: 'MARKET_NOT_ACTIVE'");
    const gate = source.indexOf('assertMarketDeliverable(client, relais.market_id)');
    const routing = source.indexOf('resolveRoutingFromRelais(relais');
    expect(lifecycle).toBeGreaterThan(0);
    expect(gate).toBeGreaterThan(lifecycle);
    expect(routing).toBeGreaterThan(gate);
  });

  test('marché ancré serveur (relais), ROLLBACK + 409 MARKET_DELIVERY_NOT_PROVEN, aucune autorité client', () => {
    expect(source).toMatch(/e\.code === 'MARKET_DELIVERY_NOT_PROVEN'/);
    expect(source).toMatch(/fail\(409, \{ error: e\.message, code: e\.code \}\)/);
    expect(source).not.toMatch(/body\.market_id/);
  });

  test('les tarifs globaux ne valent jamais preuve : la garde ne lit aucune règle business_rules', () => {
    const proof = fs.readFileSync(path.join(__dirname, '..', '..', 'services', 'market-delivery-proof-service.js'), 'utf8');
    expect(proof).not.toMatch(/getRule|business_rules/);
  });
});
