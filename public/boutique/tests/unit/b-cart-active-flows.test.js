'use strict';

/**
 * Couverture des flux actifs avancés de b-cart.js : variantes, drawer,
 * side-cart, édition collective, partage reçu et longue pression.
 */

const mockScrollToCategorySection = jest.fn();
const mockShowToast = jest.fn();
const mockUpdateCartBadge = jest.fn();
const mockSaveCart = jest.fn();
const mockCartQty = jest.fn(() => 0);
const mockCartTotal = jest.fn(() => 0);
const mockSaveFavs = jest.fn();
const mockIsDesktop = jest.fn(() => false);
const mockGetScrollY = jest.fn(() => 0);
const mockScrollToPosition = jest.fn();
const mockApiGet = jest.fn();
const mockApiPost = jest.fn();
const mockSwitchView = jest.fn();
const mockRenderGroupView = jest.fn();

jest.mock('../../js/b-catalog.js', () => ({
  scrollToCategorySection: mockScrollToCategorySection,
}));

jest.mock('../../js/b-utils.js', () => ({
  sanitize: jest.fn((value) => String(value == null ? '' : value)),
  fmt: jest.fn((value, currency) => `${value} ${currency || 'KMF'}`),
  fmtPrice: jest.fn((value) => `${value} KMF`),
  optimizeImgUrl: jest.fn((url, width) => `${url}?w=${width}`),
  productEmoji: jest.fn(() => '📦'),
  _currency: 'KMF',
  apiGet: mockApiGet,
  apiPost: mockApiPost,
}));

jest.mock('../../js/b-cart-core.js', () => ({
  showToast: mockShowToast,
  updateCartBadge: mockUpdateCartBadge,
  saveCart: mockSaveCart,
  cartQty: mockCartQty,
  cartTotal: mockCartTotal,
  saveFavs: mockSaveFavs,
}));

jest.mock('../../js/b-scroll-owner.js', () => ({
  isDesktop: mockIsDesktop,
  getScrollY: mockGetScrollY,
  scrollToPosition: mockScrollToPosition,
}));

jest.mock('../../js/shop-schema.js', () => ({
  getCategoryIcon: jest.fn(() => '💻'),
  normalizeCategoryKey: jest.fn((category) => category),
}));

jest.mock('../../js/b-nav.js', () => ({ switchView: mockSwitchView }));
jest.mock('../../js/b-group-view.js', () => ({ renderGroupView: mockRenderGroupView }));

document.body.innerHTML = '<input id="k-search-input">';
Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 });

const { state, dom, scroll } = require('../../js/b-store.js');
const { bus } = require('../../js/b-bus.js');
const { addToCart, renderCartBody, loadSharedCart } = require('../../js/b-cart.js');

function product(id, overrides = {}) {
  return {
    id,
    name: `Produit ${id}`,
    category: 'Tech',
    price_kmf: 1000 * Number(id || 1),
    image_url: '',
    promo_pct: 0,
    ...overrides,
  };
}

function mountDrawer() {
  document.body.innerHTML = `
    <input id="k-search-input">
    <div id="k-cart-btn"></div>
    <div id="k-modal-cart-btn"></div>
    <div id="k-cart-item-count"></div>
    <div id="k-cart-item-plural"></div>
    <div id="k-cart-subtotal-val"></div>
    <button id="k-cart-checkout"></button>
    <button id="k-cart-share"></button>
    <button id="k-cart-clear"></button>
    <div class="k-cart-footer-btns"></div>
    <button class="k-bnav-item active" data-tab="home"></button>
    <button class="k-bnav-item" data-tab="shop"></button>
    <button class="k-bnav-item" data-tab="group"></button>
    <button class="k-header-nav-btn" data-tab="group"></button>
  `;
  dom.cartBody = document.createElement('div');
  dom.cartFooter = document.createElement('div');
  dom.cartHeaderTitle = document.createElement('div');
  dom.cartHeader = document.createElement('div');
  dom.cartOverlay = document.createElement('div');
  dom.cartDrawer = document.createElement('div');
  dom.cartTotalVal = document.createElement('div');
  dom.cartTotalConv = document.createElement('div');
  dom.cartBtn = document.getElementById('k-cart-btn');
  dom.cartBadge = document.createElement('span');
  dom.addCartBtn = document.createElement('button');
  document.body.append(
    dom.cartBody, dom.cartFooter, dom.cartHeaderTitle, dom.cartHeader,
    dom.cartOverlay, dom.cartDrawer, dom.cartTotalVal, dom.cartTotalConv,
    dom.cartBadge, dom.addCartBtn,
  );
}

function mountSideCart() {
  const sc = document.createElement('aside');
  sc.id = 'k-side-cart';
  sc.innerHTML = `
    <div class="k-sc-header"></div>
    <div id="k-sc-total"></div>
    <span id="k-sc-count-inline"></span>
    <div id="k-sc-items"></div>
    <button id="k-sc-cta"></button>
    <button id="k-sc-checkout"></button>
    <button id="k-sc-share"></button>
    <span id="k-sc-shared-badge"></span>
    <button id="k-sc-clear"></button>
  `;
  const label = document.createElement('span');
  label.id = 'k-bnav-cart-label';
  document.body.append(sc, label);
  return sc;
}

async function settleAsync() {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  mountDrawer();
  state.cart = [];
  state.products = [];
  state.favs = [];
  state.activeCat = 'all';
  state.activeSubcat = null;
  state.modalProduct = null;
  state.modalVariantCombo = null;
  state.editSharedCart = null;
  state.shareToken = null;
  scroll.savedY = 0;
  mockIsDesktop.mockReturnValue(false);
  mockGetScrollY.mockReturnValue(0);
  mockCartQty.mockImplementation(() => state.cart.reduce((sum, item) => sum + item.qty, 0));
  mockCartTotal.mockImplementation(() => state.cart.reduce(
    (sum, item) => sum + (item.product.price_kmf || 0) * item.qty,
    0,
  ));
  global.fetch = jest.fn();
  global.confirm = jest.fn(() => true);
  window.confirm = global.confirm;
  window.history.replaceState({}, '', '/boutique');
  Element.prototype.scrollIntoView = jest.fn();
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

test('sépare les variantes du même produit et incrémente une combinaison identique', () => {
  const p = product(7);
  state.modalProduct = p;
  state.modalVariantCombo = { taille: 'M', couleur: 'Bleu' };
  addToCart(p, 2);
  addToCart(p, 1);
  state.modalVariantCombo = { taille: 'L', couleur: 'Bleu' };
  addToCart(p, 1);

  expect(state.cart).toHaveLength(2);
  expect(state.cart[0]).toMatchObject({ qty: 3, variant_label: 'M / Bleu' });
  expect(state.cart[1]).toMatchObject({ qty: 1, variant_label: 'L / Bleu' });
});

test('termine l’animation fly-to-cart et nettoie ses particules', () => {
  const source = document.createElement('button');
  source.getBoundingClientRect = () => ({ left: 10, top: 20, width: 20, height: 20 });
  dom.cartBtn.getBoundingClientRect = () => ({ left: 200, top: 40, width: 40, height: 40 });
  // P1-fix (audit desktop 2026-07) : durée de vol 900ms → 500ms, pour que la
  // particule libère la zone actions plus vite (owner : b-cart.js::flyToCart).
  const timestamps = [1, 501];
  global.requestAnimationFrame = jest.fn((callback) => {
    callback(timestamps.shift() || 501);
    return 1;
  });

  addToCart(product(2, { image_url: '/img/p2.jpg' }), 1, source);
  expect(document.body.querySelectorAll('[style*="z-index: 9998"]')).toHaveLength(6);
  // Décollage : 350ms → 150ms.
  jest.advanceTimersByTime(150);
  expect(dom.cartBadge.classList.contains('bump')).toBe(true);
  // Nettoyage post-impact : 200ms → 120ms.
  jest.advanceTimersByTime(120);
  expect(document.body.querySelectorAll('[style*="z-index: 9998"]')).toHaveLength(0);
  // Verrouille aussi la classe stable utilisée par les oracles Playwright
  // (assertNoOverlayOnActions) : l'élément doit être identifiable et
  // effectivement retiré du DOM après nettoyage.
  expect(document.body.querySelectorAll('.k-fly-particle')).toHaveLength(0);
});

test('le bouton modal ouvre le drawer mobile et recentre le side-cart desktop', () => {
  const emitSpy = jest.spyOn(bus, 'emit');
  addToCart(product(3), 1, dom.addCartBtn);
  jest.advanceTimersByTime(700);
  dom.addCartBtn.click();
  jest.advanceTimersByTime(150);
  expect(emitSpy).toHaveBeenCalledWith('modal:close');
  expect(dom.cartOverlay.classList.contains('open')).toBe(true);

  mountDrawer();
  mockIsDesktop.mockReturnValue(true);
  const sc = document.createElement('div');
  sc.id = 'k-side-cart';
  sc.scrollIntoView = jest.fn();
  document.body.appendChild(sc);
  addToCart(product(4), 1, dom.addCartBtn);
  jest.advanceTimersByTime(700);
  dom.addCartBtn.click();
  expect(sc.scrollIntoView).toHaveBeenCalled();
  emitSpy.mockRestore();
});

test('câble image, nom, quantité et suppression dans le drawer', () => {
  const emitSpy = jest.spyOn(bus, 'emit');
  state.cart = [{ product: product(5, { image_url: '/img/p5.jpg' }), qty: 2 }];
  renderCartBody();
  expect(dom.cartBody.querySelector('.k-cart-item-unit').textContent).toContain('× 2');
  dom.cartBody.querySelector('.k-cart-item-img').click();
  expect(emitSpy).toHaveBeenCalledWith('modal:open', { id: 5 });

  renderCartBody();
  dom.cartBody.querySelectorAll('.k-qty-btn')[1].click();
  expect(state.cart[0].qty).toBe(3);
  dom.cartBody.querySelectorAll('.k-qty-btn')[0].click();
  expect(state.cart[0].qty).toBe(2);
  dom.cartBody.querySelector('.k-cart-item-remove').click();
  expect(state.cart).toHaveLength(0);
  emitSpy.mockRestore();
});

test('le CTA vide ferme le drawer et réactive la boutique', () => {
  document.body.classList.add('cart-open');
  dom.cartOverlay.classList.add('open');
  dom.cartDrawer.classList.add('open');
  renderCartBody();
  document.getElementById('k-cart-empty-shop').click();
  expect(document.body.classList.contains('cart-open')).toBe(false);
  expect(document.querySelector('[data-tab="shop"]').classList.contains('active')).toBe(true);
});

test('le mode édition masque les CTA et refuse un panier de travail vide', () => {
  state.editSharedCart = { shared_cart_id: 'sc-empty' };
  state.cart = [{ product: product(8), qty: 2 }];
  renderCartBody();
  expect(document.getElementById('k-cart-checkout').style.display).toBe('none');
  expect(document.getElementById('k-cart-share').style.display).toBe('none');
  expect(document.getElementById('k-cart-item-count').textContent).toBe('2');

  state.cart = [];
  document.getElementById('k-cart-edit-update').click();
  expect(document.getElementById('k-cart-edit-err').textContent)
    .toContain('Ajoutez au moins un article');
});

test('met à jour un panier collectif puis revient vers Groupe', async () => {
  state.editSharedCart = { shared_cart_id: 'sc-ok' };
  state.cart = [{ product: product(9), qty: 3 }];
  global.fetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  renderCartBody();
  document.getElementById('k-cart-edit-update').click();
  await settleAsync();

  expect(global.fetch).toHaveBeenCalledWith('/api/shared-carts/sc-ok/items', expect.objectContaining({
    method: 'PUT', credentials: 'include',
  }));
  expect(state.editSharedCart).toBeNull();
  expect(state.cart).toHaveLength(0);
  await settleAsync();
  expect(mockSwitchView).toHaveBeenCalledWith('group');
  expect(mockRenderGroupView).toHaveBeenCalled();
});

test('affiche l’erreur serveur et réactive le bouton de mise à jour', async () => {
  state.editSharedCart = { shared_cart_id: 'sc-ko' };
  state.cart = [{ product: product(10), qty: 1 }];
  global.fetch.mockResolvedValue({
    ok: false,
    status: 409,
    json: async () => ({ error: 'Panier fermé' }),
  });
  renderCartBody();
  const update = document.getElementById('k-cart-edit-update');
  update.click();
  await settleAsync();

  expect(document.getElementById('k-cart-edit-err').textContent).toBe('Panier fermé');
  expect(update.disabled).toBe(false);
});

test('annule l’édition sans vider le panier', async () => {
  state.editSharedCart = { shared_cart_id: 'sc-cancel' };
  state.cart = [{ product: product(11), qty: 1 }];
  renderCartBody();
  document.getElementById('k-cart-edit-cancel').click();
  await settleAsync();
  expect(state.editSharedCart).toBeNull();
  expect(state.cart).toHaveLength(1);
  expect(mockSwitchView).toHaveBeenCalledWith('group');
});

test('rend le side-cart, sa promo, sa variante et ses mutations', () => {
  const sc = mountSideCart();
  state.cart = [
    { product: product(1), qty: 1 },
    { product: product(2, { image_url: '/img/p2.jpg', promo_pct: 20 }), qty: 2, variant_label: 'Rouge / XL' },
  ];
  bus.emit('side-cart:render');

  expect(document.getElementById('k-bnav-cart-label').textContent).toBe('5000 KMF');
  expect(sc.querySelectorAll('.k-sc-item')).toHaveLength(2);
  expect(sc.querySelector('.k-sc-item').textContent).toContain('Rouge / XL');
  expect(sc.querySelector('.k-sc-item-old-price')).not.toBeNull();

  sc.querySelector('.k-sc-step-plus').click();
  expect(state.cart[1].qty).toBe(3);
  bus.emit('side-cart:render');
  sc.querySelector('.k-sc-item-remove').click();
  expect(state.cart).toHaveLength(1);
});

test('side-cart : Voir, Commander, Vider et état vide', () => {
  const sc = mountSideCart();
  state.cart = [{ product: product(13), qty: 1 }];
  mockGetScrollY.mockReturnValue(345);
  const emitSpy = jest.spyOn(bus, 'emit');
  bus.emit('side-cart:render');
  sc.querySelector('#k-sc-cta').click();
  expect(scroll.savedY).toBe(345);
  sc.querySelector('#k-sc-checkout').click();
  expect(emitSpy).toHaveBeenCalledWith('checkout:open');

  window.confirm.mockReturnValueOnce(false);
  sc.querySelector('#k-sc-clear').click();
  expect(state.cart).toHaveLength(1);
  window.confirm.mockReturnValueOnce(true);
  sc.querySelector('#k-sc-clear').click();
  expect(state.cart).toHaveLength(0);
  bus.emit('side-cart:render');
  expect(document.getElementById('k-bnav-cart-label').textContent).toBe('Panier');
  emitSpy.mockRestore();
});

test('charge un panier legacy puis un panier API personnalisé', async () => {
  window.history.replaceState({}, '', '/boutique?cart=21:2,22:1');
  state.products = [product('21'), product('22')];
  loadSharedCart();
  jest.advanceTimersByTime(200);
  jest.advanceTimersByTime(500);
  expect(state.cart).toHaveLength(2);
  expect(dom.cartDrawer.classList.contains('open')).toBe(true);

  mountDrawer();
  state.cart = [];
  state.products = [product('31')];
  window.history.replaceState({}, '', '/boutique?share=tok-abc');
  mockApiGet.mockResolvedValue({ sharer_name: 'Amina', items: [{ product_id: '31', qty: 4 }] });
  loadSharedCart();
  await settleAsync();
  jest.advanceTimersByTime(200);
  jest.advanceTimersByTime(500);
  expect(state.shareToken).toBe('tok-abc');
  expect(state.cart[0].qty).toBe(4);
  expect(dom.cartHeaderTitle.textContent).toBe('🎁 Panier de Amina');
});

test('signale une erreur API de panier partagé', async () => {
  window.history.replaceState({}, '', '/boutique?share=bad-token');
  mockApiGet.mockRejectedValue(new Error('réseau'));
  const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  loadSharedCart();
  await settleAsync();
  expect(mockShowToast).toHaveBeenCalledWith('Impossible de charger le panier partagé.', 'error');
  warnSpy.mockRestore();
});

test('ignore l’appui long historique et adapte le placeholder', () => {
  const control = document.createElement('div');
  control.className = 'k-card-add in-cart';
  control.dataset.add = '41';
  control.innerHTML = '<button type="button" data-action="increment">+</button>';
  document.body.appendChild(control);
  state.cart = [{ product: product('41'), qty: 2 }];

  control.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  jest.advanceTimersByTime(400);
  expect(control.classList.contains('stepper-open')).toBe(false);
  expect(control.querySelector('.k-card-add-stepper')).toBeNull();

  const input = document.getElementById('k-search-input');
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 });
  window.dispatchEvent(new Event('resize'));
  expect(input.placeholder).toBe('Rechercher...');
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 600 });
  window.dispatchEvent(new Event('resize'));
  expect(input.placeholder).toBe('Rechercher un produit...');
});
