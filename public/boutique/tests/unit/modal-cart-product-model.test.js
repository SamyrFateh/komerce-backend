'use strict';

const {
  buildModalCartProduct,
  _modalCartProductModelTestApi,
} = require('../../js/view-models/modal-cart-product-model.js');

const { activeSellableUnit } = _modalCartProductModelTestApi;

function product(overrides = {}) {
  return {
    id: 42,
    name: 'Thermos Elite',
    price_kmf: 5000,
    sku: 'BASE',
    image_url: '/base.jpg',
    ...overrides,
  };
}

function detail(unit = {}, pricing = {}) {
  return {
    pricing,
    sellable_units: [{ sku_id: 'sku-1', ...unit }],
  };
}

const selection = {
  selected_sku_id: 'sku-1',
  selected_media: [{ id: 'media-1', url: '/selected.jpg' }],
};

describe('modal-cart-product-model', () => {
  describe('activeSellableUnit', () => {
    test('sans sélection ou sans détail : aucune unité active', () => {
      expect(activeSellableUnit(undefined, undefined)).toBeNull();
      expect(activeSellableUnit(undefined, { selected_sku_id: 'sku-1' })).toBeNull();
      expect(activeSellableUnit({ sellable_units: [] }, { selected_sku_id: null })).toBeNull();
    });

    test('retourne uniquement le SKU sélectionné avec comparaison string/number', () => {
      expect(
        activeSellableUnit(
          { sellable_units: [{ sku_id: 6 }, { sku_id: 7 }] },
          { selected_sku_id: '7' }
        )
      ).toEqual({ sku_id: 7 });
      expect(
        activeSellableUnit(
          { sellable_units: [{ sku_id: 'other' }] },
          { selected_sku_id: 'missing' }
        )
      ).toBeNull();
    });
  });

  test('produit absent ou SKU non résolu : conserve le comportement fail-closed', () => {
    expect(buildModalCartProduct(null, null, null)).toBeNull();
    const base = product();
    expect(buildModalCartProduct(base, null, null)).toBe(base);
    expect(
      buildModalCartProduct(base, { sellable_units: [] }, { selected_sku_id: 'missing' })
    ).toBe(base);
  });

  test('snapshotte le prix, la référence, l identifiant et le média du SKU', () => {
    const base = product();
    const snapshot = buildModalCartProduct(
      base,
      detail({ sku: 'THERMOS-BL-L', price_kmf: 7200 }, { price_kmf: 6000 }),
      selection
    );

    expect(snapshot).not.toBe(base);
    expect(snapshot).toMatchObject({
      id: 42,
      price_kmf: 7200,
      price: 7200,
      sku: 'THERMOS-BL-L',
      sku_id: 'sku-1',
      selected_sku_id: 'sku-1',
      image_url: '/selected.jpg',
    });
    expect(base).toMatchObject({ price_kmf: 5000, image_url: '/base.jpg' });
  });

  test.each([
    ['prix contrat', { price_kmf: null }, { price_kmf: 6100 }, product(), 6100],
    ['price_kmf produit', { price_kmf: null }, {}, product({ price_kmf: 6200 }), 6200],
    ['price produit', { price_kmf: undefined }, {}, product({ price_kmf: undefined, price: 6300 }), 6300],
    ['zéro défensif', { price_kmf: undefined }, {}, product({ price_kmf: undefined, price: undefined }), 0],
  ])('%s : respecte la chaîne de fallback du prix', (_label, unit, pricing, base, expected) => {
    const snapshot = buildModalCartProduct(
      base,
      detail(unit, pricing),
      { selected_sku_id: 'sku-1', selected_media: [] }
    );
    expect(snapshot.price_kmf).toBe(expected);
    expect(snapshot.price).toBe(expected);
  });

  test('référence : SKU unité puis SKU produit puis null', () => {
    expect(
      buildModalCartProduct(
        product({ sku: 'PRODUCT-SKU' }),
        detail({ sku: null, price_kmf: 1 }),
        { selected_sku_id: 'sku-1' }
      ).sku
    ).toBe('PRODUCT-SKU');

    expect(
      buildModalCartProduct(
        product({ sku: null }),
        detail({ sku: null, price_kmf: 1 }),
        { selected_sku_id: 'sku-1' }
      ).sku
    ).toBeNull();
  });

  test.each([
    ['image sélectionnée', [{ url: '/selected.jpg' }], product(), '/selected.jpg'],
    ['image_url produit', [], product({ image_url: '/product.jpg', image: '/legacy.jpg' }), '/product.jpg'],
    ['image legacy produit', null, product({ image_url: '', image: '/legacy.jpg' }), '/legacy.jpg'],
    ['chaîne vide', 'not-an-array', product({ image_url: '', image: '' }), ''],
  ])('%s : respecte la chaîne de fallback média', (_label, selectedMedia, base, expected) => {
    const snapshot = buildModalCartProduct(
      base,
      detail({ sku: 'SKU-1', price_kmf: 1 }),
      { selected_sku_id: 'sku-1', selected_media: selectedMedia }
    );
    expect(snapshot.image_url).toBe(expected);
  });
});
