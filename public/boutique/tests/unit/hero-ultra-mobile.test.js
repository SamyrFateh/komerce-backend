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
  test('reste strictement mobile et tend le masthead sans réduire le header tactile', () => {
    expect(css).toContain('@media (max-width: 899px)');
    expect(css).toContain('height: clamp(54px, 15vw, 62px);');
    expect(css).toContain('header 44 px + hero 58.5 px');
    expect(css).not.toContain('@media (min-width: 900px)');
  });

  test('remonte la mini-scène personnages dans la boîte raccourcie', () => {
    expect(css).toContain("background-image: url('/images/komerce_hero_catalog_canonical_v5_mobile.webp');");
    expect(css).toContain('background-size: auto 118%;');
    expect(css).toContain('background-position: 70% 44%;');
    expect(css).toContain('-webkit-mask-image: none;');
    expect(css).toContain('mask-image: none;');
    expect(css).not.toContain('display: none;');
  });

  test('garde le slogan visible mais compact dans la réserve gauche', () => {
    expect(css).toContain('.k-hero-media .k-hero-mini-slogan--premium');
    expect(css).toContain('inset: 0 auto 0 0;');
    expect(css).toContain('width: 35%;');
    expect(css).toContain('padding: 2px 0 0 9px;');
    expect(css).toContain('text-align: left;');
    expect(css).toContain('font-size: clamp(10px, 2.8vw, 12px);');
    expect(heroCss).toContain('.k-hero-mini-slogan {\n  display: flex;');
    expect(heroCss).not.toContain('Slogan mobile : supprimé (H0)');
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
