'use strict';

/**
 * tests/unit/modal-mobile-share.test.js
 *
 * Oracle — partage mobile (doc canonique §3 : Partage = Oui / Oui).
 *
 * docs/reference/reference-modale-4-etats.html (v2.1), section
 * "Décision actée — Partage mobile", documentait un écart connu :
 * "Code prod actuel : partage absent sur mobile (renderShare() gardé par
 * isDesktop()) → reste à corriger".
 *
 * Deux causes cumulées :
 *   1. JS : renderShare() (b-modal-desktop-product.js) n'était appelée que
 *      depuis renderDesktopProductDetail() — jamais depuis le renderer
 *      mobile.
 *   2. CSS : .k-modal-share-row { display:none } (base, modal-shell.css)
 *      n'était overridé qu'à ≥900px — aucune règle #k-modal (spécificité
 *      plus forte) ne le rendait visible sous 900px, contrairement à
 *      .k-modal-trust qui a ce mécanisme depuis longtemps (modal-product.css).
 *
 * Ce test verrouille les deux correctifs.
 */

const fs   = require('fs');
const path = require('path');

const ROOT       = path.resolve(__dirname, '../..');
const DESKTOP_JS = fs.readFileSync(path.join(ROOT, 'js/b-modal-desktop-product.js'), 'utf8');
const MOBILE_JS  = fs.readFileSync(path.join(ROOT, 'js/b-modal-mobile-product.js'), 'utf8');
const PRODUCT_CSS = fs.readFileSync(path.join(ROOT, 'css/modal-product.css'), 'utf8');

describe('partage mobile — oracle doc canonique §3', () => {

  test('renderShare est exportée depuis b-modal-desktop-product.js', () => {
    expect(DESKTOP_JS).toMatch(/export\s+function\s+renderShare\s*\(/);
  });

  test('b-modal-mobile-product.js importe renderShare', () => {
    expect(MOBILE_JS).toMatch(/import\s*\{[^}]*renderShare[^}]*\}\s*from\s*['"]\.\/b-modal-desktop-product\.js['"]/);
  });

  test('b-modal-mobile-product.js appelle renderShare() dans son flux de rendu', () => {
    expect(MOBILE_JS).toMatch(/renderShare\s*\(/);
  });

  test('.k-modal-share-row a un override #k-modal visible sous 900px (mobile)', () => {
    // Même mécanisme de spécificité que .k-modal-trust : la règle #k-modal
    // (dans un bloc @media max-width:899px) doit exister pour battre la
    // base .k-modal-share-row{display:none} hors #k-modal.
    const mobileSection = PRODUCT_CSS.slice(PRODUCT_CSS.indexOf('@media (max-width: 899px)'));
    const rule = mobileSection.match(/#k-modal\s+\.k-modal-share-row\s*\{([^}]*)\}/s)?.[1] ?? '';
    expect(rule).toMatch(/display\s*:\s*flex/);
  });

  test('le partage mobile est positionné en ligne séparée sous la réassurance (border-top)', () => {
    const mobileSection = PRODUCT_CSS.slice(PRODUCT_CSS.indexOf('@media (max-width: 899px)'));
    const rule = mobileSection.match(/#k-modal\s+\.k-modal-share-row\s*\{([^}]*)\}/s)?.[1] ?? '';
    expect(rule).toMatch(/border-top/);
  });
});
