'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 *
 * Verrouille l'invariant catalogue mobile : une sélection de merchandising
 * intermédiaire ne peut jamais retirer un produit publiable de la page Tout.
 */

const { renderHomeSections } = require('../../js/render/render-home-sections.js');
const store = require('../../js/product-store.js');

describe('mobile home catalogue exhaustiveness', () => {
  it('rend les 18 produits complets même si items a été réduit à 16 en amont', () => {
    const allProducts = Array.from({ length: 18 }, (_, index) => ({
      id: `P-${index + 1}`,
      name: `Produit ${index + 1}`,
      category: 'Tech',
      price_kmf: 1000 + index,
      is_available: true,
    }));
    store.setProducts(allProducts);

    // Reproduit le défaut live : l'API/store possède 18 produits mais
    // _balancedPick n'en transmet que 16 au renderer.
    const items = allProducts.slice(0, 16);
    const html = renderHomeSections({
      items,
      allProducts,
      isMobile: true,
      renderCard: (product) => `<article data-product-id="${product.id}">${product.name}</article>`,
      normalizeCategory: (category) => category,
      shuffle: (list) => list,
    });

    expect(html).toContain('<span class="k-sec-header-count">18</span>');
    expect(html).toContain('data-product-id="P-17"');
    expect(html).toContain('data-product-id="P-18"');
  });
});
