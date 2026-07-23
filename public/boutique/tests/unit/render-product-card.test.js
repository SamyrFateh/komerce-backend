'use strict';

jest.mock('../../js/b-store.js', () => ({
  state: { cart: [] },
}));

jest.mock('../../js/b-utils.js', () => ({
  sanitize: jest.fn((value) => String(value || '').replace(/"/g, '&quot;')),
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
const { sanitize } = require('../../js/b-utils.js');
const { buildProductCardViewModel } = require('../../js/view-models/product-card-view-model.js');
const { renderProductCard, renderAddControl } = require('../../js/render/render-product-card.js');

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
    hasVariants: false,
    ...overrides,
  };
}

beforeEach(() => {
  state.cart = [];
  buildProductCardViewModel.mockReturnValue(baseVm());
});

describe('renderProductCard — contrôle panier neutre', () => {
  it('quantité zéro → vrai bouton +, aucune image panier', () => {
    const html = renderProductCard({ id: 1 });
    expect(html).toContain('class="k-card-add-trigger"');
    expect(html).toContain('class="k-card-add-plus"');
    expect(html).not.toContain('panier_tresse_vert.png');
    expect(html).not.toContain('k-card-add-basket');
  });

  it('une ligne → stepper exact', () => {
    state.cart = [{ product: { id: 1 }, qty: 3 }];
    const html = renderProductCard({ id: 1 });
    expect(html).toContain('k-card-add in-cart');
    expect(html).toContain('k-add-minus');
    expect(html).toContain('k-add-qty" aria-live="polite" aria-label="Quantité">3</output>');
    expect(html).toContain('k-add-plus-ic');
  });

  it('plusieurs lignes variantes → somme totale et contrôle review fail-closed', () => {
    state.cart = [
      { product: { id: 1 }, qty: 2, variant_combo: { taille: 'M' } },
      { product: { id: '1' }, qty: 4, variant_combo: { taille: 'L' } },
    ];
    const html = renderProductCard({ id: 1 });
    expect(html).toContain('has-multiple-lines');
    expect(html).toContain('data-cart-lines="2"');
    expect(html).toContain('data-action="review"');
    expect(html).toContain('quantité totale 6');
    expect(html).not.toContain('k-add-minus');
  });

  it('le conteneur est non interactif et ne crée aucun bouton imbriqué', () => {
    const html = renderProductCard({ id: 1 });
    expect(html).toContain('<div class="k-card-add');
    expect(html).not.toMatch(/<button[^>]*class="k-card-add[^>]*>[\s\S]*<button/);
  });
});

describe('renderProductCard — suggestion canonique', () => {
  it('réutilise le même + et expose les attributs canoniques', () => {
    const html = renderProductCard({ id: 1 }, { variant: 'suggestion' });
    expect(html).toContain('k-sug-card-actions');
    expect(html).toContain('data-add="1"');
    expect(html).toContain('role="group"');
    expect(html).toContain('class="k-catalog-sug-add"');
    expect(html).not.toContain('class="k-sug-add"');
    expect(html).toContain('class="k-sug-add-plus"');
  });



  it('la modale demande explicitement la classe k-sug-add réservée', () => {
    const html = renderProductCard(
      { id: 1 },
      { variant: 'suggestion', actionVariant: 'modal' }
    );
    expect(html).toContain('class="k-sug-add"');
    expect(html).not.toContain('class="k-catalog-sug-add"');
  });

  it('sanitise data-subcat et rend reason_label via le renderer unique', () => {
    buildProductCardViewModel.mockReturnValue(baseVm({
      raw: { subcategory: 'Cuisine" onclick="x', reason_label: 'Souvent acheté' },
    }));
    const html = renderProductCard({ id: 1 }, { variant: 'suggestion' });
    expect(sanitize).toHaveBeenCalledWith('Cuisine" onclick="x');
    expect(html).toContain('data-subcat="Cuisine&quot; onclick=&quot;x"');
    expect(html).toContain('k-sug-card-reason');
    expect(html).toContain('Souvent acheté');
  });
});

describe('renderAddControl — compatibilité', () => {
  it('accepte encore un nombre pour les consommateurs historiques', () => {
    expect(renderAddControl('1', 0, 'Chaise', 'grid')).toContain('k-card-add-plus');
    expect(renderAddControl('1', 2, 'Chaise', 'grid')).toContain('k-add-qty');
  });
});
