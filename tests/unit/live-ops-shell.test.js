'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/css/live-ops-shell.css'), 'utf8');

test('les repères décoratifs jaunes sont remplacés par le bleu de marque', () => {
  expect(css).toContain('.kmc-section-title::before');
  expect(css).toContain('.kmc-workspace-table th:first-child');
  expect(css).not.toMatch(/#f5a623|#f59e0b|245 166 35/i);
});

test('hiérarchie des actions : principale bleue, validation verte, destructive rouge', () => {
  expect(css).toContain('.kmc-workspace-action:not(.is-secondary)');
  expect(css).toContain('.kmc-workspace-action.is-approve');
  expect(css).toContain('.kmc-workspace-action.is-danger');
});

test('candidats sourcing : pastilles état/décision et prix aligné', () => {
  expect(css).toContain('.kmc-pill');
  expect(css).toContain('.kmc-cand-price');
});

test('pastilles candidats : cellules état/décision aérées (pas collées à la colonne suivante)', () => {
  expect(css).toContain('td:nth-child(5)');
  expect(css).toContain('padding-right: 18px');
});

test('tarification produit : KPI en grille et actions sur une ligne', () => {
  expect(css).toContain('.kmc-pricing-product-focus .kmc-workspace-kpis');
  expect(css).toContain('.kmc-pricing-product-focus .kmc-workspace-actions');
});

test('échelle typographique unique : titres 18, textes 13, tableaux 13/11', () => {
  expect(css).toMatch(/kmc-decision-dashboard-section-title[\s\S]*?font-size: 18px/);
  expect(css).toMatch(/kmc-section-description[\s\S]*?font-size: 13px/);
  expect(css).toMatch(/kmc-workspace-table td[\s\S]*?font-size: 13px/);
  expect(css).toMatch(/kmc-workspace-table th[\s\S]*?font-size: 11px/);
});
