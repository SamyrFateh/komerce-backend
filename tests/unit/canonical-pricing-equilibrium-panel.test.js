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

  expect(index).toContain('/dashboards/canonical/js/pricing-equilibrium-panel.js?v=1303');
  expect(index).toContain('/dashboards/canonical/css/pricing-equilibrium-panel.css?v=261010-9');
  expect(source).toContain('decision.flow_break_even');
  expect(source).toContain('additional_equivalent_articles');
  expect(source).toContain('additional_equivalent_orders');
  expect(source).toContain('additional_equivalent_parcels');
  expect(source).toContain('flow.flow_velocity');
  expect(source).toContain('Charges structurelles à couvrir');
  expect(source).toContain('Contribution générée');
  expect(source).toContain('Résultat après charges fixes');
  expect(source).toContain('flow?.economic_state?.period_result_kmf');
  expect(source.indexOf("const state = el(doc, 'div', 'kmc-flow-equilibrium-state')")).toBeLessThan(source.indexOf("if (!ready)"));
  expect(source).toContain("if (iconKey) classes.push(`is-${iconKey}`)");
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

  expect(projection).toContain("'ROLLING_CANONICAL_WINDOW_AVERAGE'");
  expect(projection).toContain("'CALENDAR_MONTH_AVERAGE'");
  expect(projection).toContain('break_even_floor_orders');
  expect(projection).toContain('break_even_floor_articles');
  expect(projection).toContain('break_even_floor_parcels');
  expect(projection).toContain("source: 'ARTICLE_SALES_SINGLE_POOL'");
  expect(projection).toContain('double_counting_forbidden: true');
  expect(route).toContain("require('../services/pricing-market-decision-projection')");
  expect(route).toContain('decorateMarketDecision(decision)');
});

function testDocument() {
  return {
    createElement(tagName) {
      return {
        tagName,
        className: '',
        textContent: '',
        dataset: {},
        children: [],
        appendChild(node) { this.children.push(node); return node; },
      };
    },
  };
}

function mainMetrics(panel) {
  const grid = panel.children.find(child => child.className === 'kmc-flow-equilibrium-state');
  return grid.children.map(card => ({
    label: card.children.find(child => child.tagName === 'span')?.textContent,
    value: card.children.find(child => child.tagName === 'strong')?.textContent,
  }));
}

test('le résultat analytique serveur remplace la moyenne unitaire dans les cinq KPI principaux', () => {
  const { buildPanel } = require('../../public/dashboards/canonical/js/pricing-equilibrium-panel.js');
  const decision = {
    coverage: { numerator_contribution_kmf: 720, structural_charges_kmf: 1000, coverage_ratio: 0.72 },
    flow_break_even: {
      status: 'READY',
      economic_state: { period_result_kmf: -280 },
      observed_mix: { contribution_per_article_kmf: 72, article_units: 10 },
      economic_break_even: { gap_kmf: 280 },
    },
  };
  const panel = buildPanel(testDocument(), { formatPercentRatio: v => String(v) }, decision);
  const metrics = mainMetrics(panel);
  expect(metrics).toHaveLength(5);
  expect(metrics.some(item => item.label === 'Résultat après charges fixes' && item.value === '-280 KMF')).toBe(true);
  expect(metrics.some(item => item.label === 'Contribution moyenne / article')).toBe(false);
  // Même si les autres valeurs sont présentes, le navigateur ne refait jamais la soustraction.
  delete decision.flow_break_even.economic_state.period_result_kmf;
  expect(mainMetrics(buildPanel(testDocument(), {}, decision)).find(item => item.label === 'Résultat après charges fixes').value).toBe('—');
});

test('le résultat est masqué lorsque non décisionnel, mais un zéro mesuré reste visible', () => {
  const { buildPanel } = require('../../public/dashboards/canonical/js/pricing-equilibrium-panel.js');
  const decision = {
    coverage: {},
    flow_break_even: {
      status: 'NOT_DECISIONAL',
      economic_state: { period_result_kmf: 100 },
      observed_mix: {},
    },
  };
  const readResult = () => mainMetrics(buildPanel(testDocument(), {}, decision))
    .find(item => item.label === 'Résultat après charges fixes').value;
  expect(readResult()).toBe('—');
  decision.flow_break_even.status = 'READY';
  decision.flow_break_even.economic_state.period_result_kmf = 0;
  expect(readResult()).toBe('0 KMF');
  decision.flow_break_even.economic_state.period_result_kmf = 180;
  expect(readResult()).toBe('180 KMF');
  decision.flow_break_even.economic_state.period_result_kmf = '';
  expect(readResult()).toBe('—');
});
