/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 *
 * Doctrine : 360 = comprendre, zéro action. Aucune des quatre fiches 360 ne
 * porte de mutation : ni verbe HTTP mutant, ni formulaire, ni bouton hors
 * recherche/pagination de l'index clients (GET).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const JS = path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical', 'js');
const SURFACES = ['order-360.js', 'product-360.js', 'supplier-360.js', 'client-360.js', 'client-index.js'];
const read = name => fs.readFileSync(path.join(JS, name), 'utf8');

describe.each(SURFACES)('%s — lecture seule', name => {
  const source = read(name);

  test('aucun verbe HTTP mutant', () => {
    expect(source).not.toMatch(/method:\s*['"](POST|PUT|PATCH|DELETE)['"]/i);
    expect(source).not.toMatch(/\.(post|put|patch|delete)\(/);
  });

  test('aucun formulaire ni bouton de soumission', () => {
    // Seul l'index clients a un formulaire : filtre de recherche (GET, sans verbe mutant).
    if (name !== 'client-index.js') expect(source).not.toMatch(/createElement\(\s*['"]form['"]/);
    if (name !== 'client-index.js') expect(source).not.toMatch(/type\s*=\s*['"]submit['"]/);
  });

  test('boutons : uniquement recherche/pagination (GET) de l’index clients', () => {
    const hasButton = /['"]button['"]/.test(source);
    if (name === 'client-index.js') expect(hasButton).toBe(true);
    else expect(hasButton).toBe(false);
  });
});
