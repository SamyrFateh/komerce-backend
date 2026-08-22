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
const visuals = fs.readFileSync(path.resolve(__dirname, '../../js/render/category-shelf-visuals.js'), 'utf8');
const index = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
const schema = fs.readFileSync(path.resolve(__dirname, '../../js/shop-schema.js'), 'utf8');

describe('continuité catégories et sous-catégories desktop', () => {
  test('rend le rail image compact et aligné sur le hero', () => {
    expect(categories).toMatch(
      /html\.k-home-premium-v1 \.k-cats-shell\s*\{[^}]*width:\s*calc\(100% - clamp\(32px, 2\.6vw, 48px\)\)[^}]*max-width:\s*1680px/s
    );
    expect(categories).toMatch(
      /html\.k-home-premium-v1 \.k-chip\s*\{[^}]*height:\s*64px[^}]*min-height:\s*64px/s
    );
  });

  test('prolonge la catégorie active par un sous-rail horizontal compact', () => {
    expect(desktop).toMatch(
      /html\.k-home-premium-v1 #k-subcats-wrap\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*auto minmax\(0, 1fr\)[^}]*max-width:\s*1680px/s
    );
    expect(desktop).toMatch(
      /html\.k-home-premium-v1 #k-subcats-wrap \.k-subcats-rail\s*\{[^}]*flex-wrap:\s*nowrap[^}]*overflow-x:\s*auto/s
    );
  });

  test('laisse les adaptations mobiles existantes intactes', () => {
    expect(categories).toMatch(/html\.k-mobile-premium-v1 \.k-cats/);
    expect(desktopShelf).not.toMatch(/@media \(max-width:\s*899px\)/);
  });

  test('harmonise le rail mobile sans capsule ni hausse de hauteur', () => {
    expect(cutout).toContain('@media (max-width: 899px)');
    expect(cutout).toContain('height: 64px;');
    expect(cutout).toContain('--k-optical-scale: 1.06;');
    expect(cutout).toContain('saturate(var(--k-optical-saturation))');
    expect(cutout).toContain('sepia(.04)');
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
    expect(desktopShelf).toContain('--k-desktop-saturation: .84;');
    expect(desktopShelf).toContain('saturate(var(--k-desktop-saturation))');
    expect(desktopShelf).toContain('sepia(.035)');
    expect(desktopShelf).toContain('min-height: 94px;');
  });

  test('calibre tous les visuels connus de sous-catégories et le fallback futur', () => {
    const visualKeys = [
      'showcase-mode:1:0', 'showcase-mode:2:0', 'showcase-mode:0:1', 'showcase-mode:1:1',
      'sub-maison-confort', 'sub-maison-cuisine', 'sub-maison-deco', 'sub-maison-enfants',
      'sub-tech-phone', 'sub-tech-ordi', 'sub-tech-audio', 'sub-tech-montre', 'sub-tech-gaming',
      'sub-brico-outils', 'sub-brico-elec', 'sub-brico-securite',
      'sub-perso-ceremonie', 'sub-perso-cadeau', 'sub-perso-impression',
      'sub-auto-filtres', 'sub-auto-freinage', 'sub-auto-eclairage', 'sub-auto-moto',
    ];
    visualKeys.forEach((key) => {
      expect(visuals).toContain(key);
      expect(desktopShelf).toContain(`[data-shelf-visual="${key}"]`);
    });
    expect(desktopShelf).toContain('.k-subcutout-icon--all .k-shelf-object--all');
    expect(desktopShelf).toContain('.k-shelf-emoji-fallback');
    expect(desktopShelf).toContain('filter: saturate(.72) sepia(.08) brightness(1.02);');
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
