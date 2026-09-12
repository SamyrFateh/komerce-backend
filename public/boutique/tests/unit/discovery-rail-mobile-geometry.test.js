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
const desktopCss = fs.readFileSync(path.resolve(__dirname, '../../css/discovery-desktop-v2.css'), 'utf8');

describe('Discovery mobile rail geometry', () => {
  test('reste dans le flux vertical en grille 2 colonnes sans capter le swipe catégorie', () => {
    const mobileRule = css.match(/\.k-discovery-rail\s*\{([^}]*)\}/)?.[1] || '';
    const mobileCardRule = css.match(/\.k-discovery-canonical-card\s*\{([^}]*)\}/)?.[1] || '';

    expect(mobileRule).toMatch(/display:\s*grid/);
    expect(mobileRule).toMatch(/grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
    expect(mobileRule).toMatch(/gap:\s*8px/);
    expect(mobileRule).not.toMatch(/overflow-x:\s*auto/);
    expect(mobileRule).not.toMatch(/scroll-snap-type/);

    expect(mobileCardRule).toMatch(/min-width:\s*0/);
    expect(mobileCardRule).not.toMatch(/scroll-snap-align/);
  });

  test('ne contient plus aucun sélecteur de l’ancienne famille de cartes Discovery', () => {
    expect(css).not.toMatch(/\.k-discovery-card(?:\s|\{|\[|:)/);
    expect(css).not.toMatch(/\.k-discovery-media(?:\s|\{|\[|:)/);
    expect(css).not.toMatch(/\.k-discovery-info(?:\s|\{|\[|:)/);
    expect(css).not.toMatch(/\.k-discovery-name(?:\s|\{|\[|:)/);
    expect(css).not.toMatch(/\.k-discovery-cta(?:\s|\{|\[|:)/);
  });

  test('réserve le rail horizontal Discovery au desktop avec les cartes canoniques', () => {
    expect(css).toMatch(/@media \(min-width:\s*900px\)[\s\S]*?\.k-discovery-rail\s*\{[^}]*display:\s*flex[^}]*overflow-x:\s*auto[^}]*scroll-snap-type:\s*x proximity/s);
    expect(desktopCss).toMatch(/\.k-discovery-canonical-card\s*\{[\s\S]*?flex:\s*0 0 calc\(\(100% - 48px\) \/ 4\)[^}]*scroll-snap-align:\s*start/s);
  });

  test('utilise le média carré et les slots canoniques sans !important', () => {
    expect(css).toMatch(/\.k-discovery-canonical-media\s*\{[^}]*aspect-ratio:\s*1 \/ 1/s);
    expect(css).toMatch(/\.k-discovery-canonical-action-slot/);
    expect(css).toMatch(/\.k-discovery-canonical-cta/);
    expect(css).not.toMatch(/:\s*[^;{}]*!important\s*;/);
  });
});
