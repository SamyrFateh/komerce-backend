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

  it('restaure sur mobile une seule ligne horizontale compacte', () => {
    const mobileBlock = mobile.match(/@media \(max-width: 899px\) \{[\s\S]*\n\}/)?.[0] || '';
    expect(mobileBlock).toMatch(/\.k-shelf-rail\s*\{[^}]*display:\s*flex/s);
    expect(mobileBlock).toMatch(/\.k-shelf-rail\s*\{[^}]*flex-wrap:\s*nowrap/s);
    expect(mobileBlock).toMatch(/\.k-shelf-rail\s*\{[^}]*overflow-x:\s*auto/s);
    expect(mobileBlock).not.toMatch(/grid-template-columns/);
    expect(mobileBlock).toMatch(/\.k-shelf-rail \.k-cat-cutout\s*\{[^}]*flex:\s*0 0 68px/s);
    expect(mobileBlock).toMatch(/\.k-cat-cutout \.k-chip-photo,[\s\S]*width:\s*46px[\s\S]*height:\s*40px/s);
  });

  it('porte le pilote Mode image-first dans le registre visuel unique', () => {
    expect(visuals).toContain("KOMERCE_MODE_PILOT_ATLAS = '/boutique/categories/mode-pilot-atlas.webp'");
    expect(visuals).toContain("'Mode & Beauté': 'atlas:0:0'");
    expect(visuals).toContain("Femme: 'atlas:1:0'");
    expect(visuals).toContain("Homme: 'atlas:2:0'");
    expect(visuals).toContain("Enfant: 'atlas:0:1'");
    expect(visuals).toContain("Beauté: 'atlas:1:1'");
    expect(visuals).toContain("__all: 'atlas:2:1'");
    expect(visuals).toContain('renderAtlasCell');
    expect(sprite).toContain('symbol id="cat-maison"');
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
