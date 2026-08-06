'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const fs = require('fs');
const path = require('path');

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, relativePath), 'utf8');
}

describe('contrat actions suggestions mobile', () => {
  test('la modale utilise le renderer canonique et resynchronise is-filled', () => {
    const suggestions = source('../../js/b-modal-suggestions.js');

    expect(suggestions).toContain("actions.classList.toggle('is-filled', canAdjust)");
    expect(suggestions).toContain("renderAddControl(pid, summary, safeName, 'modal-suggestion')");
    expect(suggestions).toContain("renderProductCard(product, { variant: 'suggestion', actionVariant: 'modal' })");
  });

  test('le renderer sépare explicitement catalogue et modale', () => {
    const renderer = source('../../js/render/render-product-card.js');
    const interactions = source('../../css/interactions.css');

    expect(renderer).toContain("'k-catalog-sug-add'");
    expect(renderer).toContain("'k-sug-add'");
    expect(renderer).toContain("variant === 'modal-suggestion'");
    expect(interactions).toContain('.k-catalog-sug-add');
    expect(interactions).not.toMatch(/(^|\n)\s*\.k-sug-add(?:[:\s,{])/m);
  });

  test('les règles visuelles de la modale sont limitées au mobile', () => {
    const css = source('../../css/modal-mobile-suggestion-actions.css');

    expect(css).toMatch(/@media \(max-width: 899px\)[\s\S]*#k-modal \.k-sug-add/);
    expect(css).toMatch(/#k-modal \.k-sug-card-actions\.is-filled[\s\S]*grid-template-columns:\s*24px 22px 24px/);
    expect(css).toMatch(/#k-modal \.k-sug-add[\s\S]*border-radius:\s*0/);
    expect(css).not.toContain('!important');
  });

  test('la source est incluse après interactions dans components.css', () => {
    const { BUNDLES } = require('../../scripts/css-bundles.js');
    const components = BUNDLES.find((bundle) => bundle.out === 'components.css');
    const interactionsIndex = components.files.indexOf('interactions');
    const mobileActionsIndex = components.files.indexOf('modal-mobile-suggestion-actions');

    expect(interactionsIndex).toBeGreaterThanOrEqual(0);
    expect(mobileActionsIndex).toBeGreaterThan(interactionsIndex);
  });
});
