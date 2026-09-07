'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const CANONICAL = path.join(ROOT, 'public', 'dashboards', 'canonical');

test('le panneau équilibre affiche uniquement la projection serveur et rappelle l anti-double-comptage', () => {
  const source = fs.readFileSync(path.join(CANONICAL, 'js', 'pricing-equilibrium-panel.js'), 'utf8');
  const index = fs.readFileSync(path.join(CANONICAL, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(CANONICAL, 'css', 'pricing-equilibrium-panel.css'), 'utf8');

  expect(index).toContain('/dashboards/canonical/js/pricing-equilibrium-panel.js?v=1239');
  expect(index).toContain('/dashboards/canonical/css/pricing-equilibrium-panel.css?v=1239');
  expect(source).toContain('decision.flow_break_even');
  expect(source).toContain('additional_equivalent_articles');
  expect(source).toContain('additional_equivalent_orders');
  expect(source).toContain('additional_equivalent_parcels');
  expect(source).toContain('flow.flow_velocity');
  expect(source).toContain('Une seule contribution économique issue des articles vendus');
  expect(source).toContain('Ils ne s’additionnent jamais');
  expect(source).toContain('workspace.jsonRequest');
  expect(source).not.toContain('market_id');
  expect(source).not.toContain('marketId');
  expect(css).toContain('.kmc-flow-equilibrium-panel');
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
