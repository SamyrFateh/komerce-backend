'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const css = fs.readFileSync(path.join(ROOT, 'css/responsive-desktop-matrix.css'), 'utf8');
const bundles = require('../../scripts/css-bundles.js').BUNDLES;
const ownership = require('../../scripts/critical-selector-ownership.js').CRITICAL_SELECTOR_OWNERSHIP;

describe('Boutique responsive matrix', () => {
  test('le fichier est chargé en dernier dans le bundle desktop', () => {
    const desktop = bundles.find(bundle => bundle.out === 'desktop.css');
    expect(desktop).toBeDefined();
    expect(desktop.files.at(-1)).toBe('responsive-desktop-matrix');
  });

  test('desktop compact 900–1199 passe à trois colonnes et réduit le side-cart', () => {
    expect(css).toMatch(/@media\s*\(min-width:\s*900px\)\s*and\s*\(max-width:\s*1199px\)/);
    expect(css).toMatch(/grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
    expect(css).toMatch(/--sc-reserve-w:\s*clamp\(208px,\s*21vw,\s*224px\)/);
  });

  test('desktop ≥1200 devient fluide selon la largeur réellement disponible', () => {
    expect(css).toMatch(/@media\s*\(min-width:\s*1200px\)/);
    expect(css).toMatch(/--sc-reserve-w:\s*clamp\(260px,\s*calc\(80px\s*\+\s*15vw\),\s*296px\)/);
    expect(css).toMatch(/grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(260px,\s*1fr\)\)/);
  });

  test('la hauteur compacte la navigation indépendamment de la largeur', () => {
    expect(css).toMatch(/@media\s*\(min-width:\s*900px\)\s*and\s*\(max-height:\s*800px\)/);
    expect(css).toMatch(/@media\s*\(min-width:\s*900px\)\s*and\s*\(max-width:\s*1199px\)\s*and\s*\(max-height:\s*720px\)/);
    expect(css).toContain('min-height: 76px;');
    expect(css).toContain('min-height: 66px;');
    expect(css).toContain('width: 62px;');
    expect(css).toContain('height: 50px;');
  });

  test('la matrice n introduit aucune dette important', () => {
    expect(css).not.toContain('!important');
  });

  test('les adaptations critiques sont explicitement gouvernées en desktop', () => {
    for (const selector of ['.k-grid', '.k-sec-grid', '.k-side-cart', '#k-subcats-wrap']) {
      expect(ownership[selector].owners['responsive-desktop-matrix.css']).toEqual(['desktop']);
    }
  });

  test('aucune règle responsive ne crée un troisième breakpoint de largeur', () => {
    const mediaPreludes = [...css.matchAll(/@media\s*([^\{]+)\{/g)]
      .map(match => match[1]);
    const widthBreakpoints = mediaPreludes.flatMap((prelude) =>
      [...prelude.matchAll(/(?:min|max)-width:\s*(\d+)px/g)]
        .map(match => Number(match[1]))
    );
    expect(new Set(widthBreakpoints)).toEqual(new Set([900, 1199, 1200]));
  });
});
