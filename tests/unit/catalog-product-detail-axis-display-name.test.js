'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 *
 * Le key technique d'un axe fournisseur (ex. p_14) appartient à l'identité
 * SKU. Son display_name appartient à la présentation PDP et doit survivre à
 * la projection product_variants -> Product Detail Contract.
 */

const { _buildOptionAxes } = require('../../services/catalog-product-detail');

describe('catalog product detail — option axis display_name', () => {
  test('préserve le libellé sémantique sans modifier la clé technique', () => {
    const axes = _buildOptionAxes([
      {
        variant_type: 'p_14',
        variant_value: 'Black',
        display_name: 'Color',
        image_url: 'https://cdn.test/black.jpg',
        images: [],
      },
      {
        variant_type: 'p_14',
        variant_value: 'White',
        display_name: 'Color',
        image_url: 'https://cdn.test/white.jpg',
        images: [],
      },
    ]);

    expect(axes).toEqual([
      {
        key: 'p_14',
        display_name: 'Color',
        values: [
          { value: 'Black', thumbnail_url: 'https://cdn.test/black.jpg' },
          { value: 'White', thumbnail_url: 'https://cdn.test/white.jpg' },
        ],
      },
    ]);
  });

  test('récupère un libellé sémantique présent sur une ligne ultérieure', () => {
    const [axis] = _buildOptionAxes([
      { variant_type: 'p_14', variant_value: 'Black', display_name: null, image_url: null, images: [] },
      { variant_type: 'p_14', variant_value: 'White', display_name: 'Color', image_url: null, images: [] },
    ]);

    expect(axis.key).toBe('p_14');
    expect(axis.display_name).toBe('Color');
  });

  test('fail-soft historique : retombe sur la clé si aucun libellé n’existe', () => {
    const [axis] = _buildOptionAxes([
      { variant_type: 'p_14', variant_value: 'Black', display_name: null, image_url: null, images: [] },
    ]);

    expect(axis).toMatchObject({ key: 'p_14', display_name: 'p_14' });
  });
});
