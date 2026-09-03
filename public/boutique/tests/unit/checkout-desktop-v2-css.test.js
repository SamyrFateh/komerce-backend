'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(
  path.join(__dirname, '../../css/checkout-desktop-v2.css'),
  'utf8'
);

describe('checkout desktop V2 CSS contract', () => {
  it('reste strictement desktop', () => {
    expect(css).toContain('@media (min-width: 900px)');
    expect(css).not.toContain('@media (max-width: 899px)');
  });

  it('donne plus de terrain à la décision transactionnelle', () => {
    expect(css).toMatch(/\.ck-checkout-layout\s*\{[\s\S]*?minmax\(320px, \.8fr\)[\s\S]*?minmax\(0, 1\.2fr\)/);
    expect(css).toContain('--ck-desktop-max: 1280px');
  });

  it('supprime le scroll imbriqué de la colonne checkout', () => {
    const aside = css.match(/\.ck-checkout-aside\s*\{([\s\S]*?)\}/)?.[1] || '';

    expect(aside).toContain('position: static');
    expect(aside).toContain('max-height: none');
    expect(aside).toContain('overflow: visible');
  });

  it('rend les lignes de récap plus lisibles sans modifier le mobile', () => {
    expect(css).toMatch(/\.ck-recap-item\s*\{[\s\S]*?min-height: 72px/);
    expect(css).toMatch(/\.ck-recap-item-img,[\s\S]*?width: 56px;[\s\S]*?height: 56px/);
  });
});
