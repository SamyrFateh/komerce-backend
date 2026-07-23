'use strict';

const fs = require('fs');
const path = require('path');

const JS_ROOT = path.join(__dirname, '..', '..', 'js');

function read(relativePath) {
  return fs.readFileSync(path.join(JS_ROOT, relativePath), 'utf8');
}

describe('neutral card stepper — architecture regression', () => {
  it('le renderer ne choisit plus la première ligne panier', () => {
    const source = read('render/render-product-card.js');
    expect(source).toContain('getProductCartSummary');
    expect(source).not.toMatch(/state\.cart\.find\s*\(/);
  });

  it('les suggestions utilisent le renderer canonique et une délégation unique', () => {
    const source = read('b-modal-suggestions.js');
    expect(source).toContain("renderProductCard(product, { variant: 'suggestion', actionVariant: 'modal' })");
    expect(source).toContain('_installSuggestionDelegation');
    expect(source).not.toContain('cloneNode(');
    expect(source).not.toContain('_sugCardMap');
    expect(source).not.toContain('const cardHTML');
  });

  it('les favoris ne réinstallent pas de listeners panier par carte', () => {
    const source = read('b-favs.js');
    expect(source).toContain('renderProductCard(product)');
    expect(source).not.toMatch(/querySelectorAll\(['"]\.k-card-add['"]\)[\s\S]*addEventListener/);
  });

  it('aucun renderer de carte ne référence le panier tressé', () => {
    const sources = [
      read('render/render-product-card.js'),
      read('b-modal-suggestions.js'),
      read('b-favs.js'),
      read('b-cart.js'),
    ].join('\n');
    expect(sources).not.toContain('panier_tresse_vert.png');
    expect(sources).not.toContain('k-card-add-basket');
  });

  it('le vieux stepper long-press est supprimé', () => {
    const source = read('b-cart.js');
    expect(source).not.toContain('setupLongPressSteppers');
    expect(source).not.toContain('k-card-add-stepper');
    expect(source).not.toContain("new CustomEvent('cart:setqty'");
  });
});
