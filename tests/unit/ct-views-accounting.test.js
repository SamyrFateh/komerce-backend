'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../../public/dashboards/admin-legacy/js/ct-views-accounting.js'), 'utf8');

test('ct-views-accounting : le total déclaré n\'est jamais présenté comme « déposé »', () => {
  expect(src).toContain('Déclaré (tous statuts)');
  expect(src).toContain('Vérifié (interne)');
  expect(src).not.toMatch(/Déposé :/);
});

test('ct-views-accounting : l\'écart est « non couvert » provisoire (collecté − vérifié), plus « en transit »', () => {
  expect(src).toContain('Non couvert (collecté − vérifié, provisoire)');
  expect(src).not.toMatch(/En transit( \(collecté-déposé\))? :/);
});
