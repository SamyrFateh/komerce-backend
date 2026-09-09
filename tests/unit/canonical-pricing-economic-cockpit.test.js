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

  expect(index).toContain('/dashboards/canonical/js/pricing-economic-cockpit.js?v=1405');
  expect(index).toContain('/dashboards/canonical/css/pricing-economic-cockpit.css?v=1404');
  expect(source).toContain("title.textContent = 'Atelier économique'");
  expect(source).toContain('Charges structurelles à couvrir');
  expect(source).toContain('Coûts variables');
  expect(source).toContain('Charges fixes directes');
  expect(source).toContain('Charges fixes mutualisées');
  expect(source).toContain('Portefeuille produits');
  expect(source).toContain('Sensibilité prix');
  expect(source).toContain('Données marché');
  expect(source).toContain('Montant / mois');
  expect(source).toContain('Coût global');
  expect(source).toContain('Prix retenu');
  expect(source).not.toContain('Affiner les observations marché');
  expect(source).not.toContain('Prix final marché retenu');
  expect(css).toContain('.kmc-cockpit-costs');
  expect(css).toContain('.kmc-cockpit-portfolio-table');
  expect(css).toContain('.kmc-cockpit-detail-grid');
  expect(css).toContain('MOCK PARITY FINAL');
  expect(css).toContain('background: #0b84f3');
  expect(source).toContain('options.root.replaceChildren(cockpit)');
  expect(source).toContain("options.root.dataset.pricingMockContract = 'exclusive'");
  expect(source).not.toContain('outerAdvancedNodes');
  expect(source).not.toContain('pricingCockpitLegacyHidden');
  expect(source).not.toContain('createAdvancedDetails');
  expect(source).not.toContain('advanced.open');
});

test('mutualisé reste un périmètre et peut être variable ou fixe', () => {
  const source = fs.readFileSync(path.join(CANONICAL, 'js', 'pricing-economic-cockpit.js'), 'utf8');
  expect(source).toContain("economicNature(component) === 'variable'");
  expect(source).toContain("economicNature(component) === 'fixed' && allocationPerimeter(component) === 'direct'");
  expect(source).toContain("economicNature(component) === 'fixed' && allocationPerimeter(component) === 'mutualized'");
  expect(source).toContain('Toute quote-part mutualisée est calculée par Market ID');
});

test('les valeurs calculées sont grisées et le prix final marché est le levier produit', () => {
  const source = fs.readFileSync(path.join(CANONICAL, 'js', 'pricing-economic-cockpit.js'), 'utf8');
  const css = fs.readFileSync(path.join(CANONICAL, 'css', 'pricing-economic-cockpit.css'), 'utf8');
  expect(source).toContain('Coûts variables hors achat');
  expect(source).toContain('economics.variable_cost_outside_purchase_kmf');
  expect(source).toContain("'Prix retenu'");
  expect(source).toContain('dataset.finalMarketPrice');
  expect(source).toContain('Les valeurs grisées sont calculées automatiquement par le moteur');
  expect(css).toContain('.kmc-cockpit-cell.is-derived');
  expect(css).toContain('.kmc-cockpit-final-price');
  expect(source).not.toMatch(/variable_cost_complete_kmf\s*-\s*.*purchase/i);
});

test('le cockpit lit corridor, décision et quotes-parts serveur sans fallback pays silencieux', () => {
  const source = fs.readFileSync(path.join(CANONICAL, 'js', 'pricing-economic-cockpit.js'), 'utf8');
  expect(source).toContain('/corridor?product_ref=');
  expect(source).toContain('`${endpoint}/decision${qs}`');
  expect(source).toContain("period ? `?period=${encodeURIComponent(period)}` : ''");
  expect(source).toContain('decision?.coverage?.structure');
  expect(source).toContain('charge.market_share_kmf');
  expect(source).toContain('Quote-part marché');
  expect(source).toContain('point?.economics?.contribution_unit_kmf');
  expect(source).toContain('Référence globale (informative)');
  expect(source).toContain('Non utilisée comme vérité locale.');
  expect(source).not.toContain('market_id');
  expect(source).not.toContain('marketId');
});

test('les trois actions de coûts du mock ouvrent des panneaux séparés, jamais une ancienne rubrique inline', () => {
  const source = fs.readFileSync(path.join(CANONICAL, 'js', 'pricing-economic-cockpit.js'), 'utf8');
  const css = fs.readFileSync(path.join(CANONICAL, 'css', 'pricing-economic-cockpit.css'), 'utf8');
  const index = fs.readFileSync(path.join(CANONICAL, 'index.html'), 'utf8');

  // Le mock est exclusif : même les coûts variables passent par un panneau dédié.
  expect(source).toContain("detailKey === 'variable'");
  expect(source).toContain('await openVariableCostPanel(rootObject, doc, workspace, options, payload)');
  expect(source).toContain('data-variable-cost-input');

  // Les charges fixes directes gardent leur panneau d'ajustement séparé.
  expect(source).toContain("detailKey === 'fixed-direct'");
  expect(source).toContain('await openStructureEventForm(rootObject, doc, workspace, options, detailKey)');

  // Les mutualisées sont une vérité de groupe en lecture seule dans cet
  // Atelier : encadré grisé, aucune action de gestion exposée.
  expect(source).toContain("card.dataset.readOnly = 'true'");
  expect(source).toContain("'Charges fixes mutualisées', 'Charges fixes partagées entre marchés.'");
  expect(source).not.toContain("detailKey === 'fixed-direct' || detailKey === 'fixed-mutualized'");
  expect(css).toContain('.kmc-cockpit-cost-card.is-fixed-mutualized');
  expect(css).toContain('background: #f8fafc');

  // Le support serveur GROUP reste disponible hors de cette surface ; le
  // cockpit ne le rend simplement plus manipulable.
  expect(source).toContain("const globalEndpoint = workspace.endpointFor({});");
  expect(source).toContain('const basePath = isMutualized ? globalEndpoint : marketEndpoint;');

  // Le panneau est un module Canonical natif séparé, chargé dans index.html.
  expect(index).toContain('/dashboards/canonical/js/pricing-structure-event-panel.js');
  expect(index).toContain('/dashboards/canonical/css/pricing-structure-event-panel.css');
});
