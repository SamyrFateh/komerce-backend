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

test('échelle typographique unique : titres 20, textes 14, tableaux 14/12', () => {
  expect(css).toMatch(/kmc-decision-dashboard-section-title[\s\S]*?font-size: 20px/);
  expect(css).toMatch(/kmc-section-description[\s\S]*?font-size: 14px/);
  expect(css).toMatch(/kmc-workspace-table td[\s\S]*?font-size: 14px/);
  expect(css).toMatch(/kmc-workspace-table th[\s\S]*?font-size: 12px/);
});

test('plancher typographique : aucune feuille Canonical (hors menu) sous 10 px', () => {
  const dir = path.join(__dirname, '../../public/dashboards/canonical/css');
  const tiny = [];
  fs.readdirSync(dir).filter(f => f.endsWith('.css') && f !== 'navigation.css').forEach(f => {
    for (const m of fs.readFileSync(path.join(dir, f), 'utf8').matchAll(/font-size\s*:\s*([0-9.]+)px/g)) {
      if (Number(m[1]) < 10) tiny.push(`${f}:${m[1]}`);
    }
  });
  expect(tiny).toEqual([]);
});

test('boot : le placeholder « ADMIN CANONICAL » ne flashe pas avant la page', () => {
  expect(css).toMatch(/#canonical-admin-root\.canonical-boot\s*\{[^}]*opacity:\s*0;[^}]*animation:\s*kmc-boot-reveal[^}]*\.7s/);
  expect(css).toMatch(/@keyframes kmc-boot-reveal/);
});

test('attention : orange conservé avec liseré gauche et pastilles à bord orange', () => {
  expect(css).toMatch(/inset 4px 0 0 #E8710A/);
  expect(css).toMatch(/\.kir-status[\s\S]*is-warning, \.is-attention\)\s*\{[^}]*border: 1\.5px solid #E8710A;[^}]*color: #B54708/);
});
