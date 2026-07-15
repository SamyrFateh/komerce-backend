'use strict';

/**
 * @feature catalog, modal-product
 * Régression UI — les prix mobiles longs ne doivent plus être rognés et la promo
 * ne doit plus changer la géométrie du montant.
 */

const fs = require('fs');
const path = require('path');
const { BUNDLES } = require('../../scripts/css-bundles');

const cssPath = path.join(__dirname, '../../css/modal-product-price-normalization.css');
const css = fs.readFileSync(cssPath, 'utf8');

function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'm'));
  return match ? match[1] : '';
}

describe('modal-product — normalisation du prix mobile', () => {
  test('la couche est réellement incluse dans components.css après les styles modal historiques', () => {
    const components = BUNDLES.find((bundle) => bundle.out === 'components.css');
    const priceLayer = components.files.indexOf('modal-product-price-normalization');
    const modalLayer = components.files.indexOf('modal-product-lot4-hybrid');
    const cartLayer = components.files.indexOf('cart');

    expect(priceLayer).toBeGreaterThan(modalLayer);
    expect(priceLayer).toBeLessThan(cartLayer);
  });

  test('la ligne de prix mobile peut respirer au lieu de rogner les montants longs', () => {
    const block = rule('#k-modal .k-modal-price-row');
    expect(block).toMatch(/overflow:\s*visible/);
    expect(block).toMatch(/flex-wrap:\s*wrap/);
    expect(block).toMatch(/max-width:\s*100%/);
  });

  test('le prix garde une hauteur de ligne sûre et reste sur une seule unité lisible', () => {
    const block = rule('#k-modal .k-modal-price');
    expect(block).toMatch(/line-height:\s*1\.15/);
    expect(block).toMatch(/white-space:\s*nowrap/);
    expect(block).toMatch(/max-width:\s*100%/);
  });

  test('promo et hors promo ont la même géométrie en mobile standard et premium', () => {
    const promo = rule('#k-modal.k-modal--has-promo .k-modal-price');
    expect(promo).toMatch(/font-size:\s*22px/);

    expect(css).toMatch(
      /html\.k-mobile-premium-v1 #k-modal\.k-modal \.k-modal-price,\s*html\.k-mobile-premium-v1 #k-modal\.k-modal\.k-modal--has-promo \.k-modal-price\s*\{[^}]*font-size:\s*clamp\(24px,\s*7vw,\s*30px\)/m
    );
  });

  test('le média mobile réserve un budget vertical au titre, à la référence et au prix', () => {
    const block = rule('#k-modal .k-modal-img-wrap');
    expect(block).toMatch(/min-height:\s*180px/);
    expect(block).toMatch(
      /max-height:\s*clamp\(180px,\s*calc\(100%\s*-\s*190px\),\s*400px\)/
    );
  });
});
