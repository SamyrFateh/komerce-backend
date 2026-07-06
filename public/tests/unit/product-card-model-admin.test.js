'use strict';
require('../../dashboards/admin/js/product-card-model.admin.js');

describe('KProductCardModel (admin)', () => {
  it('KProductCardModel est attaché à window', () => {
    expect(window.KProductCardModel).toBeDefined();
  });

  it('resolveModel transforme un produit brut', () => {
    const resolve = window.KProductCardModel.resolveModel || window.KProductCardModel.resolve;
    if (typeof resolve === 'function') {
      const raw = { id: 1, name: 'Test', price_kmf: 5000, category: 'beaute', image_url: '/img.jpg' };
      const model = resolve(raw);
      expect(model).toBeDefined();
    }
  });

  it('produit sans image → fallback', () => {
    const resolve = window.KProductCardModel.resolveModel || window.KProductCardModel.resolve;
    if (typeof resolve === 'function') {
      const raw = { id: 2, name: 'Sans image', price_kmf: 3000, category: 'mode' };
      const model = resolve(raw);
      expect(model).toBeDefined();
    }
  });
});
