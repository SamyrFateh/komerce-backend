'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const fs=require('fs');
const path=require('path');
const source=fs.readFileSync(path.join(__dirname,'../../services/order-checkout-service.js'),'utf8');
describe('checkout — livraison par relais, sans attestation transporteur',()=>{
  test('relais explicite actif lié à son marché, marché ACTIVE, puis paiement et routage',()=>{
    const required=source.indexOf("code: 'relay_required'");
    const activeRelay=source.indexOf('SELECT * FROM relais WHERE id = $1 AND is_active = TRUE');
    const market=source.indexOf("SELECT lifecycle_status, code, currency FROM markets WHERE id=$1::uuid");
    const lifecycle=source.indexOf("checkoutMarket.lifecycle_status !== 'ACTIVE'");
    const payment=source.indexOf('assertCentralCollectionAllowed(client, relais.market_id, payment_mode)');
    const routing=source.indexOf('resolveRoutingFromRelais(relais');
    expect(required).toBeGreaterThan(0);
    expect(activeRelay).toBeGreaterThan(required);
    expect(market).toBeGreaterThan(activeRelay);
    expect(lifecycle).toBeGreaterThan(market);
    expect(payment).toBeGreaterThan(lifecycle);
    expect(routing).toBeGreaterThan(payment);
  });
  test('aucune obligation de contrat, d’attestation ou historique livré',()=>{
    expect(source).not.toMatch(/assertMarketDeliverable|MARKET_DELIVERY_NOT_PROVEN/);
    expect(source).not.toMatch(/body\.market_id/);
  });
});
