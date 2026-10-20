'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const fs=require('fs');
const path=require('path');
const css=fs.readFileSync(path.join(__dirname,'..','..','public','dashboards','canonical','css','decision-visual.css'),'utf8');

describe('decision visual — contextual Commerce hero',()=>{
  test('Commerce possède un Hero distinct et la surface activité essentielle',()=>{
    // Le Hero Commerce (150px, illustration or) est possédé par contextual-heroes-v2 / Layout Canon.
    expect(css).not.toContain('[data-dashboard-id="commerce"] > .kmc-dashboard-header');
    expect(css).toContain('.kmc-commerce-essential-metrics');
    expect(css).toContain('.kmc-commerce-flow-title');
  });
});


test('Finance possède un Hero contextuel propre',()=>{
  expect(css).not.toContain('[data-dashboard-id="finance"] > .kmc-dashboard-header {');
  expect(css).toContain('.kmc-finance-essential-metrics');
  expect(css).toContain('.kmc-finance-review-title');
  ['.kmc-fin-order', '.kmc-fin-classes', '.kmc-fin-table-wrap', '.kmc-fin-notes'].forEach(selector => expect(css).toContain(selector));
});


test('Commandes possède un Hero contextuel propre',()=>{
  expect(css).not.toContain('[data-dashboard-id="orders"] > .kmc-dashboard-header {');
  expect(css).toContain('.kmc-orders-essential-metrics');
  expect(css).toContain('.kmc-orders-flow-title');
});

test('Finance et Commandes ne redéfinissent plus leur Hero (propriété Layout Canon)', () => {
  expect(css).not.toContain('[data-dashboard-id="finance"] > .kmc-dashboard-header {');
  expect(css).not.toContain('[data-dashboard-id="orders"] > .kmc-dashboard-header {');
  expect(css).not.toContain('color: #15803d');
  expect(css).not.toContain('color: #4f46e5');
});

test('decision-visual.css : plancher typographique (aucun texte sous 10 px)', () => {
  expect(require('../helpers/fontFloor').tinyFonts('decision-visual.css')).toEqual([]);
});

describe('FIN-03 — Finance : composition du mock', () => {
  test('quatre KPI sur une ligne desktop, marge en vert clair, jamais un fond bleu saturé', () => {
    expect(css).toMatch(/\.kmc-fin3 \.kmc-fin3-kpis \{ display: grid; grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
    expect(css).toMatch(/\.kmc-fin3-kpi\.is-marge \{ background: #eefaf2; border-color: #8fd9ad;/);
    expect(css).toContain('.kmc-fin3 .kmc-fin3-kpi.is-marge .kmc-fin3-kpi-value { color: #14532d; }');
  });
  test('deux bandeaux et deux panneaux en deux colonnes, empilés sous 1100 px, tableau en cartes sous 640 px', () => {
    expect(css).toContain('.kmc-fin3 .kmc-fin3-banners, body.kmc-shell-v4 .kmc-fin3 .kmc-fin3-panels { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));');
    expect(css).toMatch(/@media \(max-width: 1100px\)[\s\S]*kmc-fin3-panels[\s\S]*minmax\(0, 1fr\)\)?;/);
    expect(css).toMatch(/@media \(max-width: 640px\)[\s\S]*kmc-fin3-table td::before \{ content: attr\(data-label\)/);
  });
});


test('Commerce : classements produits et catégories lisibles sur desktop et mobile, sans nouveau dashboard', () => {
  expect(css).toContain('.kmc-commerce-ranking-grid');
  expect(css).toContain('.kmc-commerce-ranking-empty');
  expect(css).toMatch(/@media \(max-width: 760px\)[\s\S]*?\.kmc-commerce-ranking-grid \{\s*grid-template-columns: minmax\(0, 1fr\);/);
  expect(css).toContain('align-items: stretch;');
});


test('Finance : file fournisseur distingue vide et projection non fournie', () => {
  const source = fs.readFileSync(path.join(__dirname,'..','..','public','dashboards','canonical','js','finance-decision.js'),'utf8');
  expect(source).toContain('const supplierState = supplierReviewState(payload);');
  expect(source).toContain("review.section.setAttribute('data-review-state', supplierState.state)");
  expect(source).toContain("if (supplierState.state === 'rows')");
  expect(source).toContain('supplierState.message');
  expect(source).toContain('Non disponible dans cette vue');
  expect(source).toContain('Aucun paiement fournisseur ambigu');
});
