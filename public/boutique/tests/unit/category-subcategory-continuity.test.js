'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 * @feature catalog
 */
const fs = require('fs');
const path = require('path');

const categories = fs.readFileSync(path.resolve(__dirname, '../../css/categories.css'), 'utf8');
const cutout = fs.readFileSync(path.resolve(__dirname, '../../css/category-cutout-navigation.css'), 'utf8');
const desktopShelf = fs.readFileSync(path.resolve(__dirname, '../../css/category-cutout-navigation-desktop.css'), 'utf8');
const desktop = fs.readFileSync(path.resolve(__dirname, '../../css/boutique-desktop.css'), 'utf8');
const interactions = fs.readFileSync(path.resolve(__dirname, '../../css/interactions.css'), 'utf8');
const visuals = fs.readFileSync(path.resolve(__dirname, '../../js/render/category-shelf-visuals.js'), 'utf8');
const subcat = fs.readFileSync(path.resolve(__dirname, '../../js/b-subcat.js'), 'utf8');
const index = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
const schema = fs.readFileSync(path.resolve(__dirname, '../../js/shop-schema.js'), 'utf8');

describe('continuité catégories et sous-catégories desktop', () => {
  test('rend le rail image compact et aligné sur le hero', () => {
    expect(categories).toMatch(
      /html\.k-home-premium-v1 \.k-cats-shell\s*\{[^}]*width:\s*calc\(100% - clamp\(32px, 2\.6vw, 48px\)\)/s
    );
    expect(categories).toContain('max-width: 1680px;');
    expect(categories).toMatch(
      /html\.k-home-premium-v1 \.k-chip\s*\{[^}]*flex-basis:\s*118px/s
    );
    expect(categories).toMatch(/\.k-chip\s*\{\s*min-height:\s*64px;\s*\}/s);
    expect(categories).toMatch(/\.k-chip\s*\{\s*height:\s*64px;\s*\}/s);
  });

  test('laisse le rail principal respirer sans filet structurel', () => {
    expect(desktopShelf).toMatch(
      /html\.k-home-premium-v1 \.k-shelf-rail,[\s\S]*?\.k-shelf-rail\s*\{[^}]*background:\s*var\(--white\)[^}]*border:\s*0[^}]*box-shadow:\s*none/s
    );
    expect(desktopShelf).not.toMatch(/border-bottom:\s*1px\s+solid\s+var\(--border-text-06\)/);
  });

  test('prolonge la catégorie active par un sous-rail horizontal compact', () => {
    expect(desktop).toMatch(
      /@media \(min-width:\s*900px\)[\s\S]*?#k-subcats-wrap\s*\{[^}]*display:\s*grid[^}]*width:\s*calc\(100% - clamp\(32px, 2\.6vw, 48px\)\)/s
    );
    expect(desktop).toMatch(
      /html\.k-home-premium-v1 #k-subcats-wrap\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)[^}]*max-width:\s*1680px/s
    );
    expect(desktop).toMatch(
      /html\.k-home-premium-v1 #k-subcats-wrap \.k-subcats-rail\s*\{[^}]*min-width:\s*0[^}]*overflow-x:\s*auto/s
    );
  });

  test('laisse les adaptations mobiles existantes intactes', () => {
    expect(categories).toMatch(/html\.k-mobile-premium-v1 \.k-cats/);
    expect(desktopShelf).not.toMatch(/@media \(max-width:\s*899px\)/);
  });

  test('harmonise le rail mobile sans capsule ni hausse de hauteur', () => {
    expect(cutout).toContain('@media (max-width: 899px)');
    expect(cutout).toContain('height: 60px;');
    expect(cutout).toContain('--k-optical-scale: .94;');
    expect(cutout).toContain('saturate(var(--k-optical-saturation))');
    expect(cutout).not.toContain('sepia(.04)');
    expect(cutout).toContain('contrast(1.10)');
  });

  test('calibre individuellement les huit univers du rail mobile', () => {
    [
      'all', 'Soldes', 'Mode & Beauté', 'Maison',
      'Tech', 'Bricolage', 'Créations personnelles', 'Auto',
    ].forEach((key) => {
      expect(cutout).toContain(`.k-shelf-rail .k-cat-cutout[data-cat="${key}"]`);
    });
  });

  test('préserve le positionnement absolu des cellules atlas mobile', () => {
    expect(cutout).toMatch(
      /\.k-shelf-object-slot\s*>\s*\.k-shelf-atlas-cell\s*\{[^}]*position:\s*absolute[^}]*inset:\s*0/s
    );
    expect(cutout).not.toMatch(
      /@media \(max-width:\s*899px\)[\s\S]*\.k-shelf-rail \.k-cat-cutout \.k-shelf-object\s*\{[^}]*position:\s*relative/s
    );
  });

  test('calibre les huit univers desktop sans changer leur taxonomie', () => {
    [
      'all', 'Soldes', 'Mode & Beauté', 'Maison',
      'Tech', 'Bricolage', 'Créations personnelles', 'Auto',
    ].forEach((key) => {
      expect(desktopShelf).toContain(`.k-shelf-rail .k-cat-cutout[data-cat="${key}"]`);
    });
    expect(desktopShelf).toContain('--k-desktop-saturation: 1;');
    expect(desktopShelf).toContain('saturate(var(--k-desktop-saturation))');
    expect(desktopShelf).not.toContain('sepia(.035)');
    expect(desktopShelf).toContain('min-height: 94px;');
  });

  test('préfère la photo catalogue réelle et conserve seulement un fallback canonique', () => {
    const fallbackVisualKeys = [
      'mode-cutout:femme', 'mode-cutout:homme', 'mode-cutout:enfant', 'mode-cutout:beaute',
      'sub-maison-confort', 'sub-maison-cuisine', 'sub-maison-deco', 'sub-maison-enfants',
      'sub-tech-phone', 'sub-tech-ordi', 'sub-tech-audio', 'sub-tech-montre', 'sub-tech-gaming',
      'sub-brico-outils', 'sub-brico-elec', 'sub-brico-securite',
      'sub-perso-ceremonie', 'sub-perso-cadeau', 'sub-perso-impression',
      'sub-auto-filtres', 'sub-auto-freinage', 'sub-auto-eclairage', 'sub-auto-moto',
    ];
    fallbackVisualKeys.forEach((key) => expect(visuals).toContain(key));
    expect(visuals).toContain('getShelfSubcategoryProductImage');
    expect(visuals).toContain('renderShelfProductPhoto');
    expect(visuals).toContain('categoryCandidates');
    expect(desktopShelf).toContain('.k-shelf-product-photo');
    expect(desktopShelf).toContain('.k-subcutout-icon--all .k-shelf-object--all');
    expect(desktopShelf).toContain('color: var(--catalog-nav-muted);');
    expect(desktopShelf).toContain('color: var(--catalog-nav-strong);');
    expect(subcat).toContain('getShelfSubcategoryProductImage');
    expect(desktopShelf).toContain('.k-shelf-emoji-fallback');
    expect(desktopShelf).not.toContain('grayscale(1)');
    expect(desktopShelf).not.toContain('sepia(.58)');
    expect(desktopShelf).not.toContain('hue-rotate(62deg)');
  });

  test('réutilise les mêmes photos produit naturelles dans le pager mobile', () => {
    expect(subcat).toContain('getShelfSubcategoryProductImage');
    expect(subcat).toContain('renderShelfProductPhoto');
    expect(subcat).toContain('data-shelf-media=\"product\"');
    expect(interactions).toMatch(/\.k-flat-subcat-tab\s*\{[^}]*flex-direction:\s*column[^}]*background:\s*transparent[^}]*border:\s*0/s);
    expect(interactions).toMatch(/\.k-flat-subcat-object\s*\{[^}]*object-fit:contain[^}]*saturate\(1\.02\)[^}]*contrast\(1\.04\)/s);
    expect(interactions).not.toMatch(/\.k-flat-subcat-object[^}]*grayscale\(1\)/s);
    expect(interactions).not.toMatch(/\.k-flat-subcat-object[^}]*hue-rotate\(62deg\)/s);
    expect(interactions).toMatch(/\.k-flat-subcat-tab\.is-active::after\s*\{[^}]*width:\s*18px/s);
  });

  test('garde les huit images dans la seule source taxonomique', () => {
    expect(index).toMatch(/<nav class="k-cats" id="k-cats" aria-label="Catégories du catalogue"><\/nav>/);
    expect(index).not.toMatch(/\/boutique\/categories\/.+\.(?:jpg|webp)/);
    [
      'all', 'soldes', 'mode', 'maison',
      'tech', 'bricolage', 'creations', 'auto',
    ].forEach((name) => {
      expect(schema).toContain(`/boutique/categories/${name}-v2.webp`);
    });
  });
});
