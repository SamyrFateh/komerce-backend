'use strict';
/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public/dashboards/canonical/js/commerce-decision.js'), 'utf8');

test('Vue commerce : plus de carte « Dernières commandes » (dashboard de performance pure)', () => {
  expect(src).not.toContain('Dernières commandes');
  expect(src).not.toContain('commerce-recent-orders');
  expect(src).not.toContain('recentSection');
});

test('Vue commerce : la définition du chiffre d’affaires est explicite', () => {
  expect(src).toContain('Chiffre d’affaires = commandes payées');
});

test('Vue commerce : sous-total monétaire documenté du journal, distinct des ventes et sans substitution du CA', () => {
  expect(src).toContain('Sous-total des flux monétaires clients documentés');
  expect(src).toContain('non disponibles pour cette période — jamais remplacés par les ventes payées');
  expect(src).toContain('Couverture intégrale non certifiée ; distinct des ventes payées');
  expect(src).toContain('EUR non disponible');
  expect(src).toContain('remboursements monétaires confirmés');
  expect(src).toContain('% des lignes produit');
  expect(src).toContain('pas du CA');
});
