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

  test('préserve la boîte récit et la petite lune', () => {
    expect(css).toContain('background-size: auto 205%;');
    expect(css).toContain('background-position: 87% 18%;');
    expect(css).toContain('.k-hero-media .k-hero-moon');
    expect(css).toContain('width: 20px;');
    expect(css).toContain("content: 'Catalogue →';");
  });

  test('n’introduit ni !important ni couleur hexadécimale', () => {
    expect(css).not.toContain('!important');
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
