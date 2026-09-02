/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
'use strict';

const fs = require('fs');
const path = require('path');

const cssPath = path.resolve(__dirname, '../../css/hero-ultra-mobile.css');
const heroCssPath = path.resolve(__dirname, '../../css/hero.css');
const heroBootstrapPath = path.resolve(__dirname, '../../js/hero-bootstrap.js');
const css = fs.readFileSync(cssPath, 'utf8');
const heroCss = fs.readFileSync(heroCssPath, 'utf8');
const heroBootstrap = fs.readFileSync(heroBootstrapPath, 'utf8');

describe('hero ultra mobile contract', () => {
  test('reste strictement mobile et devient une signature compacte mais lisible', () => {
    expect(css).toContain('@media (max-width: 899px)');
    expect(css).toContain('height: clamp(80px, 22vw, 90px);');
    expect(css).not.toContain('@media (min-width: 900px)');
  });

  test('préserve les coiffures et le téléphone dans la boîte compacte', () => {
    expect(css).toContain("background-image: url('/images/komerce_hero_catalog_canonical_v5_mobile.webp');");
    expect(css).toContain('background-size: auto 101%;');
    expect(css).toContain('background-position: 71% 7%;');
    expect(css).toContain('-webkit-mask-image: none;');
    expect(css).toContain('mask-image: none;');
    expect(css).not.toContain('display: none;');
  });

  test('garde le slogan visible dans la réserve blanche gauche', () => {
    expect(css).toContain('.k-hero-media .k-hero-mini-slogan--premium');
    expect(css).toContain('inset: 0 auto 0 0;');
    expect(css).toContain('width: 36%;');
    expect(css).toContain('padding: 7px 0 0 9px;');
    expect(css).toContain('text-align: left;');
    expect(css).toContain('font-size: clamp(11px, 3.1vw, 13px);');
    expect(heroCss).toContain('.k-hero-mini-slogan {\n  display: flex;');
    expect(heroCss).not.toContain('Slogan mobile : supprimé (H0)');
  });

  test('ne réintroduit aucun symbole lunaire', () => {
    expect(css).not.toContain('k-hero-moon');
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
