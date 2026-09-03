'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 * @feature catalog
 */
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.resolve(__dirname, '../../css/discovery-rail.css'), 'utf8');

describe('Discovery mobile rail geometry', () => {
  test('reste dans le flux vertical en grille 2 colonnes sans capter le swipe catégorie', () => {
    const mobileRule = css.match(/\.k-discovery-rail\s*\{([^}]*)\}/)?.[1] || '';
    const mobileCardRule = css.match(/\.k-discovery-card\s*\{([^}]*)\}/)?.[1] || '';

    expect(mobileRule).toMatch(/display:\s*grid/);
    expect(mobileRule).toMatch(/grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
    expect(mobileRule).toMatch(/gap:\s*8px/);
    expect(mobileRule).not.toMatch(/overflow-x:\s*auto/);
    expect(mobileRule).not.toMatch(/scroll-snap-type/);

    expect(mobileCardRule).toMatch(/min-width:\s*0/);
    expect(mobileCardRule).not.toMatch(/scroll-snap-align/);
  });

  test('réserve le rail horizontal Discovery au desktop', () => {
    expect(css).toMatch(/@media \(min-width:\s*900px\)[\s\S]*?\.k-discovery-rail\s*\{[^}]*display:\s*flex[^}]*overflow-x:\s*auto[^}]*scroll-snap-type:\s*x proximity/s);
    expect(css).toMatch(/@media \(min-width:\s*900px\)[\s\S]*?\.k-discovery-card\s*\{[^}]*flex:\s*0 0 calc\(\(100% - 60px\) \/ 6\)[^}]*scroll-snap-align:\s*start/s);
  });

  test('compacte média et information locale sans modifier le détail modal', () => {
    expect(css).toMatch(/\.k-discovery-media\s*\{[^}]*aspect-ratio:\s*3 \/ 2/s);
    expect(css).toMatch(/\.k-discovery-info\s*\{[^}]*min-height:\s*88px[^}]*padding:\s*7px/s);
    expect(css).toMatch(/\.k-discovery-cta\s*\{[^}]*min-height:\s*28px/s);
    expect(css).not.toMatch(/:\s*[^;{}]*!important\s*;/);
  });
});
