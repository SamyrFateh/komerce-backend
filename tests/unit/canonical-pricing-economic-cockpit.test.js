'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const CANONICAL = path.join(ROOT, 'public', 'dashboards', 'canonical');

test('Atelier économique charge la surface cockpit fidèle au mock approuvé', () => {
  const index = fs.readFileSync(path.join(CANONICAL, 'index.html'), 'utf8');
  const source = fs.readFileSync(path.join(CANONICAL, 'js', 'pricing-economic-cockpit.js'), 'utf8');
  const css = fs.readFileSync(path.join(CANONICAL, 'css', 'pricing-economic-cockpit.css'), 'utf8');

  expect(index).toContain('/dashboards/canonical/js/pricing-economic-cockpit.js?v=1401');
  expect(index).toContain('/dashboards/canonical/css/pricing-economic-cockpit.css?v=1401');
  expect(source).toContain("title.textContent = 'Atelier économique'");
  expect(source).toContain('Charges structurelles à couvrir');
  expect(source).toContain('Coûts variables');
  expect(source).toContain('Charges fixes directes');
  expect(source).toContain('Charges fixes mutualisées');
  expect(source).toContain('Portefeuille produits');
  expect(source).toContain('Sensibilité prix');
  expect(source).toContain('Données marché');
  expect(css).toContain('.kmc-cockpit-costs');
  expect(css).toContain('.kmc-cockpit-portfolio-table');
  expect(css).toContain('.kmc-cockpit-detail-grid');
});

test('mutualisé reste un périmètre et peut être variable ou fixe', () => {
  const source = fs.readFileSync(path.join(CANONICAL, 'js', 'pricing-economic-cockpit.js'), 'utf8');
  expect(source).toContain("economicNature(component) === 'variable'");
  expect(source).toContain("economicNature(component) === 'fixed' && allocationPerimeter(component) === 'direct'");
  expect(source).toContain("economicNature(component) === 'fixed' && allocationPerimeter(component) === 'mutualized'");
  expect(source).toContain('Direct / mutualisé décrit le périmètre, jamais la nature de la charge.');
  expect(source).toContain('Toute quote-part mutualisée est calculée par Market ID');
});

test('les valeurs calculées sont grisées et le prix final marché est le levier produit', () => {
  const source = fs.readFileSync(path.join(CANONICAL, 'js', 'pricing-economic-cockpit.js'), 'utf8');
  const css = fs.readFileSync(path.join(CANONICAL, 'css', 'pricing-economic-cockpit.css'), 'utf8');
  expect(source).toContain('Coûts variables hors achat');
  expect(source).toContain('economics.variable_cost_outside_purchase_kmf');
  expect(source).toContain('Prix final marché retenu');
  expect(source).toContain('dataset.finalMarketPrice');
  expect(source).toContain('Les valeurs grisées sont calculées automatiquement par le moteur');
  expect(css).toContain('.kmc-cockpit-cell.is-derived');
  expect(css).toContain('.kmc-cockpit-final-price');
  expect(source).not.toMatch(/variable_cost_complete_kmf\s*-\s*.*purchase/i);
});

test('le cockpit lit corridor, décision et quotes-parts serveur sans fallback pays silencieux', () => {
  const source = fs.readFileSync(path.join(CANONICAL, 'js', 'pricing-economic-cockpit.js'), 'utf8');
  expect(source).toContain('/corridor?product_ref=');
  expect(source).toContain('`${endpoint}/decision`');
  expect(source).toContain('decision?.coverage?.structure');
  expect(source).toContain('charge.market_share_kmf');
  expect(source).toContain('Valeur effective ${marketCode}');
  expect(source).toContain('point?.economics?.contribution_unit_kmf');
  expect(source).toContain('Référence globale · informative');
  expect(source).toContain('Jamais utilisée silencieusement comme vérité locale.');
  expect(source).not.toContain('market_id');
  expect(source).not.toContain('marketId');
});
