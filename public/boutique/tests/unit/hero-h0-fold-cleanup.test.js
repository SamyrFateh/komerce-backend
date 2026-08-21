'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 * @feature catalog
 *
 * H0 — vérifie les invariants structurels après dégraissage du pli hero.
 * Ce test ne vérifie PAS les pixels (c'est le rôle de hero-geometry.spec.js).
 * Il vérifie que les doublons restent supprimés et que le hero mobile
 * n'est plus en position:fixed.
 */
const fs = require('fs');
const path = require('path');

const index = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
const baseCss = fs.readFileSync(path.resolve(__dirname, '../../css/dist/base.css'), 'utf8');
const heroCss = fs.readFileSync(path.resolve(__dirname, '../../css/hero.css'), 'utf8');
const heroBootstrap = fs.readFileSync(path.resolve(__dirname, '../../js/hero-bootstrap.js'), 'utf8');

describe('H0 — hero fold cleanup', () => {

  describe('hero-single-promise : la promesse apparaît une seule fois', () => {
    test('aucun .k-search-slogan dans le HTML', () => {
      expect(index).not.toMatch(/class="k-search-slogan"/);
    });

    test('aucune règle .k-search-slogan active dans hero.css', () => {
      // Le commentaire de suppression est OK, une règle CSS active ne l'est pas
      const rules = heroCss.match(/\.k-search-slogan\s*\{/g);
      expect(rules).toBeNull();
    });

    test('le slogan existe exactement une fois dans le hero media', () => {
      const sloganMatches = index.match(/class="k-line-1"/g);
      expect(sloganMatches).not.toBeNull();
      expect(sloganMatches.length).toBe(1);
    });
  });

  describe('hero-title non dupliqué dans le sticky bar', () => {
    test('aucun .k-hero-title dans le HTML', () => {
      expect(index).not.toMatch(/class="k-hero-title/);
    });

    test('aucun .k-hero-pills dans le HTML', () => {
      expect(index).not.toMatch(/class="k-hero-pills"/);
      expect(index).not.toMatch(/class="k-hero-pill"/);
    });
  });

  describe('hero-not-fixed-on-home : le wrap est en flow normal', () => {
    test('#k-hero-fixed-wrap est static dans base.css', () => {
      // Le bloc #k-hero-fixed-wrap doit avoir position: static
      const wrapBlock = baseCss.match(/#k-hero-fixed-wrap\s*\{[^}]*\}/);
      expect(wrapBlock).not.toBeNull();
      expect(wrapBlock[0]).toMatch(/position:\s*static/);
      expect(wrapBlock[0]).not.toMatch(/position:\s*fixed/);
    });

    test('hero-bootstrap.js ne pose plus style.top sur #k-page-scroll', () => {
      expect(heroBootstrap).not.toMatch(/scroll\.style\.top\s*=/);
    });
  });

  describe('le proverbe survit au nettoyage', () => {
    test('#k-proverb-text est toujours dans le HTML', () => {
      expect(index).toMatch(/id="k-proverb-text"/);
    });
  });
});
