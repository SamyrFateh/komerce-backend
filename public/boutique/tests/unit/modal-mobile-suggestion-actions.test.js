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
    expect(css).toMatch(/#k-modal \.k-sug-add[\s\S]*border-radius:\s*0/);
    expect(css).not.toContain('!important');
  });

  test('la mise en page en grille (− N +) des actions suggestions reste posée', () => {
    // Depuis B2-4 (#1009), la grille des actions "is-filled" n'est plus
    // définie dans modal-mobile-suggestion-actions.css : elle a été
    // consolidée dans modal-product-polish.css (seul propriétaire, base +
    // override mobile), qui charge après dans components.css et gagne la
    // cascade à spécificité égale. On vérifie donc la géométrie réelle là où
    // elle vit désormais, plutôt que dans le fichier qui l'a cédée.
    const polish = source('../../css/modal-product-polish.css');

    expect(polish).toMatch(/#k-modal \.k-sug-card-actions\.is-filled\s*\{[^}]*grid-template-columns:\s*27px 28px 27px/);
    const mobileIdx = polish.indexOf('@media (max-width: 899px)');
    const desktopIdx = polish.indexOf('@media (min-width: 900px)');
    const mobileBlock = polish.slice(mobileIdx, desktopIdx);
    expect(mobileBlock).toMatch(/#k-modal \.k-sug-card-actions\.is-filled\s*\{[^}]*grid-template-columns:\s*25px 26px 25px/);
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
