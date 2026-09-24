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
const layoutCssPath = path.resolve(__dirname, '../../css/layout.css');
const heroBootstrapPath = path.resolve(__dirname, '../../js/hero-bootstrap.js');
const css = fs.readFileSync(cssPath, 'utf8');
const heroCss = fs.readFileSync(heroCssPath, 'utf8');
const layoutCss = fs.readFileSync(layoutCssPath, 'utf8');
const heroBootstrap = fs.readFileSync(heroBootstrapPath, 'utf8');

describe('hero ultra mobile contract', () => {
  test('reste strictement mobile et tend le masthead sans réduire le header tactile', () => {
    expect(css).toContain('@media (max-width: 899px)');
    expect(css).toContain('height: clamp(50px, 14vw, 58px);');
    expect(css).toContain('hero 54.6 px');
    expect(css).not.toContain('@media (min-width: 900px)');
  });

  test('garde les coiffures dans le crop sans réagrandir la scène', () => {
    expect(css).toContain("background-image: url('/images/komerce-hero-relais-approved-preview.png');");
    expect(css).toContain('background-size: contain;');
    expect(css).toContain('background-position: center bottom;');
    expect(css).not.toContain('background-size: auto 118%;');
    expect(css).not.toContain('background-position: 70% 92%;');
    expect(css).toContain('-webkit-mask-image: none;');
    expect(css).toContain('mask-image: none;');
    expect(css).not.toContain('.k-hero-figures { display: none;');
  });

  test('garde le slogan visible mais compact dans la réserve gauche', () => {
    expect(css).toContain('.k-hero-media .k-hero-mini-slogan--premium');
    expect(css).toContain('inset: 0 auto 0 0;');
    expect(css).toContain('width: 44%;');
    expect(css).toContain('padding: 2px 0 0 0;');
    expect(css).toContain('text-align: left;');
    expect(css).toContain('font-size: clamp(10px, 2.8vw, 12px);');
    expect(heroCss).toContain('.k-hero-mini-slogan {\n  display: flex;');
    expect(heroCss).not.toContain('Slogan mobile : supprimé (H0)');
  });

  test('préserve le panier réel et son avatar mobile réduit', () => {
    expect(layoutCss).toContain('width: 21px;');
    expect(css).not.toContain('.k-header .k-cart-btn.k-header-action .k-cart-avatar');
    expect(css).toContain('inset: 0 24px 0 auto;');
    expect(css).toContain('width: 143px;');
    expect(css).not.toContain('.k-cart-btn { width:');
    expect(heroCss).toContain('.k-hero-copy-mobile { display: none; }');
  });

  test('ne réintroduit aucun symbole lunaire', () => {
    expect(css).not.toContain('k-hero-moon');
  });

  test('le hero mobile reste stable : aucun collapse au scroll catégorie', () => {
    expect(heroBootstrap).toContain('Hero mobile stable sous le header');
    expect(heroBootstrap).toContain('clearMobileHeroInlineState');
    expect(heroBootstrap).not.toContain('HERO_COLLAPSE_THRESHOLD');
    expect(heroBootstrap).not.toContain('HERO_EXPAND_THRESHOLD');
    expect(heroBootstrap).not.toContain('onMobileCategoryScroll');
    expect(heroBootstrap).not.toContain("document.addEventListener('scroll'");
    expect(heroBootstrap).not.toContain('translate3d(0, -${collapseDistance}px, 0)');
    expect(heroBootstrap).not.toContain("style.setProperty('--pager-top', nextTop + 'px')");
  });

  test('n’introduit ni priorité forcée ni couleur hexadécimale', () => {
    expect(css).not.toContain('!important');
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
