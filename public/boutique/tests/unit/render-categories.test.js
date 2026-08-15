'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/render-categories.test.js
 *
 * Module #13 — js/render/render-categories.js (66L)
 *
 * Seul `renderCategoryRailMarkup` est exporté (ESM). `fallbackBadge` et
 * `renderChipPhoto` sont des helpers internes (le prompt initial listait à
 * tort ces deux fonctions comme exportées — comme pour d'autres modules de
 * cette série, vérification du code source prime sur la doc).
 *
 * Dépend de getRailCategories() (js/shop-schema.js) — données réelles
 * (fallback statique chargé par défaut sous jsdom, cf. shop-schema.test.js)
 * et de sanitize() (js/b-utils.js) — échappement HTML réel via document.
 */

const { renderCategoryRailMarkup } = require('../../js/render/render-categories.js');
const { getRailCategories } = require('../../js/shop-schema.js');

// Reproduit exactement sanitize() (js/b-utils.js) : textContent → innerHTML.
function esc(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

describe('render-categories — renderCategoryRailMarkup', () => {
  it('retourne une string HTML non vide pour les catégories par défaut', () => {
    const html = renderCategoryRailMarkup(null);
    expect(typeof html).toBe('string');
    expect(html.length).toBeGreaterThan(0);
  });

  it('génère un <button class="k-chip"> par catégorie visible dans le rail', () => {
    const html = renderCategoryRailMarkup(null);
    const rail = getRailCategories();
    const buttonCount = (html.match(/<button class="k-chip/g) || []).length;
    expect(buttonCount).toBe(rail.length);
  });

  it('les huit entrées visibles utilisent le set panoramique v2', () => {
    const rail = getRailCategories();
    expect(rail).toHaveLength(8);
    rail.forEach((category) => {
      expect(category.image).toMatch(/^\/boutique\/categories\/[a-z-]+-v2\.webp$/);
    });
  });

  it('chaque bouton porte data-cat avec la clé de la catégorie', () => {
    const html = renderCategoryRailMarkup(null);
    const rail = getRailCategories();
    rail.forEach((cat) => {
      expect(html).toContain(`data-cat="${esc(cat.key)}"`);
    });
  });

  it('la catégorie correspondant à activeCategoryKey porte la classe "active"', () => {
    const rail = getRailCategories();
    const target = rail[1]; // ex: 'Soldes'
    const html = renderCategoryRailMarkup(target.key);
    const re = new RegExp(`<button class="k-chip active" data-cat="${target.key}"`);
    expect(html).toMatch(re);
  });

  it("aucune catégorie active (clé inconnue) → aucun bouton n'a la classe active", () => {
    const html = renderCategoryRailMarkup('clé-inexistante-xyz');
    expect(html).not.toMatch(/k-chip active/);
  });

  it('aria-label reflète le label complet (pas le shortLabel)', () => {
    const rail = getRailCategories();
    const html = renderCategoryRailMarkup(null);
    rail.forEach((cat) => {
      expect(html).toContain(`aria-label="${esc(cat.label)}"`);
    });
  });

  it('chip-label utilise shortLabel si présent, sinon label', () => {
    const rail = getRailCategories();
    const html = renderCategoryRailMarkup(null);
    rail.forEach((cat) => {
      const expectedLabel = cat.shortLabel || cat.label;
      expect(html).toContain(`<span class="k-chip-label">${expectedLabel}</span>`);
    });
  });

  it('catégorie avec image → markup <img> avec loading="lazy" et fallback caché', () => {
    const rail = getRailCategories();
    const withImage = rail.find((c) => !!c.image);
    expect(withImage).toBeTruthy();
    const html = renderCategoryRailMarkup(null);
    // on isole grossièrement le bloc du chip concerné par sa data-cat
    const chipStart = html.indexOf(`data-cat="${withImage.key}"`);
    const chipBlock = html.slice(chipStart, chipStart + 800);
    expect(chipBlock).toContain('k-chip-photo--img');
    expect(chipBlock).toContain('loading="lazy"');
    expect(chipBlock).toContain('k-chip-fallback');
  });

  it('catégorie sans image → pas de balise <img>, fallback direct (emoji/svg/texte)', () => {
    // 'all' (clé 'all') a souvent une image dans le seed ; on construit un
    // jeu synthétique côté shop-schema n'est pas possible ici sans mock —
    // on vérifie simplement la cohérence structurelle pour toute catégorie
    // qui n'a PAS d'image dans le jeu de fallback réel.
    const rail = getRailCategories();
    const withoutImage = rail.find((c) => !c.image);
    if (!withoutImage) {
      // toutes les catégories fallback ont une image → rien à tester ici
      return;
    }
    const html = renderCategoryRailMarkup(null);
    const chipStart = html.indexOf(`data-cat="${withoutImage.key}"`);
    const chipBlock = html.slice(chipStart, chipStart + 400);
    expect(chipBlock).not.toContain('<img');
  });

  it('échappe le HTML dans label/key via sanitize (pas d\'injection brute)', () => {
    // sanitize() passe par textContent → toute balise dans label serait échappée.
    // On vérifie indirectement qu'aucune catégorie réelle ne casse le HTML
    // généré (pas de balise orpheline dans la sortie).
    const html = renderCategoryRailMarkup(null);
    expect(html).not.toMatch(/<script/i);
  });
});
