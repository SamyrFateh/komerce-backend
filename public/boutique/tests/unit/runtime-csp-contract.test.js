/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const utils = fs.readFileSync(path.join(ROOT, 'js/b-utils.js'), 'utf8');
const hydration = fs.readFileSync(path.join(ROOT, 'js/market-hydration.js'), 'utf8');
const catalogFeature = fs.readFileSync(path.join(ROOT, 'features/catalog.feature.js'), 'utf8');

describe('Boutique runtime CSP contract', () => {
  test('market hydration is same-origin external JS, never inline executable script', () => {
    // GAP-F4 (docs/gaps/GAP_BOUTIQUE_FRONTEND_CORRECTIONS.md) — le script est
    // désormais chargé avec `defer` (non bloquant pour le parsing HTML) ; la
    // propriété CSP réellement protégée par ce test est que le script reste
    // externe et same-origin, jamais un bloc <script> inline exécutable —
    // `defer` ne change rien à cette garantie. On matche donc l'attribut src
    // exact plutôt que la balise entière, pour ne pas verrouiller un détail
    // de chargement sans rapport avec le CSP.
    expect(index).toMatch(/<script[^>]*\ssrc="\/boutique\/js\/market-hydration\.js"[^>]*><\/script>/);
    expect(index).not.toMatch(/<script>\s*\/\* H2 — hydratation/);
    expect(hydration).toContain('hydrateMarketLiterals');
    expect(hydration).toContain('window.KomerceMarket');
    expect(catalogFeature).toContain("'../js/market-hydration.js'");
  });

  test('product image fallback uses delegated listeners, never inline event attributes', () => {
    expect(utils).toContain('data-k-product-image="1"');
    expect(utils).toContain("document.addEventListener('error'");
    expect(utils).toContain("document.addEventListener('load'");
    expect(utils).not.toMatch(/return `onload=/);
    expect(utils).not.toMatch(/return `onerror=/);
    expect(utils).not.toContain('onload="${onload}"');
    expect(utils).not.toContain('onerror="${onerror}"');
  });
});
