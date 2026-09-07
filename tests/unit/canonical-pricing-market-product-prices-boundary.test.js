'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
const fs = require('fs');
const path = require('path');

const ui = fs.readFileSync(
  path.join(__dirname, '../../public/dashboards/canonical/js/pricing-market-product-prices.js'),
  'utf8'
);
const index = fs.readFileSync(
  path.join(__dirname, '../../public/dashboards/canonical/index.html'),
  'utf8'
);

test('Canonical charge l’overlay de prix marché sans modifier le runtime legacy', () => {
  expect(index).toContain('/dashboards/canonical/js/pricing-market-product-prices.js');
  expect(index).toContain('/dashboards/canonical/css/pricing-market-product-prices.css');
  expect(ui).toContain('KomerceCanonicalPricingWorkspace');
  expect(ui).not.toContain('/dashboards/admin/');
  expect(ui).not.toContain('/dashboards/admin-legacy/');
});

test('le navigateur adresse le marché par le endpoint déjà résolu et le produit par product_ref', () => {
  expect(ui).toContain('workspace.endpointFor');
  expect(ui).toContain('/product-prices');
  expect(ui).toContain('encodeURIComponent(ref)');
  expect(ui).not.toMatch(/body\s*=\s*\{[^}]*market_id/s);
  expect(ui).not.toMatch(/body\s*=\s*\{[^}]*currency/s);
});

test('la UI ne décide pas si un prix sous CDR est autorisé', () => {
  expect(ui).toContain('Le serveur vérifie le coût variable, le CDR');
  expect(ui).toContain('Aucun seuil n’est calculé ici');
  expect(ui).not.toMatch(/effective_price_kmf\s*[<>]=?\s*.*cdr/i);
  expect(ui).not.toMatch(/price\s*[<>]=?\s*.*variable_cost/i);
});

test('viewer reste lecture seule et manager réutilise la capacité serveur existante', () => {
  expect(ui).toContain('manage_market_product_prices');
  expect(ui).toContain('Lecture seule · viewer pays');
  expect(ui).toContain('Manager pays · décision autonome sous garde économique');
});

test('la section prix est insérée avant l Atelier des coûts', () => {
  expect(ui).toContain("title.textContent.trim() === 'Atelier des coûts'");
  expect(ui).toContain('rootNode.insertBefore(section, costs)');
});
