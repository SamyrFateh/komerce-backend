'use strict';

/**
 * tests/unit/render/render-product-card.test.js
 *
 * Lot 3 — js/render/render-product-card.js (113L)
 * renderProductCard() : seul renderer de carte produit Komerce, consomme
 * ProductCardViewModel (buildProductCardViewModel) pour produire le HTML
 * final. Contrairement aux 4 autres fichiers du lot, ce module a des
 * dépendances (b-store.js, b-cart-core.js, shop-schema.js, b-utils.js,
 * product-card-view-model.js) → jest.mock() de toutes, pattern déjà en
 * place dans b-cart.test.js. buildProductCardViewModel est mocké pour
 * fournir un vm déterministe par test (le view-model lui-même est déjà
 * testé unitairement dans product-card-view-model.test.js).
 *
 * Périmètre couvert :
 *   - renderProductCard : dispatch variant grid (défaut) vs suggestion
 *   - getCartQty (via state.cart réel, mocké) : article présent/absent
 *   - renderGridCard : promoLabel présent/absent, safeDescription
 *     présente/absente, priceEurLabel présent/absent, oldPriceLabel
 *     présent/absent, favori actif/inactif
 *   - renderSuggestionCard : promoLabel présent/absent, data-subcat
 *   - renderAddControl : qty=0 vs qty>0, variant grid vs suggestion
 *   - options.category résolue via getCategoryByKey, null si absente
 */

jest.mock('../../js/b-store.js', () => ({
  state: { cart: [] },
}));

jest.mock('../../js/b-utils.js', () => ({
  sanitize: jest.fn((s) => s),
  renderProductCarousel: jest.fn(() => '<div class="carousel-mock"></div>'),
}));

jest.mock('../../js/b-cart-core.js', () => ({
  isFav: jest.fn(() => false),
}));

jest.mock('../../js/shop-schema.js', () => ({
  getCategoryByKey: jest.fn(() => null),
}));

jest.mock('../../js/view-models/product-card-view-model.js', () => ({
  buildProductCardViewModel: jest.fn(),
}));

const { state } = require('../../js/b-store.js');
const { sanitize, renderProductCarousel } = require('../../js/b-utils.js');
const { isFav } = require('../../js/b-cart-core.js');
const { getCategoryByKey } = require('../../js/shop-schema.js');
const { buildProductCardViewModel } = require('../../js/view-models/product-card-view-model.js');
const { renderProductCard } = require('../../js/render/render-product-card.js');

/** vm minimal valide, chaque test surcharge les champs qui l'intéressent */
function baseVm(overrides = {}) {
  return {
    id: 1,
    raw: { subcategory: 'Mobilier' },
    cssClassName: 'k-card--standard',
    promoLabel: '',
    safeName: 'Chaise',
    safeDescription: '',
    priceLabel: '12 500 KMF',
    priceEurLabel: '',
    oldPriceLabel: '',
    optimizedImageUrl: 'https://x/img.png',
    imageAlt: 'Chaise',
    ...overrides,
  };
}

beforeEach(() => {
  state.cart = [];
  buildProductCardViewModel.mockReturnValue(baseVm());
});

describe('renderProductCard — dispatch variant', () => {
  it('sans options → variant grid par défaut', () => {
    const html = renderProductCard({ id: 1 });
    expect(html).toContain('k-card ');
    expect(html).not.toContain('k-sug-card');
  });

  it('options.variant="suggestion" → rendu suggestion', () => {
    const html = renderProductCard({ id: 1 }, { variant: 'suggestion' });
    expect(html).toContain('k-sug-card');
  });

  it('options.variant="grid" explicite → rendu grid', () => {
    const html = renderProductCard({ id: 1 }, { variant: 'grid' });
    expect(html).toContain('k-card-img-wrap');
  });
});

describe('renderProductCard — getCartQty', () => {
  it('produit absent du panier → qty=0, bouton ajout sans classe in-cart', () => {
    state.cart = [];
    const html = renderProductCard({ id: 42 });
    expect(html).not.toContain('in-cart');
    expect(html).toContain('k-card-add-basket');
  });

  it('produit présent dans le panier (id string/number) → qty utilisée, classe in-cart', () => {
    state.cart = [{ product: { id: 42 }, qty: 3 }];
    const html = renderProductCard({ id: 42 });
    expect(html).toContain('in-cart');
    expect(html).toContain('k-add-qty">3<');
  });

  it('comparaison par string : id numérique produit vs id string panier', () => {
    state.cart = [{ product: { id: '42' }, qty: 2 }];
    const html = renderProductCard({ id: 42 });
    expect(html).toContain('k-add-qty">2<');
  });
});

describe('renderProductCard — renderGridCard', () => {
  it('promoLabel présent → badge promo affiché', () => {
    buildProductCardViewModel.mockReturnValue(baseVm({ promoLabel: '-20%' }));
    const html = renderProductCard({ id: 1 });
    expect(html).toContain('k-card-promo');
    expect(html).toContain('-20%');
  });

  it('promoLabel vide → pas de badge promo', () => {
    const html = renderProductCard({ id: 1 });
    expect(html).not.toContain('k-card-promo');
  });

  it('safeDescription présente → bloc description affiché', () => {
    buildProductCardViewModel.mockReturnValue(baseVm({ safeDescription: 'Confortable' }));
    const html = renderProductCard({ id: 1 });
    expect(html).toContain('k-card-desc');
    expect(html).toContain('Confortable');
  });

  it('safeDescription vide → pas de bloc description', () => {
    const html = renderProductCard({ id: 1 });
    expect(html).not.toContain('k-card-desc');
  });

  it('priceEurLabel présent → prix EUR affiché', () => {
    buildProductCardViewModel.mockReturnValue(baseVm({ priceEurLabel: '≈ 25 €' }));
    const html = renderProductCard({ id: 1 });
    expect(html).toContain('k-card-price-eur');
    expect(html).toContain('≈ 25 €');
  });

  it('oldPriceLabel présent → prix barré affiché', () => {
    buildProductCardViewModel.mockReturnValue(baseVm({ oldPriceLabel: '15 000 KMF' }));
    const html = renderProductCard({ id: 1 });
    expect(html).toContain('k-card-old-price');
  });

  it('isFav(id) true → classe liked et cœur plein', () => {
    isFav.mockReturnValue(true);
    const html = renderProductCard({ id: 1 });
    expect(html).toContain('liked');
    expect(html).toContain('❤️');
  });

  it('isFav(id) false → pas de classe liked, cœur vide', () => {
    isFav.mockReturnValue(false);
    const html = renderProductCard({ id: 1 });
    expect(html).not.toContain('k-card-fav liked');
    expect(html).toContain('🤍');
  });

  it('utilise renderProductCarousel(vm.raw, 400) pour l\'image', () => {
    const vm = baseVm();
    buildProductCardViewModel.mockReturnValue(vm);
    renderProductCard({ id: 1 });
    expect(renderProductCarousel).toHaveBeenCalledWith(vm.raw, 400);
  });

  it('passe category résolue via getCategoryByKey au view-model', () => {
    const category = { key: 'maison', image_url: 'https://cat/x.png' };
    getCategoryByKey.mockReturnValue(category);
    const product = { id: 1, category: 'maison' };
    renderProductCard(product);
    expect(getCategoryByKey).toHaveBeenCalledWith('maison');
    expect(buildProductCardViewModel).toHaveBeenCalledWith(
      product,
      expect.objectContaining({ variant: 'grid', imageSize: 400, category })
    );
  });

  it('getCategoryByKey renvoie undefined/falsy → category=null transmise', () => {
    getCategoryByKey.mockReturnValue(undefined);
    const product = { id: 1, category: 'inconnu' };
    renderProductCard(product);
    expect(buildProductCardViewModel).toHaveBeenCalledWith(
      product,
      expect.objectContaining({ category: null })
    );
  });
});

describe('renderProductCard — renderSuggestionCard', () => {
  it('promoLabel présent → badge promo suggestion affiché', () => {
    buildProductCardViewModel.mockReturnValue(baseVm({ promoLabel: '-10%' }));
    const html = renderProductCard({ id: 1 }, { variant: 'suggestion' });
    expect(html).toContain('k-sug-promo-badge');
    expect(html).toContain('-10%');
  });

  it('promoLabel vide → pas de badge promo suggestion', () => {
    const html = renderProductCard({ id: 1 }, { variant: 'suggestion' });
    expect(html).not.toContain('k-sug-promo-badge');
  });

  it('data-subcat utilise vm.raw.subcategory sanitisé', () => {
    buildProductCardViewModel.mockReturnValue(baseVm({ raw: { subcategory: 'Cuisine' } }));
    const html = renderProductCard({ id: 1 }, { variant: 'suggestion' });
    expect(sanitize).toHaveBeenCalledWith('Cuisine');
    expect(html).toContain('data-subcat="Cuisine"');
  });

  it('vm.raw.subcategory absente → data-subcat vide, pas de throw', () => {
    buildProductCardViewModel.mockReturnValue(baseVm({ raw: {} }));
    expect(() => renderProductCard({ id: 1 }, { variant: 'suggestion' })).not.toThrow();
  });

  it('appelle buildProductCardViewModel avec variant suggestion et imageSize 200', () => {
    const product = { id: 1 };
    renderProductCard(product, { variant: 'suggestion' });
    expect(buildProductCardViewModel).toHaveBeenCalledWith(
      product,
      expect.objectContaining({ variant: 'suggestion', imageSize: 200 })
    );
  });

  it('utilise vm.optimizedImageUrl et vm.imageAlt pour l\'image', () => {
    buildProductCardViewModel.mockReturnValue(baseVm({ optimizedImageUrl: 'https://x/opt.png', imageAlt: 'Alt X' }));
    const html = renderProductCard({ id: 1 }, { variant: 'suggestion' });
    expect(html).toContain('src="https://x/opt.png"');
    expect(html).toContain('alt="Alt X"');
  });
});

describe('renderProductCard — renderAddControl', () => {
  it('variant grid, qty=0 → icône panier simple', () => {
    state.cart = [];
    const html = renderProductCard({ id: 1 });
    expect(html).toContain('k-card-add-basket');
  });

  it('variant grid, qty>0 → stepper +/- avec quantité', () => {
    state.cart = [{ product: { id: 1 }, qty: 2 }];
    const html = renderProductCard({ id: 1 });
    expect(html).toContain('k-add-minus');
    expect(html).toContain('k-add-plus-ic');
    expect(html).toContain('k-add-qty">2<');
  });

  it('variant suggestion, qty=0 → bouton ajout suggestion', () => {
    state.cart = [];
    const html = renderProductCard({ id: 1 }, { variant: 'suggestion' });
    expect(html).toContain('k-catalog-sug-add');
    expect(html).not.toContain('class="k-sug-add"');
  });

  it('variant suggestion, qty>0 → stepper suggestion avec quantité', () => {
    state.cart = [{ product: { id: 1 }, qty: 4 }];
    const html = renderProductCard({ id: 1 }, { variant: 'suggestion' });
    expect(html).toContain('k-sug-minus');
    expect(html).toContain('k-sug-plus');
    expect(html).toContain('k-sug-qty">4<');
  });
});
