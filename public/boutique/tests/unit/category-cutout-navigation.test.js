'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const mobile = fs.readFileSync(path.join(ROOT, 'css/category-cutout-navigation.css'), 'utf8');
const desktop = fs.readFileSync(path.join(ROOT, 'css/category-cutout-navigation-desktop.css'), 'utf8');
const renderer = fs.readFileSync(path.join(ROOT, 'js/render/render-categories.js'), 'utf8');
const home = fs.readFileSync(path.join(ROOT, 'js/controllers/home-controller.js'), 'utf8');

describe('category cutout navigation contract', () => {
  it('conserve k-chip pour le comportement et ajoute un modifier visuel dédié', () => {
    expect(renderer).toMatch(/class="k-chip k-cat-cutout/);
    expect(mobile).toMatch(/\.k-cat-cutout\s*\{[^}]*background:\s*transparent[^}]*border:\s*0/s);
  });

  it('affiche les catégories comme objets contenus avec petit libellé dessous', () => {
    expect(mobile).toMatch(/\.k-cat-cutout \.k-chip-photo img[\s\S]*object-fit:\s*contain/);
    expect(mobile).toMatch(/\.k-cat-cutout \.k-chip-label,[\s\S]*font-size:\s*10\.5px/);
    expect(mobile).toMatch(/\.k-cat-cutout\.active \.k-chip-label::after[\s\S]*height:\s*2px/);
  });

  it('n émet plus les pills desktop historiques pour les sous-catégories', () => {
    expect(home).toContain('class="k-subcutout');
    expect(home).toContain('class="k-subcutout-rail k-desktop-rayons-rail"');
    expect(home).toMatch(/querySelectorAll\('\.k-subcutout'\)/);
    expect(home).not.toMatch(/class="k-subchip/);
  });

  it('rend les sous-catégories verticales, sans capsule ni fond métier', () => {
    expect(desktop).toMatch(/\.k-subcutout\s*\{[^}]*flex-direction:\s*column[^}]*border:\s*0[^}]*background:\s*transparent/s);
    expect(desktop).toMatch(/\.k-subcutout-icon\s*\{[^}]*width:\s*40px[^}]*height:\s*35px/s);
    expect(desktop).toMatch(/\.k-subcutout-label\s*\{[^}]*font-size:\s*10\.5px/s);
    expect(desktop).toMatch(/\.k-subcutout\.active::after[\s\S]*background:\s*var\(--text\)/);
  });

  it('garde les nouveaux skins hors des selectors ownership historiques', () => {
    expect(mobile).not.toMatch(/(^|\n)\s*\.k-chip(?:\s|\{|:|\.|\[)/);
    expect(desktop).not.toMatch(/#k-subcats-wrap/);
    expect(desktop).not.toMatch(/(^|\n)\s*\.k-subchip(?:\s|\{|:|\.|\[)/);
  });
});
