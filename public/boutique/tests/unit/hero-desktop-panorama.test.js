'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 * @feature catalog
 *
 * H1 — verifie la composition en calques du hero.
 * Remplace les assertions sur les noms de fichiers webp par des assertions
 * sur la structure de composition : calque present, hero canonique unique,
 * aucun symbole lunaire ni <img> porteur de texte.
 */
const fs = require('fs');
const path = require('path');

const hero = fs.readFileSync(path.resolve(__dirname, '../../css/hero.css'), 'utf8');
const categories = fs.readFileSync(path.resolve(__dirname, '../../css/categories.css'), 'utf8');
const index = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');

describe('hero composition en calques (H1)', () => {
  test('le calque personnages est un div avec background-image, pas un <img>', () => {
    expect(index).toMatch(/class="k-hero-figures"/);
    expect(index).not.toMatch(/<img[^>]+class="k-hero-img"/);
  });

  test('le preload cible le WebP canonique unique', () => {
    expect(index).toMatch(
      /<link rel="preload" as="image" href="\/images\/komerce_hero_catalog_canonical_v3\.webp" type="image\/webp"/
    );
    // Plus de preload des anciens webp
    expect(index).not.toMatch(/preload.*komerce_hero_desktop_panorama/);
    expect(index).not.toMatch(/preload.*komerce_hero_final_1080/);
  });

  test('aucun symbole lunaire ne concurrence le K du téléphone', () => {
    expect(index).not.toMatch(/class="k-hero-moon"/);
    expect(hero).not.toContain('.k-hero-moon');
  });

  test('réduit fortement le panorama desktop sans supprimer les CTA', () => {
    expect(hero).toContain('height: clamp(190px, 14vw, 208px);');
    expect(hero).toContain('min-height: 40px;');
    expect(index).toContain('Découvrir le catalogue →');
    expect(index).toContain('Suivre ma commande');
  });

  test('le CSS porte deux cadrages independants par breakpoint', () => {
    // Desktop
    expect(hero).toMatch(
      /@media\s*\(min-width:\s*900px\)\s*\{[^}]*\.k-hero-figures\s*\{[^}]*background-size/s
    );
    // Mobile
    expect(hero).toMatch(
      /@media\s*\(max-width:\s*899px\)\s*\{[^}]*\.k-hero-figures\s*\{[^}]*background-size/s
    );
  });

  test('aucune <picture> ni <source> dans le hero', () => {
    // Le hero ne doit plus contenir de blocs picture/source
    const heroSection = index.match(/<section class="k-hero"[^]*?<\/section>/s);
    expect(heroSection).not.toBeNull();
    expect(heroSection[0]).not.toMatch(/<picture/);
    expect(heroSection[0]).not.toMatch(/<source/);
  });

  test('superpose le texte au panorama sans recreer un split 50/50', () => {
    expect(hero).toMatch(
      /html\.k-home-premium-v1 \.k-hero-media\s*\{[^}]*grid-template-columns:\s*1fr[^}]*border-radius:\s*18px/s
    );
    expect(hero).not.toMatch(/grid-template-columns:\s*1fr 1fr/);
  });

  test('ne double pas la reserve du header sticky sur desktop', () => {
    expect(hero).toMatch(
      /body\.k-view-shop #k-header-spacer\s*\{[^}]*height:\s*0 !important/s
    );
  });

  test('garde le rail categories compact immediatement sous le hero', () => {
    expect(categories).toMatch(
      /html\.k-home-premium-v1 \.k-cats::before\s*\{[^}]*content:\s*none/s
    );
  });
});
