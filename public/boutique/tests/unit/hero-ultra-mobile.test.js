'use strict';

const fs = require('fs');
const path = require('path');

const cssPath = path.resolve(__dirname, '../../css/hero-ultra-mobile.css');
const css = fs.readFileSync(cssPath, 'utf8');

describe('hero ultra mobile contract', () => {
  test('reste strictement mobile et ultra compact', () => {
    expect(css).toContain('@media (max-width: 899px)');
    expect(css).toContain('height: clamp(104px, 29vw, 116px);');
    expect(css).not.toContain('@media (min-width: 900px)');
  });

  test('passe en mode diagnostic visuel pur avec dézoom visible', () => {
    expect(css).toContain('background-size: auto 174%;');
    expect(css).toContain('background-position: 82% 24%;');
    expect(css).toContain('-webkit-mask-image: none;');
    expect(css).toContain('mask-image: none;');
    expect(css).toContain('.k-hero-media .k-hero-mini-slogan--premium');
    expect(css).toContain('display: none;');
  });

  test('préserve et ramène la petite lune au-dessus de la paume', () => {
    expect(css).toContain('.k-hero-media .k-hero-moon');
    expect(css).toContain('width: 20px;');
    expect(css).toContain('height: 20px;');
    expect(css).toContain('right: 39%;');
    expect(css).toContain('top: 4px;');
  });

  test('n’introduit ni priorité forcée ni couleur hexadécimale', () => {
    expect(css).not.toContain('!important');
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
