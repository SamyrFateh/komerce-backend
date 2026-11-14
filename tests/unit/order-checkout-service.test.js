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

describe('order-checkout-service — wallet dans la devise du marché', () => {
  test('marché non-KMF : plan de dépense par planWalletSpend (fx-authority), refus 409 si parité absente, KMF inchangé', () => {
    expect(source).toMatch(/walletService\.planWalletSpend\(client, \{/);
    expect(source).toMatch(/WALLET_FX_PARITY_UNAVAILABLE/);
    expect(source).toMatch(/getBalanceInTx\(client, user\.id, 'KMF'\)/);
    expect(source).toMatch(/walletDebit: walletPlan\.debit/);
  });
});

describe('order-checkout-service — relais actif comme destination finale', () => {
  test('relais explicite et marché actif, sans garde de livrabilité documentaire', () => {
    expect(source).toMatch(/SELECT \* FROM relais WHERE id = \$1 AND is_active = TRUE/);
    expect(source).toMatch(/checkoutMarket.lifecycle_status !== 'ACTIVE'/);
    expect(source).not.toMatch(/assertMarketDeliverable|MARKET_DELIVERY_NOT_PROVEN/);
  });
  test('lot 3 — encaissement central après vérification du relais et avant routage', () => {
    const relay = source.indexOf('SELECT * FROM relais WHERE id = $1 AND is_active = TRUE');
    const gate = source.indexOf('assertCentralCollectionAllowed(client, relais.market_id, payment_mode)');
    const routing = source.indexOf('resolveRoutingFromRelais(relais');
    expect(gate).toBeGreaterThan(relay);
    expect(routing).toBeGreaterThan(gate);
    expect(source).toMatch(/e\.code === 'PAYMENT_MODE_NOT_ALLOWED_FOR_MARKET'/);
  });
  test('maritime inclus sans supplément client, aérien toujours contrôlé', () => {
    expect(source).toContain('const transport_price_kmf = 0;');
    expect(source).toMatch(/resolveOrderItemTransportRail\(item\.requested_transport_rail \?\? null\)/);
    expect(source).not.toContain('total_kmf += transport_price_kmf;');
    expect(source).not.toContain('quoteTransportPriceForOrder({');
    expect(source).toMatch(/getRule\('FREIGHT_KMF_PER_KG', 65\)/);
  });
  test('lot 7 — aucun taux de repli : snapshot FX par l\'autorité, refus 503 fx_rate_unavailable', () => {
    expect(source).not.toMatch(/\|\|\s*492/);
    expect(source).not.toMatch(/\|\|\s*138/);
    expect(source).not.toMatch(/AED_KMF_FALLBACK/);
    expect(source).not.toMatch(/getAuthoritativeRates/);
    expect(source).toMatch(/buildOrderFxSnapshot\(/);
    expect(source).toMatch(/fx_rate_unavailable/);
  });
});

describe('order-checkout-service — unification monétaire (pivot EUR, snapshot transport)', () => {
  const fs2 = require('fs');
  const path2 = require('path');
  const src = fs2.readFileSync(path2.join(__dirname, '..', '..', 'services', 'order-checkout-service.js'), 'utf8');

  test('total_eur vient du snapshot de l’autorité unique : plus de finance_config ni de taux de repli', () => {
    expect(src).not.toMatch(/getAuthoritativeRates|eurKmfFinal|assertEurKmfPivotConsistent/);
    expect(src).toMatch(/buildOrderFxSnapshot\(\{[\s\S]{0,160}marketCurrency: checkoutMarket\.currency/);
    expect(src).toMatch(/totalEur: fxSnapshotBuilt\.totalEur/);
    expect(src).toMatch(/fxSnapshot: fxSnapshotBuilt\.snapshot/);
  });

  test('transport client nul et coûts internes préservés ; snapshot FX intact', () => {
    expect(src).toContain('const transport_price_kmf = 0;');
    expect(src).toContain('const transportPricingSnapshot = null;');
    expect(src).toMatch(/transportPriceKmf: transport_price_kmf, transportPricingSnapshot/);
    expect(src).toMatch(/getRule\('FREIGHT_KMF_PER_KG', 65\)/);
    expect(src).toMatch(/e\.code === 'fx_rate_unavailable'/);
  });
  test('previewOnly : même calcul que la création, ROLLBACK avant toute insertion de commande', () => {
    expect(source).toMatch(/previewOnly = false/);
    const previewAt = source.indexOf('if (previewOnly) {');
    const totalAt = source.indexOf('const transport_price_kmf = 0;');
    const insertAt = source.indexOf('const order = await insertOrderRow(client, {');
    expect(totalAt).toBeGreaterThan(0);
    expect(previewAt).toBeGreaterThan(totalAt);
    expect(insertAt).toBeGreaterThan(previewAt);
    expect(source.slice(previewAt, insertAt)).toMatch(/ROLLBACK[\s\S]*items_total_kmf[\s\S]*transport_price_kmf[\s\S]*total_kmf/);
  });
});
