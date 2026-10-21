'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical', 'js', 'pricing-workspace.js'), 'utf8');

test('l’Atelier ouvre le formulaire canonique sur place pour un marché sans politique', () => {
  expect(src).toContain("'open-decision-policy-form'");
  expect(src).toContain('data-market-policy-editor');
  expect(src).toContain('details.open = !currentPolicy');
  expect(src).toContain('Définir la politique de décision');
});

test('l’aperçu d’impact passe par la route serveur en lecture seule, jamais par un calcul navigateur', () => {
  expect(src).toContain('/decision-policy/preview');
  expect(src).toContain('rien n’est enregistré');
  expect(src).not.toMatch(/coverage_ratio\s*[*/]/);
});

test('un seul chemin d’enregistrement de la politique : POST /decision-policy', () => {
  const posts = src.match(/\/decision-policy`/g) || [];
  expect(posts.length).toBe(1);
});
