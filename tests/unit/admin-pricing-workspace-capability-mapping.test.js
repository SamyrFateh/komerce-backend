'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const routeSource = fs.readFileSync(path.join(ROOT, 'routes', 'admin-pricing-workspace.js'), 'utf8');
const middlewareSource = fs.readFileSync(
  path.join(ROOT, 'middleware', 'require-market-delegated-capability.js'),
  'utf8'
);

// MARKET-DELEGATION-P0B (Gap 1) : chacun des 10 endpoints d'écriture de
// l'atelier prix doit être gardé par sa capability exacte, jamais par
// `req.user.role === 'market_operator'` seul. Ce test lit le fichier réel —
// il casse si quelqu'un réintroduit un bypass rôle direct.
const EXPECTED_ENDPOINT_CAPABILITY = [
  ["/market/:marketCode/decision-policy'", 'pricing.policy.set'],
  ["/market/:marketCode/price-observations'", 'market.observation.record'],
  ["/market/:marketCode/price-observations/:observationRef/deactivate'", 'market.observation.record'],
  ["/market/:marketCode/products/:productRef/local-price'", 'pricing.decide'],
  ["/market/:marketCode/products/:productRef/local-price/activate'", 'pricing.activate'],
  ["/market/:marketCode/products/:productRef/local-price/reset'", 'pricing.decide'],
  ["/market/:marketCode/cost-components/:key/update'", 'pricing.cost_component.update'],
  ["/market/:marketCode/cost-components/:key/toggle'", 'pricing.cost_component.update'],
  ["/market/:marketCode/cost-components/:key/reset'", 'pricing.cost_component.reset'],
  ["/market/:marketCode/structure-events'", 'structure.event.record'],
];

describe('admin-pricing-workspace — mapping endpoint → capability (MARKET-DELEGATION-P0B Gap 1)', () => {
  test.each(EXPECTED_ENDPOINT_CAPABILITY)('%s est gardé par %s', (routeSuffix, capability) => {
    const routeLineRegex = new RegExp(
      `router\\.post\\('[^']*${routeSuffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\n]*`
    );
    const match = routeSource.match(routeLineRegex);
    expect(match).not.toBeNull();
    expect(match[0]).toMatch(new RegExp(`require(Pricing|LocalStrategy)Capability\\('${capability.replace(/\./g, '\\.')}'\\)`));
  });

  test('les deux anciens gardes rôle→scope (requireMarketPricingManager, requireCountryStrategyManager) ont disparu', () => {
    // Ils existaient avant le fix (Gap 1) ; seules leurs remplaçantes
    // requirePricingCapability / requireLocalStrategyCapability subsistent.
    expect(routeSource).not.toMatch(/function requireMarketPricingManager/);
    expect(routeSource).not.toMatch(/function requireCountryStrategyManager/);
    expect(routeSource).not.toMatch(/,\s*requireMarketPricingManager\s*,/);
    expect(routeSource).not.toMatch(/,\s*requireCountryStrategyManager\s*,/);
  });

  test('requireLocalStrategyCapability n’admet jamais le bypass pricingGlobalAuthority (doctrine country_manager_owns_local_strategy)', () => {
    const fn = routeSource.match(/function requireLocalStrategyCapability\([^)]*\)\s*{[\s\S]*?\n}/);
    expect(fn).not.toBeNull();
    expect(fn[0]).not.toMatch(/pricingGlobalAuthority/);
  });

  test('requirePricingCapability conserve le bypass pricingGlobalAuthority (coûts / politique / structure-events)', () => {
    const fn = routeSource.match(/function requirePricingCapability\([^)]*\)\s*{[\s\S]*?\n}/);
    expect(fn).not.toBeNull();
    expect(fn[0]).toMatch(/pricingGlobalAuthority/);
  });

  test('le middleware capability-based réutilise resolveAuthorization du service de délégation — pas un deuxième système RBAC', () => {
    expect(middlewareSource).toContain("require('../services/market-delegation-service')");
    expect(middlewareSource).toContain('resolveAuthorization');
    // Aucune comparaison de rôle dans le corps du middleware — seul un
    // commentaire de doc peut légitimement mentionner req.user.role en prose.
    expect(middlewareSource).not.toMatch(/req\.user\.role\s*===/);
  });

  test('le middleware audite chaque autorisation via market_delegation_audit (audit())', () => {
    expect(middlewareSource).toContain('audit(db,');
    expect(middlewareSource).toContain("action: 'DELEGATION_CAPABILITY_AUTHORIZED'");
  });
});
