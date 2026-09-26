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
const artPath = path.resolve(__dirname, '../../../images/komerce-hero-handoff-v3-mobile.webp');
const masterPath = path.resolve(__dirname, '../../../images/komerce-hero-handoff-v3.webp');
const indexPath = path.resolve(__dirname, '../../index.html');
const css = fs.readFileSync(cssPath, 'utf8');
const heroCss = fs.readFileSync(heroCssPath, 'utf8');
const layoutCss = fs.readFileSync(layoutCssPath, 'utf8');
const heroBootstrap = fs.readFileSync(heroBootstrapPath, 'utf8');
const indexHtml = fs.readFileSync(indexPath, 'utf8');

describe('hero ultra mobile contract', () => {
  test('reste strictement mobile : deux bandes, slogan puis scène complète', () => {
    expect(css).toContain('@media (max-width: 899px)');
    expect(css).toContain('height: clamp(120px, 33vw, 134px);');
    expect(css).toContain('.k-hero {\n    overflow: visible;');
    expect(css).toContain('margin-bottom: 0;\n    overflow: visible;');
    expect(css).toContain('l\'espace auparavant perdu en padding du rail est réalloué à la scène');
    expect(css).not.toContain('@media (min-width: 900px)');
  });

  test('scène v3 entière sous le slogan : ratio natif, sans zoom ni fondu latéral', () => {
    expect(css).toContain("background-image: url('/images/komerce-hero-handoff-v3-mobile.webp');");
    expect(css).toContain('aspect-ratio: 2022 / 778;');
    expect(css).toContain('background-size: contain;');
    expect(css).not.toContain('background-size: cover;');
    expect(css).toContain('background-position: center center;');
    expect(css).toContain('inset: 26px auto auto 50%;');
    expect(css).toContain('height: calc(100% - 28px);');
    expect(css).not.toContain('background-size: auto 118%;');
    expect(css).not.toContain('background-position: 70% 92%;');
    // Seule la marge haute vide du master est fondue (cheveux à 13,5 %) ; aucun fondu latéral.
    expect(css).toContain('mask-image: linear-gradient(to bottom, transparent 0, black 11%);');
    expect(css).not.toContain('linear-gradient(to right');
    expect(css).not.toContain('.k-hero-figures { display: none;');
  });

  test('slogan centré en bande haute, jamais recouvert par la scène', () => {
    expect(css).toContain('.k-hero-media .k-hero-mini-slogan--premium');
    // Match premium-theme specificity so the compact mobile font size really wins.
    expect(css).toContain('html .k-hero-media .k-hero-mini-slogan--premium {');
    expect(css).toContain('html .k-hero-media .k-hero-mini-slogan--premium .k-line-1 {');
    expect(css).toContain('html .k-hero-media .k-hero-mini-slogan--premium .k-line-2 {');
    expect(css).toContain('inset: 1px 0 auto 0;');
    expect(css).toContain('width: 100%;');
    expect(css).toContain('text-align: center;');
    expect(css).toContain('font-size: clamp(14px, 3.9vw, 16px);');
    expect(css).not.toContain('text-align: left;');
    expect(heroCss).toContain('.k-hero-cats-sticky {');
    expect(heroCss).toContain('padding-top: 8px;');
    expect(css).not.toContain('.k-hero-cats-sticky');
    expect(indexHtml).toContain('Commandez en ligne.');
    expect(indexHtml).toContain('Retirez près de chez vous.');
    expect(heroCss).toContain('.k-hero-mini-slogan {\n  display: flex;');
    expect(heroCss).not.toContain('Slogan mobile : supprimé (H0)');
  });

  test('charge un WebP v3 complet : dérivé mobile 1011x389, master 2022x778, marge haute', () => {
    for (const [file, w, h] of [[artPath, 1011, 389], [masterPath, 2022, 778]]) {
      const art = fs.readFileSync(file);
      expect(art.subarray(0, 4).toString('ascii')).toBe('RIFF');
      expect(art.subarray(8, 12).toString('ascii')).toBe('WEBP');
      // Fichier complet : taille réelle = taille RIFF déclarée (la v3 tronquée de #1769 échouait ici).
      expect(art.length).toBe(art.readUInt32LE(4) + 8);
      const chunk = art.subarray(12, 16).toString('ascii');
      if (chunk === 'VP8 ') {
        expect(art.readUInt16LE(26) & 0x3fff).toBe(w);
        expect(art.readUInt16LE(28) & 0x3fff).toBe(h);
      }
    }
    expect(css).toContain("background-image: url('/images/komerce-hero-handoff-v3-mobile.webp');");
  });

  test('préserve le panier réel et son avatar mobile réduit', () => {
    expect(layoutCss).toContain('width: 21px;');
    expect(css).not.toContain('.k-header .k-cart-btn.k-header-action .k-cart-avatar');
    expect(css).not.toContain('inset: 18px auto auto 54%;');
    expect(css).not.toContain('width: 238px;');
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

