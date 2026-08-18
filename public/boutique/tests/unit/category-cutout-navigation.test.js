'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const mobile = fs.readFileSync(path.join(ROOT, 'css/category-cutout-navigation.css'), 'utf8');
const desktop = fs.readFileSync(path.join(ROOT, 'css/category-cutout-navigation-desktop.css'), 'utf8');
const renderer = fs.readFileSync(path.join(ROOT, 'js/render/render-categories.js'), 'utf8');
const visuals = fs.readFileSync(path.join(ROOT, 'js/render/category-shelf-visuals.js'), 'utf8');
const home = fs.readFileSync(path.join(ROOT, 'js/controllers/home-controller.js'), 'utf8');
const sprite = fs.readFileSync(path.join(ROOT, 'categories/komerce-shelf-sprite.svg'), 'utf8');

describe('Komerce Shelf category navigation contract', () => {
  it('conserve k-chip pour le comportement et ajoute un modifier visuel dédié', () => {
    expect(renderer).toMatch(/class="k-chip k-cat-cutout/);
    expect(mobile).toMatch(/\.k-cat-cutout\s*\{[^}]*background:\s*transparent/s);
    expect(mobile).toMatch(/\.k-cat-cutout\s*\{[^}]*border:\s*0/s);
  });

  it('rend un vrai objet Shelf sans exposer les panoramas historiques', () => {
    expect(renderer).toContain('k-shelf-object-slot');
    expect(renderer).toContain('renderShelfUse');
    expect(renderer).toContain('k-shelf-legacy-image');
    expect(mobile).toMatch(/\.k-cat-cutout \.k-chip-photo img[\s\S]*object-fit:\s*contain/);
    expect(mobile).toMatch(/\.k-cat-cutout \.k-shelf-legacy-image[\s\S]*opacity:\s*0/);
    expect(mobile).toMatch(/\.k-cat-cutout \.k-chip-label,[\s\S]*font-size:\s*10\.5px/);
  });

  it('porte les visuels de catégories et sous-catégories dans un registre unique', () => {
    expect(visuals).toContain("'Mode & Beauté': 'cat-mode'");
    expect(visuals).toContain("Femme: 'sub-mode-femme'");
    expect(visuals).toContain("Phones: 'sub-tech-phone'");
    expect(visuals).toContain("Filtres: 'sub-auto-filtres'");
    expect(sprite).toContain('symbol id="cat-mode"');
    expect(sprite).toContain('symbol id="sub-mode-femme"');
    expect(sprite).toContain('symbol id="sub-auto-moto"');
  });

  it('préserve les hooks historiques et ajoute le skin Shelf aux sous-catégories', () => {
    expect(home).toContain('class="k-subchip k-subcutout');
    expect(home).toContain('class="k-subcats-rail k-subcutout-rail k-desktop-rayons-rail k-subcats-visible"');
    expect(home).toMatch(/querySelectorAll\('\.k-subchip'\)/);
    expect(home).toContain('k-subcats-context k-subcutout-context');
    expect(home).toContain("classList.add('k-shelf-rail')");
    expect(home).toContain("classList.add('k-shelf-subcats')");
  });

  it('rend les sous-catégories verticales, sans capsule ni fond métier', () => {
    expect(desktop).toMatch(/\.k-subcutout\s*\{[^}]*flex-direction:\s*column[^}]*border:\s*0[^}]*background:\s*transparent/s);
    expect(desktop).toMatch(/\.k-subcutout-icon\s*\{[^}]*width:\s*40px[^}]*height:\s*35px/s);
    expect(desktop).toMatch(/\.k-subcutout-label\s*\{[^}]*font-size:\s*10\.5px/s);
    expect(desktop).toMatch(/\.k-subcutout\.active::after[\s\S]*background:\s*var\(--ocean-dark\)/);
  });

  it('garde les nouveaux skins hors des selectors ownership historiques', () => {
    expect(mobile).not.toMatch(/(^|\n)\s*\.k-chip(?:\s|\{|:|\.|\[)/);
    expect(desktop).not.toMatch(/#k-subcats-wrap/);
    expect(desktop).not.toMatch(/(^|\n)\s*\.k-subchip(?:\s|\{|:|\.|\[)/);
  });
});
