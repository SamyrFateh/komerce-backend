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
