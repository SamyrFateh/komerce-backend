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
const sections = fs.readFileSync(path.join(ROOT, 'js/render/render-home-sections.js'), 'utf8');
const categories = fs.readFileSync(path.join(ROOT, 'css/categories.css'), 'utf8');
const tokens = fs.readFileSync(path.join(ROOT, 'css/tokens.css'), 'utf8');
const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const swRefresh = fs.readFileSync(path.join(ROOT, 'js/b-service-worker-refresh.js'), 'utf8');
const sw = fs.readFileSync(path.resolve(ROOT, '../sw.js'), 'utf8');

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
    expect(mobile).toMatch(/\.k-cat-cutout \.k-chip-photo img[^\{]*\{[\s\S]*object-fit:\s*contain/);
    expect(mobile).toMatch(/\.k-cat-cutout \.k-shelf-legacy-image[\s\S]*opacity:\s*0/);
    expect(mobile).toMatch(/\.k-cat-cutout \.k-chip-label,[\s\S]*font-size:\s*10\.5px/);
  });

  it('garde sur mobile une seule ligne compacte avec calibration optique', () => {
    const mobileBlock = mobile.match(/@media \(max-width: 899px\) \{[\s\S]*\n\}/)?.[0] || '';
    expect(mobileBlock).toMatch(/\.k-shelf-rail\s*\{[^}]*display:\s*flex/s);
    expect(mobileBlock).toMatch(/\.k-shelf-rail\s*\{[^}]*flex-wrap:\s*nowrap/s);
    expect(mobileBlock).toMatch(/\.k-shelf-rail\s*\{[^}]*overflow-x:\s*auto/s);
    expect(mobileBlock).not.toMatch(/grid-template-columns/);
    expect(mobileBlock).toMatch(/\.k-shelf-rail \.k-cat-cutout\s*\{[^}]*flex:\s*0 0 68px[^}]*height:\s*68px/s);
    expect(mobileBlock).toMatch(/\.k-cat-cutout \.k-chip-photo,[\s\S]*width:\s*58px[\s\S]*height:\s*40px/s);
    expect(mobileBlock).toContain('--k-optical-scale: .97;');
    expect(mobileBlock).toContain('--k-optical-active-scale: 1.05;');
    expect(mobileBlock).toContain('--k-optical-saturation: 1;');
    expect(mobileBlock).toMatch(/translate\(var\(--k-optical-x\), var\(--k-optical-y\)\)/);
    expect(mobileBlock).toContain('saturate(var(--k-optical-saturation))');
    expect(mobileBlock).not.toContain('sepia(');
    expect(mobileBlock).toContain('contrast(1.10)');
    expect(mobile).toContain('color: var(--catalog-nav-muted);');
    expect(mobile).toContain('color: var(--catalog-nav-strong);');
    expect(mobileBlock).toMatch(/padding:\s*4px 8px 5px/);
    expect(mobileBlock).toMatch(/margin-top:\s*2px/);
    expect(mobileBlock).toMatch(/background:\s*var\(--white\)/);
  });

  it('calibre légèrement les huit cutouts déjà normalisés', () => {
    [
      'all', 'Soldes', 'Mode & Beauté', 'Maison',
      'Tech', 'Bricolage', 'Créations personnelles', 'Auto',
    ].forEach((key) => {
      expect(mobile).toContain(`.k-shelf-rail .k-cat-cutout[data-cat="${key}"]`);
    });
    expect(mobile).toMatch(/data-cat="all"[^}]*--k-optical-scale:\s*\.99/s);
    expect(mobile).toMatch(/data-cat="Mode & Beauté"[^}]*--k-optical-saturation:\s*1/s);
    expect(mobile).toMatch(/data-cat="Maison"[^}]*--k-optical-scale:\s*\.97/s);
    expect(mobile).toMatch(/data-cat="Auto"[^}]*--k-optical-y:\s*-1px/s);
  });

  it('porte les huit cutouts HD dans le registre visuel unique', () => {
    expect(visuals).toContain("KOMERCE_SHOWCASE_V1_MODE = '/boutique/categories/komerce-showcase-v1-mode.webp?v=3'");
    expect(visuals).toContain("all: '/boutique/categories/cat-all-v3.webp?v=1'");
    expect(visuals).toContain("soldes: '/boutique/categories/cat-soldes-v3.webp?v=1'");
    expect(visuals).toContain("mode: '/boutique/categories/cat-mode-v3.webp?v=1'");
    expect(visuals).toContain("maison: '/boutique/categories/cat-maison-v3.webp?v=1'");
    expect(visuals).toContain("tech: '/boutique/categories/cat-tech-v3.webp?v=1'");
    expect(visuals).toContain("bricolage: '/boutique/categories/cat-bricolage-v3.webp?v=1'");
    expect(visuals).toContain("perso: '/boutique/categories/cat-perso-v3.webp?v=1'");
    expect(visuals).toContain("auto: '/boutique/categories/cat-auto-v3.webp?v=1'");
    expect(visuals).toContain("'Mode & Beauté': 'cutout:mode'");
    expect(visuals).toContain("'Créations personnelles': 'cutout:perso'");
    expect(visuals).toContain("__all: 'showcase-mode:0:0'");
    expect(visuals).toContain("Femme: 'showcase-mode:1:0'");
    expect(visuals).toContain("Homme: 'showcase-mode:2:0'");
    expect(visuals).toContain("Enfant: 'showcase-mode:0:1'");
    expect(visuals).toContain("Beauté: 'showcase-mode:1:1'");
    expect(visuals).toContain('renderAtlasCell');
    expect(visuals).toContain('renderCategoryCutout');
    expect(visuals).toContain('k-shelf-cutout-image');
    expect(sprite).toContain('symbol id="cat-all"');
    expect(sprite).toContain('symbol id="cat-soldes"');
    expect(sprite).toContain('symbol id="sub-auto-moto"');
  });

  it('rend les cutouts directs et réserve le crop atlas au niveau 2 Mode', () => {
    expect(visuals).toContain('k-shelf-atlas-cell');
    expect(visuals).toContain('k-shelf-atlas-image');
    expect(visuals).toContain('data-atlas-family');
    expect(visuals).toContain('data-atlas-col');
    expect(visuals).toContain('data-atlas-row');
    expect(visuals).toContain("visual.startsWith('cutout:')");
    expect(visuals).toContain("visual.startsWith('showcase-mode:')");
    expect(visuals).not.toContain("visual.startsWith('showcase-main:')");
    expect(visuals).not.toContain('<image href=');
    expect(mobile).toContain('img:not(.k-shelf-atlas-image)');
    expect(mobile).toMatch(/\.k-shelf-atlas-image\s*\{[^}]*width:\s*300%[^}]*height:\s*200%/s);
    expect(mobile).toMatch(/\.k-shelf-object-slot > \.k-shelf-atlas-cell\s*\{[^}]*position:\s*absolute[^}]*inset:\s*0[^}]*width:\s*auto[^}]*height:\s*auto/s);
    expect(mobile).toContain('.k-shelf-atlas-cell[data-atlas-col="2"] .k-shelf-atlas-image { left: -200%; }');
    expect(mobile).toContain('.k-shelf-atlas-cell[data-atlas-row="1"] .k-shelf-atlas-image { top: -100%; }');
    expect(mobile).not.toMatch(/@media \(max-width: 899px\)[\s\S]*\.k-shelf-rail \.k-cat-cutout \.k-shelf-object\s*\{[^}]*position:\s*relative/s);
  });

  it('utilise un contraste gris franc et les cutouts dans les titres de section', () => {
    expect(tokens).toContain('--catalog-nav-muted:  #666964;');
    expect(tokens).toContain('--catalog-nav-strong: #2F312E;');
    expect(mobile).toContain('color: var(--catalog-nav-muted);');
    expect(mobile).toContain('color: var(--catalog-nav-strong);');
    expect(desktop).toContain('color: var(--catalog-nav-muted);');
    expect(desktop).toContain('color: var(--catalog-nav-strong);');
    expect(sections).toContain('renderSectionVisual');
    expect(sections).toContain('k-sec-header-cutout');
    expect(categories).toContain('.k-sec-header-cutout .k-shelf-object--section');
  });

  it('force la rotation du cache qui conservait encore l’ancien atlas', () => {
    expect(index).toContain('/boutique/js/b-service-worker-refresh.js?v=338');
    expect(index).toContain('/boutique/js/main.js?v=356');
    expect(swRefresh).toContain("komerce-v338");
    expect(swRefresh).toContain("event.data?.version === 'v338'");
    expect(sw).toContain("const CACHE = 'komerce-v338'");
    expect(sw).toContain("version: 'v338'");
  });

  it('détache le niveau 2 Shelf de la classe visuelle legacy k-subchip', () => {
    expect(home).toContain('class="k-subcutout ');
    expect(home).toContain('class="k-subcutout${active}"');
    expect(home).not.toContain('class="k-subchip k-subcutout');
    expect(home).toMatch(/querySelectorAll\('\.k-subcutout'\)/);
    expect(home).toContain('class="k-subcats-rail k-subcutout-rail k-desktop-rayons-rail k-subcats-visible"');
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
