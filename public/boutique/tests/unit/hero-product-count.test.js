/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 *
 * GAP-F1 — le compteur du hero ne doit jamais afficher une valeur
 * inventée : absent du DOM, zéro produit et une vraie valeur.
 * Cf. docs/gaps/GAP_BOUTIQUE_FRONTEND_CORRECTIONS.md.
 */
'use strict';

const { updateHeroProductCount } = require('../../js/b-catalog.js');

describe('updateHeroProductCount — hero.hero_count jamais inventé', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <span id="k-hero-count" class="k-hero-count" hidden></span><span id="k-hero-count-sep" class="k-trust-sep" hidden>·</span>
    `;
  });

  test('catalogue vide (0) : l\'élément et son séparateur restent masqués, aucun texte', () => {
    updateHeroProductCount(0);
    const el = document.getElementById('k-hero-count');
    const sep = document.getElementById('k-hero-count-sep');
    expect(el.hidden).toBe(true);
    expect(el.textContent).toBe('');
    expect(sep.hidden).toBe(true);
  });

  test('valeur absente ou non numérique : masqué, jamais "NaN produits"', () => {
    updateHeroProductCount(undefined);
    expect(document.getElementById('k-hero-count').hidden).toBe(true);
    updateHeroProductCount(NaN);
    expect(document.getElementById('k-hero-count').hidden).toBe(true);
  });

  test('vraie valeur positive : affiche le compte exact, jamais arrondi ni "+"', () => {
    updateHeroProductCount(127);
    const el = document.getElementById('k-hero-count');
    const sep = document.getElementById('k-hero-count-sep');
    expect(el.hidden).toBe(false);
    expect(el.textContent).toBe('127 produits');
    expect(el.textContent).not.toMatch(/\+/);
    expect(sep.hidden).toBe(false);
  });

  test('singulier correct pour 1 produit', () => {
    updateHeroProductCount(1);
    expect(document.getElementById('k-hero-count').textContent).toBe('1 produit');
  });

  test('élément absent du DOM : ne jette jamais', () => {
    document.body.innerHTML = '';
    expect(() => updateHeroProductCount(42)).not.toThrow();
  });
});
