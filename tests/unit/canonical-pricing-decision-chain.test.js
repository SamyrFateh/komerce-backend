'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const CANONICAL = path.join(ROOT, 'public', 'dashboards', 'canonical');

test('la chaîne économique canonical consomme les projections serveur sans recalcul métier navigateur', () => {
  const source = fs.readFileSync(path.join(CANONICAL, 'js', 'pricing-decision-chain.js'), 'utf8');
  const css = fs.readFileSync(path.join(CANONICAL, 'css', 'pricing-decision-chain.css'), 'utf8');
  const index = fs.readFileSync(path.join(CANONICAL, 'index.html'), 'utf8');

  expect(index).toContain('/dashboards/canonical/js/pricing-decision-chain.js?v=1302');
  expect(index).toContain('/dashboards/canonical/css/pricing-decision-chain.css?v=1302');
  expect(source).toContain('/corridor?product_ref=');
  expect(source).toContain('`${endpoint}/decision`');
  expect(source).toContain('economics.variable_cost_complete_kmf');
  expect(source).toContain('economics.contribution_unit_kmf');
  expect(source).toContain('state.period_contribution_kmf');
  expect(source).toContain('state.period_n3_kmf');
  expect(source).toContain('state.coverage_ratio');
  expect(source).toContain('state.period_result_kmf');
  expect(source).toContain('le navigateur ne les multiplie pas entre eux');
  expect(source).not.toContain('market_id');
  expect(source).not.toContain('marketId');
  expect(css).toContain('.kmc-decision-chain-unit');
  expect(css).toContain('.kmc-decision-chain-period');
});

test('absence de corridor local ne promeut jamais la concurrence globale en vérité pays', () => {
  const source = fs.readFileSync(path.join(CANONICAL, 'js', 'pricing-decision-chain.js'), 'utf8');
  const service = fs.readFileSync(path.join(ROOT, 'services', 'pricing-market-corridor.js'), 'utf8');

  expect(source).toContain('Aucune observation locale');
  expect(source).toContain('Référence globale informative');
  expect(service).toContain("status: scope === 'market' ? 'LOCAL_EVIDENCE_MISSING' : 'NO_REFERENCE'");
  expect(service).toContain("authority: 'OBSERVED_REFERENCE_NOT_GATE'");
  expect(service).toContain('Aucune donnée locale : la référence globale reste informative');
});

test('les mutations de preuve marché et de prix restent des actions Workspace pays autorisées côté serveur', () => {
  const source = fs.readFileSync(path.join(CANONICAL, 'js', 'pricing-decision-chain.js'), 'utf8');
  const route = fs.readFileSync(path.join(ROOT, 'routes', 'admin-pricing-workspace.js'), 'utf8');

  expect(source).toContain('/price-observations`');
  expect(source).toContain('/local-price`');
  expect(source).toContain('/local-price/activate`');
  expect(route).toContain("router.post('/market/:marketCode/price-observations', requireCountryStrategyManager");
  expect(route).toContain("router.post('/market/:marketCode/price-observations/:observationRef/deactivate', requireCountryStrategyManager");
  expect(route).toContain("router.post('/market/:marketCode/products/:productRef/local-price', requireCountryStrategyManager");
  expect(route).toContain("router.post('/market/:marketCode/products/:productRef/local-price/activate', requireCountryStrategyManager");
  expect(route).toContain('manage_market_price_observations');
});
