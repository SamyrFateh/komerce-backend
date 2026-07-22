'use strict';

const {
  buildModalCartProduct,
  _modalCartProductModelTestApi,
} = require('../../js/view-models/modal-cart-product-model.js');

describe('modal-cart-product-model', () => {
  const product = {
    id: 42,
    name: 'Thermos Elite',
    price_kmf: 5000,
    sku: 'BASE',
    image_url: '/base.jpg',
  };

  test('produit legacy : conserve exactement l objet catalogue', () => {
    expect(buildModalCartProduct(product, null, null)).toBe(product);
  });

  test('SKU résolu : snapshotte prix, référence, identifiant et média du contrat', () => {
    const detail = {
      inventory_model: 'SKU',
      pricing: { price_kmf: 6000 },
      sellable_units: [
        { sku_id: 'sku-blue-l', sku: 'THERMOS-BL-L', price_kmf: 7200 },
      ],
    };
    const selection = {
      selected_sku_id: 'sku-blue-l',
      selected_media: [{ id: 'm-blue', url: '/blue.jpg' }],
    };

    const snapshot = buildModalCartProduct(product, detail, selection);

    expect(snapshot).not.toBe(product);
    expect(snapshot).toMatchObject({
      id: 42,
      price_kmf: 7200,
      price: 7200,
      sku: 'THERMOS-BL-L',
      sku_id: 'sku-blue-l',
      selected_sku_id: 'sku-blue-l',
      image_url: '/blue.jpg',
    });
    expect(product.price_kmf).toBe(5000);
  });

  test('prix SKU absent : retombe sur le prix du Product Detail Contract', () => {
    const snapshot = buildModalCartProduct(
      product,
      {
        pricing: { price_kmf: 6100 },
        sellable_units: [{ sku_id: 'sku-1', sku: 'SKU-1', price_kmf: null }],
      },
      { selected_sku_id: 'sku-1', selected_media: [] }
    );

    expect(snapshot.price_kmf).toBe(6100);
  });

  test('SKU sélectionné absent du contrat : fail closed sur le produit original', () => {
    const snapshot = buildModalCartProduct(
      product,
      { sellable_units: [] },
      { selected_sku_id: 'missing' }
    );
    expect(snapshot).toBe(product);
  });

  test('activeSellableUnit compare les identifiants de façon tolérante string/number', () => {
    expect(
      _modalCartProductModelTestApi.activeSellableUnit(
        { sellable_units: [{ sku_id: 7 }] },
        { selected_sku_id: '7' }
      )
    ).toEqual({ sku_id: 7 });
  });
});
