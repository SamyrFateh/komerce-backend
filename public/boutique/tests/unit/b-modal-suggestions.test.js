'use strict';

jest.mock('../../js/b-cart.js', () => ({
  quickAdd: jest.fn(),
  quickRemove: jest.fn(),
}));

jest.mock('../../js/b-scroll-owner.js', () => ({
  isDesktop: jest.fn(() => false),
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
  buildProductCardViewModel: jest.fn((product) => ({
    id: product.id,
    raw: product,
    cssClassName: 'k-card--standard',
    promoLabel: product.promo_pct ? `-${product.promo_pct}%` : '',
    safeName: product.name || 'Produit',
    safeDescription: '',
    priceLabel: `${product.price_kmf || 0} KMF`,
    priceEurLabel: '',
    oldPriceLabel: '',
    optimizedImageUrl: product.image_url || 'https://x/img.png',
    imageAlt: product.name || 'Produit',
    hasVariants: Boolean(product.has_variants),
  })),
}));

const { state, dom } = require('../../js/b-store.js');
const { bus } = require('../../js/b-bus.js');
const { quickAdd, quickRemove } = require('../../js/b-cart.js');
const { isDesktop } = require('../../js/b-scroll-owner.js');
const { renderSuggestions } = require('../../js/b-modal-suggestions.js');

function buildDom() {
  document.body.innerHTML =
    '<div id="k-modal"><div class="k-modal-scroll"><div class="k-modal-product-zone">' +
    '<div id="k-modal-sugg-peek" role="button" tabindex="0" hidden>' +
    '<span class="k-modal-sugg-peek-hint">Vous aimerez aussi ↓</span></div>' +
    '</div></div></div>' +
    '<div id="k-modal-suggestions"><h3>Vous aimerez aussi</h3></div>' +
    '<div id="k-sug-rail"></div>';
  dom.sugRail = document.getElementById('k-sug-rail');
  dom.modal = document.getElementById('k-modal');
}

function product(overrides = {}) {
  return {
    id: 1,
    name: 'Produit',
    price_kmf: 1000,
    category: 'Chaussures',
    ...overrides,
  };
}

beforeEach(() => {
  buildDom();
  state.modalProduct = product({ id: 99 });
  state.products = [];
  state.cart = [];
  state.modalSubcatFilter = null;
  quickAdd.mockReset();
  quickRemove.mockReset();
  isDesktop.mockReturnValue(false);
  Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });

  quickAdd.mockImplementation((pid) => {
    const existing = state.cart.find((item) => String(item.product.id) === String(pid));
    if (existing) existing.qty += 1;
    else {
      const candidate = state.products.find((item) => String(item.id) === String(pid)) || product({ id: pid });
      state.cart.push({ product: candidate, qty: 1 });
    }
  });
  quickRemove.mockImplementation((pid) => {
    const existing = state.cart.find((item) => String(item.product.id) === String(pid));
    if (!existing) return;
    existing.qty -= 1;
    if (existing.qty <= 0) state.cart = state.cart.filter((item) => item !== existing);
  });
});

describe('b-modal-suggestions — renderer et délégation uniques', () => {
  it('rend les deux niveaux et reason_label via renderProductCard', () => {
    renderSuggestions(
      [product({ id: 1, name: 'Basket', reason_label: 'Souvent acheté' })],
      [product({ id: 2, name: 'Sac', category: 'Sacs' })],
      'Chaussures'
    );
    expect(dom.sugRail.querySelectorAll('.k-sug-card')).toHaveLength(2);
    expect(dom.sugRail.querySelector('.k-sug-card-reason').textContent).toBe('Souvent acheté');
    expect(dom.sugRail.textContent).toContain('Cela peut vous plaire');
  });

  it('clic carte hors contrôle émet modal:open', () => {
    renderSuggestions([product({ id: 7 })], [], 'Chaussures');
    const handler = jest.fn();
    bus.on('modal:open', handler);
    dom.sugRail.querySelector('.k-sug-card[data-id="7"]')
      .dispatchEvent(new window.Event('click', { bubbles: true }));
    expect(handler).toHaveBeenCalledWith({ id: '7' });
  });

  it('clic + utilise quickAdd et ne propage pas vers la carte', () => {
    state.products = [product({ id: 7 })];
    renderSuggestions([state.products[0]], [], 'Chaussures');
    const handler = jest.fn();
    bus.on('modal:open', handler);
    const add = dom.sugRail.querySelector('.k-sug-add');
    expect(dom.sugRail.querySelector('.k-catalog-sug-add')).toBeNull();
    add.dispatchEvent(new window.Event('click', { bubbles: true }));
    expect(quickAdd).toHaveBeenCalledWith('7', add, { hasVariants: false });
    expect(handler).not.toHaveBeenCalled();
    expect(dom.sugRail.querySelector('.k-sug-qty').textContent).toBe('1');
  });

  it('clic +/- met à jour le contrôle sans cloneNode', () => {
    state.products = [product({ id: 7 })];
    state.cart = [{ product: state.products[0], qty: 2 }];
    renderSuggestions([state.products[0]], [], 'Chaussures');

    const plus = dom.sugRail.querySelector('.k-sug-plus');
    plus.dispatchEvent(new window.Event('click', { bubbles: true }));
    expect(quickAdd).toHaveBeenCalledWith('7', plus);
    expect(dom.sugRail.querySelector('.k-sug-qty').textContent).toBe('3');

    const minus = dom.sugRail.querySelector('.k-sug-minus');
    minus.dispatchEvent(new window.Event('click', { bubbles: true }));
    expect(quickRemove).toHaveBeenCalledWith('7', minus);
    expect(dom.sugRail.querySelector('.k-sug-qty').textContent).toBe('2');
  });

  it('synchronise toutes les occurrences du même produit via cart:update', () => {
    state.products = [product({ id: 7 })];
    renderSuggestions([state.products[0]], [state.products[0]], 'Chaussures');
    expect(dom.sugRail.querySelectorAll('.k-sug-card[data-id="7"]')).toHaveLength(2);

    state.cart = [{ product: state.products[0], qty: 4 }];
    bus.emit('cart:update');

    const quantities = Array.from(dom.sugRail.querySelectorAll('.k-sug-card[data-id="7"] .k-sug-qty'))
      .map((node) => node.textContent);
    expect(quantities).toEqual(['4', '4']);
  });

  it('plusieurs lignes variantes affichent le total fail-closed', () => {
    state.products = [product({ id: 7, has_variants: true })];
    state.cart = [
      { product: state.products[0], qty: 2, variant_combo: { taille: 'M' } },
      { product: state.products[0], qty: 3, variant_combo: { taille: 'L' } },
    ];
    renderSuggestions([state.products[0]], [], 'Chaussures');
    const actions = dom.sugRail.querySelector('.k-sug-card-actions');
    expect(actions.classList.contains('has-multiple-lines')).toBe(true);
    expect(actions.querySelector('[data-action="review"]')).not.toBeNull();
    expect(actions.textContent).toContain('5');
    expect(actions.querySelector('.k-sug-minus')).toBeNull();
  });
});

describe('b-modal-suggestions — filtre et composition', () => {
  it('filtre les sous-catégories par délégation', () => {
    renderSuggestions([
      product({ id: 1, subcategory: 'Sport' }),
      product({ id: 2, subcategory: 'Ville' }),
    ], [], 'Chaussures');
    const sport = Array.from(dom.sugRail.querySelectorAll('.k-sug-chip'))
      .find((chip) => chip.dataset.subcat === 'Sport');
    sport.dispatchEvent(new window.Event('click', { bubbles: true }));
    expect(state.modalSubcatFilter).toBe('Sport');
    expect(dom.sugRail.querySelector('.k-sug-card[data-id="2"]').classList.contains('subcat-hidden')).toBe(true);
  });

  it('desktop déplace la section dans le scroll modal de façon idempotente', () => {
    isDesktop.mockReturnValue(true);
    renderSuggestions([product({ id: 1 })], [], 'Chaussures');
    renderSuggestions([product({ id: 1 })], [], 'Chaussures');
    const scroll = document.querySelector('.k-modal-scroll');
    expect(scroll.querySelectorAll('#k-modal-suggestions')).toHaveLength(1);
    expect(document.getElementById('k-modal-suggestions').classList.contains('k-modal-suggestions--desktop-list')).toBe(true);
  });
});

describe('b-modal-suggestions — teaser #k-modal-sugg-peek activable', () => {
  it('se démasque et scrolle vers #k-modal-suggestions au clic (sans dépendre du contenu enrichi au-dessus)', () => {
    const sugSection = document.getElementById('k-modal-suggestions');
    sugSection.scrollIntoView = jest.fn();

    renderSuggestions([product({ id: 1 })], [], 'Chaussures');
    const peek = document.getElementById('k-modal-sugg-peek');
    expect(peek.hidden).toBe(false);

    peek.dispatchEvent(new window.Event('click', { bubbles: true }));
    expect(sugSection.scrollIntoView).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: 'smooth', block: 'start' })
    );
  });

  it('répond aussi au clavier (Entrée / Espace)', () => {
    const sugSection = document.getElementById('k-modal-suggestions');
    sugSection.scrollIntoView = jest.fn();

    renderSuggestions([product({ id: 1 })], [], 'Chaussures');
    const peek = document.getElementById('k-modal-sugg-peek');

    peek.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(sugSection.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('ne double-bind pas le listener sur des rendus répétés (nœud statique, jamais recréé)', () => {
    const sugSection = document.getElementById('k-modal-suggestions');
    sugSection.scrollIntoView = jest.fn();

    renderSuggestions([product({ id: 1 })], [], 'Chaussures');
    renderSuggestions([product({ id: 1 })], [], 'Chaussures');
    const peek = document.getElementById('k-modal-sugg-peek');

    peek.dispatchEvent(new window.Event('click', { bubbles: true }));
    expect(sugSection.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('se re-masque et ne scrolle plus rien quand il n\'y a aucune suggestion', () => {
    const sugSection = document.getElementById('k-modal-suggestions');
    sugSection.scrollIntoView = jest.fn();

    renderSuggestions([], [], 'Chaussures');
    const peek = document.getElementById('k-modal-sugg-peek');
    expect(peek.hidden).toBe(true);

    peek.dispatchEvent(new window.Event('click', { bubbles: true }));
    expect(sugSection.scrollIntoView).not.toHaveBeenCalled();
  });
});
