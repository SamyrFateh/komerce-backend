'use strict';

/**
 * tests/unit/modal-desktop-sticky-image.test.js
 *
 * Oracle RÉF-2026-07h — image produit épinglée pendant le choix des
 * variantes, sans casser le peek naturel des suggestions pour un produit
 * court.
 *
 * Contexte : trois règles empilées au fil de la session bloquaient chacune
 * le collage sticky de l'image pour un raison différente :
 *   1. .k-modal-product-zone avait un min-height quasi-viewport (ligne ~570)
 *      qui forçait la zone à occuper l'espace même pour un produit court.
 *   2. .k-modal-product-zone avait ENSUITE un min/max-height clamp dédié au
 *      peek des suggestions, qui plafonnait aussi l'espace de collage pour
 *      un produit à variantes nombreuses.
 *   3. .k-modal-img-wrap était étiré à height:100%/align-self:stretch pour
 *      combler un vide de fond visuel — un élément qui remplit déjà 100%
     *  de son conteneur n'a nulle part où "coller".
 *
 * Les trois ont été retirées : la zone fait désormais la hauteur de son
 * contenu réel (courte pour un produit simple → peek naturel ; haute pour
 * un produit à variantes nombreuses → l'image dispose de assez de place
 * pour rester épinglée pendant le scroll).
 *
 * Ce test est une lecture CSS statique (comme les autres oracles de ce
 * fichier) — la preuve comportementale (l'image reste réellement à la même
 * position Y pendant le scroll) a été vérifiée manuellement via Playwright
 * au moment de l'implémentation (harnais, hors CI).
 */

const fs   = require('fs');
const path = require('path');

const ROOT       = path.resolve(__dirname, '../..');
const SHELL_CSS  = path.join(ROOT, 'css/modal-shell.css');
const HYBRID_CSS = path.join(ROOT, 'css/modal-product-lot4-hybrid.css');

const shell  = fs.readFileSync(SHELL_CSS, 'utf8');
const hybrid = fs.readFileSync(HYBRID_CSS, 'utf8');

describe('image sticky desktop pendant le scroll variantes — oracle RÉF-2026-07h', () => {

  test('.k-modal-product-zone (≥900px) n\'a plus de min-height quasi-viewport', () => {
    const section = shell.slice(shell.indexOf('@media (min-width: 900px)'));
    const zoneRule = section.match(/#k-modal\s+\.k-modal-product-zone\s*\{([^}]*)\}/s)?.[1] ?? '';
    expect(zoneRule).not.toMatch(/min-height\s*:\s*calc\(min\(880px/);
  });

  test('.k-modal-product-zone (≥1024px) n\'a plus de min-height:100% forcé', () => {
    const idx1024 = shell.indexOf('@media (min-width: 1024px)');
    const section = shell.slice(idx1024, shell.indexOf('.k-modal-product-zone .k-modal-actions', idx1024));
    const zoneRule = section.match(/#k-modal\s+\.k-modal-product-zone\s*\{([^}]*)\}/s)?.[1] ?? '';
    expect(zoneRule).not.toMatch(/min-height\s*:\s*100%/);
  });

  test('.k-modal-img-wrap (≥1024px) n\'est plus étiré à height:100%/align-self:stretch', () => {
    // Le bloc RÉF-2026-07 (stretch) a été retiré ; modal-media.css (source
    // antérieure) reprend la main avec une taille bornée (align-self:center).
    expect(hybrid).not.toMatch(
      /#k-modal\s+\.k-modal-product-zone\s+\.k-modal-img-wrap\s*\{[^}]*align-self\s*:\s*stretch[^}]*height\s*:\s*100%/s
    );
  });

  test('.k-modal-img-wrap (≥900px, base modal-media.css) reste borné — pas de height:100%', () => {
    const mediaCss = fs.readFileSync(path.join(ROOT, 'css/modal-media.css'), 'utf8');
    const imgRule = mediaCss.match(/#k-modal\s+\.k-modal-product-zone\s+\.k-modal-img-wrap\s*\{([^}]*)\}/s)?.[1] ?? '';
    expect(imgRule).toMatch(/align-self\s*:\s*center/);
    expect(imgRule).not.toMatch(/height\s*:\s*100%/);
  });

  test('.k-modal-img-wrap (≥1024px) conserve position:sticky (n\'est plus annulé)', () => {
    const idx1024 = shell.indexOf('@media (min-width: 1024px)');
    const section = shell.slice(idx1024, shell.indexOf('.k-modal-product-zone .k-modal-actions', idx1024));
    const imgRule = section.match(/#k-modal\s+\.k-modal-product-zone\s+\.k-modal-img-wrap\s*\{([^}]*)\}/s)?.[1] ?? '';
    expect(imgRule).not.toMatch(/position\s*:\s*relative/);
  });

  test('.k-modal-product-zone (≥900px, base) reste position:sticky sur img-wrap', () => {
    const section = shell.slice(shell.indexOf('@media (min-width: 900px)'));
    const imgRule = section.match(/#k-modal\s+\.k-modal-product-zone\s+\.k-modal-img-wrap\s*\{([^}]*)\}/s)?.[1] ?? '';
    expect(imgRule).toMatch(/position\s*:\s*sticky/);
    expect(imgRule).toMatch(/top\s*:\s*0/);
  });
});
