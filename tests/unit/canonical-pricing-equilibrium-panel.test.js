'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const CANONICAL = path.join(ROOT, 'public', 'dashboards', 'canonical');

test('le panneau équilibre reste dérivé serveur et limite la vue principale aux indicateurs clés', () => {
  const source = fs.readFileSync(path.join(CANONICAL, 'js', 'pricing-equilibrium-panel.js'), 'utf8');
  const index = fs.readFileSync(path.join(CANONICAL, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(CANONICAL, 'css', 'pricing-equilibrium-panel.css'), 'utf8');
  const v3 = fs.readFileSync(path.join(CANONICAL, 'css', 'pricing-workspace-economic-v3.css'), 'utf8');

  expect(index).toContain('/dashboards/canonical/js/pricing-equilibrium-panel.js?v=1301');
  expect(index).toContain('/dashboards/canonical/css/pricing-equilibrium-panel.css?v=1301');
  expect(source).toContain('decision.flow_break_even');
  expect(source).toContain('additional_equivalent_articles');
  expect(source).toContain('additional_equivalent_orders');
  expect(source).toContain('additional_equivalent_parcels');
  expect(source).toContain('flow.flow_velocity');
  expect(source).toContain('Charges à couvrir');
  expect(source).toContain('Contribution générée');
  expect(source).toContain('Contribution moyenne / article');
  expect(source).toContain('Les valeurs ci-dessous sont calculées par le moteur et ne sont pas éditables');
  expect(source).toContain('Ils ne s’additionnent jamais');
  expect(source).toContain('workspace.jsonRequest');
  expect(source).not.toContain('market_id');
  expect(source).not.toContain('marketId');
  expect(css).toContain('.kmc-flow-equilibrium-panel');
  expect(v3).toContain('.kmc-flow-equilibrium-metric.is-derived');
  expect(v3).toContain('.kmc-flow-equilibrium-details');
});

test('le backend enrichit la décision avec cadence et planchers sans recalcul dans le navigateur', () => {
  const projection = fs.readFileSync(path.join(ROOT, 'services', 'pricing-market-decision-projection.js'), 'utf8');
  const route = fs.readFileSync(path.join(ROOT, 'routes', 'admin-pricing-workspace.js'), 'utf8');

  expect(projection).toContain("basis: 'ROLLING_CANONICAL_WINDOW_AVERAGE'");
  expect(projection).toContain('break_even_floor_orders');
  expect(projection).toContain('break_even_floor_articles');
  expect(projection).toContain('break_even_floor_parcels');
  expect(projection).toContain("source: 'ARTICLE_SALES_SINGLE_POOL'");
  expect(projection).toContain('double_counting_forbidden: true');
  expect(route).toContain("require('../services/pricing-market-decision-projection')");
  expect(route).toContain('decorateMarketDecision(decision)');
});