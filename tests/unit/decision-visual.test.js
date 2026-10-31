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
  test('trois KPI sur une ligne desktop, marge en vert clair, jamais un fond bleu saturé', () => {
    expect(css).toMatch(/\.kmc-fin3 \.kmc-fin3-kpis \{ display: grid; grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
    expect(css).toMatch(/\.kmc-fin3-kpi\.is-marge \{ background: #eefaf2; border-color: #8fd9ad;/);
    expect(css).toContain('.kmc-fin3 .kmc-fin3-kpi.is-marge .kmc-fin3-kpi-value { color: #14532d; }');
  });
  test('marge inconnue (aucune commande finalisée) : carte neutre, jamais le vert « marge réalisée »', () => {
    expect(css).toContain('.kmc-fin3 .kmc-fin3-kpi.is-marge.is-unknown { background: #fff;');
    expect(css).toContain('.kmc-fin3 .kmc-fin3-kpi.tone-neutral .kmc-fin3-kpi-icon');
  });
  test('Commerce : une barre isolée ne sature pas le graphique (largeur bornée, alignement à gauche)', () => {
    expect(css).toContain('.kmc-com-bar { max-width: 48px; }');
    expect(css).toContain('.kmc-com-bars.is-sparse { justify-content: flex-start;');
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

test('Finance : style des accès utiles', () => {
  expect(css).toContain('.kmc-fin3-links');
});

test('Commandes : la liste compacte reprend Clients, sans KPI ni funnel visuel', () => {
  expect(css).toContain('.kmc-ord-list-head');
  expect(css).toContain('.kmc-ord-filters');
  expect(css).toContain('.kmc-ord-attention');
  expect(css).toContain('.kmc-ord-table-wrap');
  expect(css).not.toContain('.kmc-ord-kpis');
  expect(css).not.toContain('.kmc-ord-funnel');
  expect(css).not.toContain('.kmc-ord-signals');
  expect(css).not.toContain('.kmc-ord-detail');
  expect(css).toMatch(/@media \(max-width: 980px\)[\s\S]*kmc-ord-main/);
});

test('Commerce : styles série / marché / dernières commandes présents', () => {
  const css = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'public/dashboards/canonical/css/decision-visual.css'), 'utf8');
  ['.kmc-com-bars', '.kmc-com-donut', '.kmc-com-legend', '.kmc-com-table'].forEach(sel => expect(css).toContain(sel));
});

test('liens d\'action des cartes décision et bouton Configurer : boutons lisibles, sans superposition', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'public/dashboards/canonical/css/decision-visual.css'), 'utf8');
  expect(src).toMatch(/body\.kmc-shell-v4 \.kmc-decision-link[\s\S]*?min-height: 32px/);
  expect(src).toMatch(/\.kmc-param-line \{[\s\S]*?display: grid/);
  expect(src).toMatch(/\.kmc-param-line > \.kmc-workspace-action \{[\s\S]*?position: static/);
  const ws = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'public/dashboards/canonical/js/catalog-workspace.js'), 'utf8');
  expect(ws).toContain("line.className = 'kmc-param-line'");
});

test('L1 : invite « Choisir un marché » stylée (composant unique market-prompt)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'public/dashboards/canonical/css/decision-visual.css'), 'utf8');
  expect(src).toContain('.kmc-market-prompt {');
  expect(src).toContain('.kmc-market-prompt[data-market-prompt="unauthorized"]');
});

test('L2 : le bandeau de recette est stylé', () => {
  const css = require('fs').readFileSync(require('path').join(__dirname, '../../public/dashboards/canonical/css/decision-visual.css'), 'utf8');
  expect(css).toContain('.kmc-recette-banner');
});
