'use strict';

const fs = require('fs');
const path = require('path');

const cssPath = path.resolve(__dirname, '../../css/hero-ultra-mobile.css');
const heroBootstrapPath = path.resolve(__dirname, '../../js/hero-bootstrap.js');
const css = fs.readFileSync(cssPath, 'utf8');
const heroBootstrap = fs.readFileSync(heroBootstrapPath, 'utf8');

describe('hero ultra mobile contract', () => {
  test('reste strictement mobile et ultra compact', () => {
    expect(css).toContain('@media (max-width: 899px)');
    expect(css).toContain('height: clamp(104px, 29vw, 116px);');
    expect(css).not.toContain('@media (min-width: 900px)');
  });

  test('passe en mode diagnostic visuel pur avec marge sur les cheveux', () => {
    expect(css).toContain('background-size: auto 167%;');
    expect(css).toContain('background-position: 81% 18%;');
    expect(css).toContain('-webkit-mask-image: none;');
    expect(css).toContain('mask-image: none;');
    expect(css).toContain('.k-hero-media .k-hero-mini-slogan--premium');
    expect(css).toContain('display: none;');
  });

  test('préserve la petite lune au-dessus de la paume', () => {
    expect(css).toContain('.k-hero-media .k-hero-moon');
    expect(css).toContain('width: 20px;');
    expect(css).toContain('height: 20px;');
    expect(css).toContain('right: 38%;');
    expect(css).toContain('top: 5px;');
  });

  test('replie le hero au scroll mobile et libère réellement la cage produits', () => {
    expect(heroBootstrap).toContain('const HERO_COLLAPSE_THRESHOLD = 24;');
    expect(heroBootstrap).toContain('const HERO_EXPAND_THRESHOLD = 4;');
    expect(heroBootstrap).toContain("page.classList.contains('k-cat-section')");
    expect(heroBootstrap).toContain("document.addEventListener('scroll', onMobileCategoryScroll, true);");
    expect(heroBootstrap).toContain('translate3d(0, -${collapseDistance}px, 0)');
    expect(heroBootstrap).toContain("style.setProperty('--pager-top', nextTop + 'px')");
    expect(heroBootstrap).toContain('st >= HERO_COLLAPSE_THRESHOLD');
    expect(heroBootstrap).toContain('st <= HERO_EXPAND_THRESHOLD');
  });

  test('n’introduit ni priorité forcée ni couleur hexadécimale', () => {
    expect(css).not.toContain('!important');
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});