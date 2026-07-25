'use strict';

const fs = require('fs');
const path = require('path');

describe('modal-product-lot4-hybrid.css - densification zone produit + teaser suggestions', () => {
  const css = fs.readFileSync(
    path.join(__dirname, '../../css/modal-product-lot4-hybrid.css'),
    'utf8'
  );

  test('agrandit la typographie du nom et du prix à ≥1024px pour combler le vide', () => {
    expect(css).toMatch(
      /#k-modal\s+\.k-modal-info\s+h2\s*\{[^}]*font-size:\s*24px/s
    );
    expect(css).toMatch(
      /#k-modal\s+\.k-modal-price\s*\{[^}]*font-size:\s*34px/s
    );
  });

  test('ne clampe plus la hauteur de la zone produit (RÉF-2026-07h : conflit avec le collage sticky de l\'image)', () => {
    // Le clamp min/max-height précédent forçait une hauteur artificielle qui
    // limitait aussi l'espace de collage de l'image sticky pour un produit à
    // variantes nombreuses. Retiré : la zone fait la hauteur de son contenu
    // réel (court → peek naturel ; long → scroll, accepté explicitement).
    const zoneRule = css.match(/#k-modal\s+\.k-modal-product-zone\s*\{([^}]*)\}/s)?.[1] ?? '';
    expect(zoneRule).not.toMatch(/max-height\s*:\s*clamp/);
    expect(zoneRule).not.toMatch(/min-height\s*:\s*clamp/);
  });

  test('le teaser suggestions desktop est activable au clic/clavier (curseur + focus visible)', () => {
    expect(css).toMatch(
      /#k-modal\s+\.k-modal-sugg-peek\s*\{[^}]*cursor:\s*pointer/s
    );
    expect(css).toMatch(
      /#k-modal\s+\.k-modal-sugg-peek:focus-visible\s*\{[^}]*outline/s
    );
  });

  test('anime le hint de scroll uniquement sans prefers-reduced-motion', () => {
    expect(css).toMatch(
      /@media \(min-width: 1024px\) and \(prefers-reduced-motion: no-preference\)/
    );
    expect(css).toMatch(
      /k-sugg-hint-bounce/
    );
  });
});
