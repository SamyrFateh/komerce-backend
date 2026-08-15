'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 * @feature catalog
 */
const fs = require('fs');
const path = require('path');

const hero = fs.readFileSync(path.resolve(__dirname, '../../css/hero.css'), 'utf8');
const categories = fs.readFileSync(path.resolve(__dirname, '../../css/categories.css'), 'utf8');
const index = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');

describe('hero desktop panoramique Komerce', () => {
  test('charge l’asset panoramique uniquement dans la branche desktop', () => {
    expect(index).toMatch(
      /<link rel="preload" as="image" href="\/images\/komerce_hero_desktop_panorama_v2\.webp"/
    );
    expect(index).toMatch(
      /<source media="\(min-width: 900px\)"[^>]+komerce_hero_desktop_panorama_v2\.webp/
    );
    expect(index).toMatch(
      /<source media="\(max-width: 899px\)"[^>]+komerce_hero_final_1080x310\.webp/
    );
  });

  test('superpose le texte au panorama sans recréer un split 50\/50', () => {
    expect(hero).toMatch(
      /html\.k-home-premium-v1 \.k-hero-media\s*\{[^}]*grid-template-columns:\s*1fr[^}]*height:\s*clamp\(320px, 21vw, 368px\)[^}]*border-radius:\s*18px/s
    );
    expect(hero).toMatch(
      /html\.k-home-premium-v1 \.k-hero-mini-slogan--premium\s*\{[^}]*width:\s*43%[^}]*background:\s*transparent[^}]*z-index:\s*2/s
    );
    expect(hero).toMatch(
      /html\.k-home-premium-v1 \.k-hero-img\s*\{[^}]*object-position:\s*50% 0%/s
    );
    expect(hero).not.toMatch(/grid-template-columns:\s*1fr 1fr/);
  });

  test('ne double pas la réserve du header sticky sur desktop', () => {
    expect(hero).toMatch(
      /body\.k-view-shop #k-header-spacer\s*\{[^}]*height:\s*0 !important/s
    );
    expect(hero).toMatch(
      /html\.k-home-premium-v1 \.k-hero\s*\{[^}]*padding-top:\s*clamp\(16px, 1\.4vw, 22px\)/s
    );
  });

  test('recompose la hauteur et le titre quand le side cart réserve sa largeur', () => {
    expect(hero).toMatch(
      /body\.sc-reserve \.k-hero-media,[\s\S]*?body:has\(\.k-side-cart\.has-items\) \.k-hero-media\s*\{[^}]*height:\s*clamp\(306px, 17\.5vw, 332px\)/
    );
    expect(hero).toMatch(
      /body\.sc-reserve \.k-hero-mini-slogan--premium \.k-line-1,[\s\S]*?font-size:\s*clamp\(34px, 2\.35vw, 44px\)/
    );
  });

  test('garde le rail catégories compact immédiatement sous le hero', () => {
    expect(categories).toMatch(
      /html\.k-home-premium-v1 \.k-cats::before\s*\{[^}]*content:\s*none/s
    );
    expect(categories).toMatch(
      /html\.k-home-premium-v1 \.k-chip\s*\{[^}]*height:\s*88px[^}]*min-height:\s*88px/s
    );
  });
});
