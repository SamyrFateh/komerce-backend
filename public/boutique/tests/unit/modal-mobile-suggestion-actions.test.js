'use strict';

const fs = require('fs');
const path = require('path');

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, relativePath), 'utf8');
}

describe('contrat actions suggestions mobile', () => {
  test('la modale pose is-filled dans le HTML initial et après mutation', () => {
    const suggestions = source('../../js/b-modal-suggestions.js');

    expect(suggestions).toContain("actionsEl.classList.toggle('is-filled', qty > 0)");
    expect(suggestions).toContain("k-sug-card-actions${qty > 0 ? ' is-filled' : ''}");
  });

  test('le renderer catalogue utilise une classe distincte', () => {
    const renderer = source('../../js/render/render-product-card.js');

    expect(renderer).toContain('class="k-catalog-sug-add"');
    expect(renderer).not.toContain('class="k-sug-add"');
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
