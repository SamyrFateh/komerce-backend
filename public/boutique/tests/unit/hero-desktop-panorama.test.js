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
const layout = fs.readFileSync(path.resolve(__dirname, '../../css/layout.css'), 'utf8');
const categories = fs.readFileSync(path.resolve(__dirname, '../../css/categories.css'), 'utf8');
const index = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
const desktopArtPath = path.resolve(__dirname, '../../../images/komerce-hero-handoff-v3.webp');

describe('hero composition en calques (H1)', () => {
  test('le calque personnages est un div avec background-image, pas un <img>', () => {
    expect(index).toMatch(/class="k-hero-figures"/);
    expect(index).not.toMatch(/<img[^>]+class="k-hero-img"/);
  });

  test('le preload desktop cible le même master handoff v3 que le mobile', () => {
    expect(index).toMatch(
      /<link rel="preload" as="image" href="\/images\/komerce-hero-handoff-v3\.webp" type="image\/webp" media="\(min-width: 900px\)"/
    );
    expect(index).not.toMatch(/preload.*komerce_hero_desktop_panorama/);
    expect(index).not.toMatch(/preload.*komerce_hero_final_1080/);
  });

  test('aucun symbole lunaire ne concurrence le K du téléphone', () => {
    expect(index).not.toMatch(/class="k-hero-moon"/);
    expect(hero).not.toContain('.k-hero-moon');
  });

  test('aligne le hero desktop sur la promesse et la scène mobile sans supprimer les CTA', () => {
    expect(hero).toContain('height: clamp(190px, 14vw, 208px);');
    expect(hero).toContain("background-image: url('/images/komerce-hero-handoff-v3.webp');");
    // Scène dimensionnée à l'image (ratio natif) pour porter des coins arrondis.
    expect(hero).toMatch(/@media \(min-width: 900px\) \{\s*\.k-hero-figures \{[^}]*aspect-ratio: 2022 \/ 778;[^}]*border-radius: 16px;/s);
    expect(hero).toMatch(/@media \(min-width: 1200px\) \{\s*\.k-hero-figures \{ right: 16%; \}/);
    // Colonne texte à 45 % : à 42 %, « Suivre ma commande » passait à la ligne à 1024 px.
    expect(hero).toContain('width: 45%;');
    expect(hero).toContain('max-width: 620px;');
    expect(hero).not.toContain('width: 42%;');
    expect(hero).toContain('font-style: normal;');
    expect(index).toContain('<span class="k-hero-copy-desktop">Commandez en ligne.</span>');
    expect(index).toContain('<span class="k-hero-copy-desktop">Retirez près de chez vous.</span>');
    expect(index).not.toContain('Vos envies,');
    expect(index).not.toContain('à portée de main.');
    expect(index).not.toContain('La lune,');
    expect(index).toContain('Découvrir le catalogue →');
    expect(index).toContain('Suivre ma commande');
  });

  test('le master desktop v3 est complet et le CSS garde deux cadrages independants par breakpoint', () => {
    const art = fs.readFileSync(desktopArtPath);
    expect(art.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(art.subarray(8, 12).toString('ascii')).toBe('WEBP');
    expect(art.length).toBe(art.readUInt32LE(4) + 8);

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

  test('superpose le texte sur un panorama ouvert sans recreer un split 50/50', () => {
    // Les 5 propriétés du panorama ouvert sont réparties entre la règle
    // principale et des règles d'une ligne (état réel du CSS) : on vérifie
    // l'invariant, pas l'ordre d'écriture.
    expect(hero).toMatch(
      /html\.k-home-premium-v1 \.k-hero-media\s*\{[^}]*grid-template-columns:\s*1fr[^}]*border:\s*0[^}]*background:\s*transparent/s
    );
    expect(hero).toContain('.k-hero-media { box-shadow: none; }');
    expect(hero).toContain('.k-hero-media { border-radius: 0; }');
    expect(hero).toMatch(
      /html\.k-home-premium-v1 \.k-hero\s*\{[^}]*var\(--ocean-bg-08\)[^}]*var\(--coral-focus-08\)[^}]*var\(--white\)/s
    );
    expect(hero).not.toMatch(/grid-template-columns:\s*1fr 1fr/);
  });

  test('900–1199 px : CTA et ligne de confiance sur une ligne, CTA jamais cachés', () => {
    expect(hero).toMatch(/@media \(min-width: 900px\) and \(max-width: 1199px\) \{[^@]*\.k-hero-cta-row,[^{]*\.k-hero-trust \{\s*flex-wrap: nowrap;/s);
    expect(hero).not.toMatch(/\.k-hero-cta-row,\s*html\.k-home-premium-v1 \.k-hero-trust \{\s*flex-wrap: wrap;/);
    expect(hero).not.toMatch(/\.k-hero-cta-ghost \{[^}]*display:\s*none/);
  });

  test('ne double pas la reserve du header sticky sur desktop', () => {
    expect(layout).toContain(
      '#k-header-spacer {\n  height: calc(var(--header-h, 56px) + env(safe-area-inset-top, 0px));\n  flex-shrink: 0;\n}',
    );
    expect(layout).toContain('#k-header-spacer { height: 0; }');
    expect(hero).not.toContain('#k-header-spacer');
    expect(hero).not.toMatch(/height:\s*0\s*!important/);
  });

  test('garde le rail categories compact immediatement sous le hero', () => {
    expect(categories).toMatch(
      /html\.k-home-premium-v1 \.k-cats::before\s*\{[^}]*content:\s*none/s
    );
  });
});
