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
const desktop = fs.readFileSync(path.resolve(__dirname, '../../css/boutique-desktop.css'), 'utf8');
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
    expect(desktop).toMatch(
      /html\.k-home-premium-v1 #k-subcats-wrap \.k-subchip\.active\s*\{[^}]*border-color:\s*var\(--ocean-dark\)[^}]*color:\s*var\(--ocean-dark\)/s
    );
  });

  test('laisse les adaptations mobiles existantes intactes', () => {
    expect(categories).toMatch(/html\.k-mobile-premium-v1 \.k-cats/);
    expect(desktop).not.toMatch(/@media \(max-width:\s*899px\)[\s\S]*continuité catégories/);
  });

  test('harmonise le rail mobile sans capsule ni hausse de hauteur', () => {
    expect(cutout).toContain('@media (max-width: 899px)');
    expect(cutout).toContain('height: 64px;');
    expect(cutout).toContain('background: var(--white);');
    expect(cutout).toContain('saturate(.84)');
    expect(cutout).toContain('contrast(1.02)');
    expect(cutout).toContain('brightness(1.02)');
    expect(cutout).toContain('background: var(--sand-warm);');
    expect(cutout).toContain('scale(1.22)');
    expect(cutout).toContain('color: var(--ocean-dark);');
    expect(cutout).not.toMatch(/@media \(max-width:\s*899px\)[\s\S]*border-radius:\s*999px/);
  });

  test('préserve le positionnement absolu des cellules atlas mobile', () => {
    expect(cutout).toMatch(
      /\.k-shelf-object-slot\s*>\s*\.k-shelf-atlas-cell\s*\{[^}]*position:\s*absolute[^}]*inset:\s*0/s
    );
    expect(cutout).not.toMatch(
      /@media \(max-width:\s*899px\)[\s\S]*\.k-shelf-rail \.k-cat-cutout \.k-shelf-object\s*\{[^}]*position:\s*relative/s
    );
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
