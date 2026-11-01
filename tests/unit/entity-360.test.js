'use strict';
/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const fs = require('fs');
const path = require('path');
const css = fs.readFileSync(path.join(__dirname, '..', '..', 'public/dashboards/canonical/css/entity-360.css'), 'utf8');

test('Clients : colonne téléphone à largeur constante et bouton œil discret', () => {
  expect(css).toMatch(/\.kmc-client-phone-cell\s*\{[^}]*width:\s*11\.5rem/);
  expect(css).toContain('.kmc-client-phone-toggle');
});

test('À traiter : mise en page deux colonnes repliée sur mobile', () => {
  expect(css).toContain('.kmc-action-columns');
  expect(css).toMatch(/@media \(max-width: 800px\)[^}]*\.kmc-action-columns/);
});
