'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

/**
 * Oracle — partage produit mobile.
 *
 * Décision PDP densité 2026-08 :
 *
 * - la capacité de partage reste montée dans le DOM commun ;
 * - renderShare() reste partagée avec le desktop ;
 * - le renderer mobile continue donc de la câbler ;
 * - MAIS la rangée WA / Lien n'appartient plus au coeur transactionnel mobile ;
 * - sous 900 px, elle reste masquée afin de ne pas repousser les variantes.
 *
 * Invariant :
 * "monté" ne signifie pas "visible dans la zone d'achat mobile".
 */

const fs   = require('fs');
const path = require('path');

const ROOT        = path.resolve(__dirname, '../..');
const DESKTOP_JS  = fs.readFileSync(
  path.join(ROOT, 'js/b-modal-desktop-product.js'),
  'utf8'
);
const MOBILE_JS   = fs.readFileSync(
  path.join(ROOT, 'js/b-modal-mobile-product.js'),
  'utf8'
);
const PRODUCT_CSS = fs.readFileSync(
  path.join(ROOT, 'css/modal-product.css'),
  'utf8'
);

describe('partage mobile — monté mais hors coeur transactionnel', () => {

  test('renderShare reste exportée depuis le renderer partagé desktop', () => {
    expect(DESKTOP_JS).toMatch(
      /export\s+function\s+renderShare\s*\(/
    );
  });

  test('le renderer mobile continue d’importer renderShare', () => {
    expect(MOBILE_JS).toMatch(
      /import\s*\{[^}]*renderShare[^}]*\}\s*from\s*['"]\.\/b-modal-desktop-product\.js['"]/
    );
  });

  test('le renderer mobile continue de monter le partage dans son flux', () => {
    expect(MOBILE_JS).toMatch(/renderShare\s*\(/);
  });

  test('la rangée de partage est masquée sous 900px', () => {
    const mobileSection = PRODUCT_CSS.slice(
      PRODUCT_CSS.indexOf('@media (max-width: 899px)')
    );

    const rule =
      mobileSection.match(
        /#k-modal\s+\.k-modal-share-row\s*\{([^}]*)\}/s
      )?.[1] ?? '';

    expect(rule).toMatch(/display\s*:\s*none/);
    expect(rule).not.toMatch(/display\s*:\s*flex/);
  });

});