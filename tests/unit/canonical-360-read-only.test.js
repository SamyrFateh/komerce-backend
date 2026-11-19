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

// Order 360 garde deux gestes administratifs de recette G6, isolés du reste des 360.
// Le contrat de lecture seule continue de couvrir tous les autres écrans et chemins.
const withoutG6RecipeActions = (name, source) => {
  if (name !== 'order-360.js') return source;
  const begin = source.indexOf('  function renderRecipeCancellation(');
  const end = source.indexOf('  async function mount(options)', begin);
  if (begin < 0 || end < 0) throw Error('Bornes des actions G6 modifiées : revue nécessaire');
  const actions = source.slice(begin, end);
  expect(actions).toContain("order.simulation_scope !== 'G6-BUYER'");
  expect(actions).toContain("options.user?.role !== 'admin'");
  expect(actions).toContain("cash_relais");
  expect(actions).toMatch(/method:\\s*['"]POST['"]/);
  return source.slice(0, begin) + source.slice(end);
};


describe.each(SURFACES)('%s — lecture seule', name => {
  const source = withoutG6RecipeActions(name, read(name));

  test('aucun verbe HTTP mutant', () => {
    expect(source).not.toMatch(/method:\s*['"](POST|PUT|PATCH|DELETE)['"]/i);
    expect(source.replace(/\bq\.delete\(/g, 'queryParamsDelete(')).not.toMatch(/\.(post|put|patch|delete)\(/);
  });

  test('aucun formulaire ni bouton de soumission', () => {
    // Seul l'index clients a un formulaire : filtre de recherche (GET, sans verbe mutant).
    if (name !== 'client-index.js') expect(source).not.toMatch(/createElement\(\s*['"]form['"]/);
    if (name !== 'client-index.js') expect(source).not.toMatch(/type\s*=\s*['"]submit['"]/);
  });

  test('boutons : uniquement recherche/pagination (GET) de l’index clients', () => {
    const hasButton = /['"]button['"]/.test(source);
    if (name === 'client-index.js') expect(hasButton).toBe(true);
    // L12a : Client 360 porte un seul bouton local « Afficher/Masquer les coordonnées » (affichage, aucune écriture).
    else if (name === 'client-360.js') {
      expect((source.match(/createElement\('button'\)|text\(doc, 'button'/g) || []).length).toBe(1);
      expect(source).toContain('Afficher les coordonnées');
    } else expect(hasButton).toBe(false);
  });
});
