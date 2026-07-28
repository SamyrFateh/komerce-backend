'use strict';

/**
 * tests/unit/modal-desktop-sticky-image.test.js
 *
 * MIGRATION v3.0 (LOT 1) — retrait chirurgical du sticky sur l'image produit.
 *
 * Contexte : la référence canonique v3.0 (docs/reference/reference-modale-4-etats.html,
 * fusionnée via PR #650) est incompatible avec l'image épinglée pendant le scroll
 * des variantes. L'ancien oracle RÉF-2026-07h imposait `position: sticky` +
 * `grid-row: 1 / -1` sur `.k-modal-img-wrap` ; ce fichier affirmait exactement
 * l'inverse de ce que la v3.0 exige. Il est donc remplacé (et non simplement
 * supprimé) pour garder un garde-fou anti-régression sur ce point précis : que
 * le sticky ne soit pas réintroduit silencieusement.
 *
 * Ce test est une lecture CSS statique, comme l'était l'oracle précédent.
 */

const fs   = require('fs');
const path = require('path');

const ROOT      = path.resolve(__dirname, '../..');
const SHELL_CSS = path.join(ROOT, 'css/modal-shell.css');

// Les commentaires CSS mentionnent volontairement "sticky" (traçabilité de
// la migration) — on les retire avant de matcher pour ne tester que les
// déclarations réelles, pas la prose explicative.
const stripCssComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

const shell = stripCssComments(fs.readFileSync(SHELL_CSS, 'utf8'));

describe('image produit desktop — non-sticky (migration v3.0, LOT 1)', () => {

  test('.k-modal-img-wrap (≥900px, base) n\'est plus en position:sticky', () => {
    const section = shell.slice(shell.indexOf('@media (min-width: 900px)'));
    const imgRule = section.match(/#k-modal\s+\.k-modal-product-zone\s+\.k-modal-img-wrap\s*\{([^}]*)\}/s)?.[1] ?? '';
    expect(imgRule).not.toMatch(/position\s*:\s*sticky/);
    expect(imgRule).toMatch(/grid-row\s*:\s*1\s*;/);
    expect(imgRule).not.toMatch(/grid-row\s*:\s*1\s*\/\s*-1/);
  });

  test('.k-modal-img-wrap (≥1200px) n\'a plus de grid-row spanning hérité du collage', () => {
    const idx1200 = shell.indexOf('@media (min-width: 1200px)');
    const section = shell.slice(idx1200, shell.indexOf('.k-modal-product-zone .k-modal-details', idx1200));
    const imgRule = section.match(/#k-modal\s+\.k-modal-product-zone\s+\.k-modal-img-wrap\s*\{([^}]*)\}/s)?.[1] ?? '';
    expect(imgRule).not.toMatch(/position\s*:\s*sticky/);
    expect(imgRule).toMatch(/grid-row\s*:\s*1\s*;/);
    expect(imgRule).not.toMatch(/grid-row\s*:\s*1\s*\/\s*-1/);
  });

  test('aucune règle .k-modal-img-wrap du shell ne pose plus jamais position:sticky', () => {
    // Garde-fou global : le sticky ne doit pas réapparaître ailleurs dans le
    // fichier (ex. réintroduit par erreur dans un futur breakpoint).
    const allImgWrapRules = [...shell.matchAll(/#k-modal[^{]*\.k-modal-img-wrap\s*\{([^}]*)\}/gs)];
    for (const rule of allImgWrapRules) {
      expect(rule[1]).not.toMatch(/position\s*:\s*sticky/);
    }
  });
});
