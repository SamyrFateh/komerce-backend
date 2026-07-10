'use strict';

/**
 * Couverture avancée de b-cart.js.
 *
 * Cible les contrats actifs encore peu exercés : variantes, animation panier,
 * interactions détaillées du drawer, side-cart desktop, édition d'un panier
 * collectif, chargement d'un panier partagé et stepper longue pression.
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
  getCategoryIcon: jest.fn((category) => category === 'Tech' ? '💻' : '📦'),
  normalizeCategoryKey: jest.fn((category) => category),
}));

jest.mock('../../js/b-nav.js', () => ({ switchView: mockSwitchView }));
jest.mock('../../js/b-group-view.js', () => ({ renderGroupView: mockRenderGroupView }));

// Le placeholder adaptatif s'initialise à l'import du module.
document.body.innerHTML = '<input id="k-search-input">';
Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 });

const { state, dom, scroll } = require('../../js/b-store.js');
const { bus } = require('../../js/b-bus.js');
const {
  addToCart,
  renderCartBody,
  loadSharedCart,
} = require('../../js/b-cart.js');

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

function mountDrawerDom() {
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
    dom.cartBody,
    dom.cartFooter,
    dom.cartHeaderTitle,
    dom.cartHeader,
    dom.cartOverlay,
    dom.cartDrawer,
    dom.cartTotalVal,
    dom.cartTotalConv,
    dom.cartBadge,
    dom.addCartBtn,
  );
}

function mountSideCartDom() {
  const sideCart = document.createElement('aside');
  sideCart.id = 'k-side-cart';
  sideCart.innerHTML = `
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
  document.body.append(sideCart, label);
  return sideCart;
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  mountDrawerDom();
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

describe('b-cart — variantes et feedback avancé', () => {
  test('snapshotte la combinaison de variantes et sépare deux variantes du même produit', () => {
    const p = product(7);
    state.modalProduct = p;
    state.modalVariantCombo = { taille: 'M', couleur: 'Bleu' };

    addToCart(p, 2);
    addToCart(p, 1);
    state.modalVariantCombo = { taille: 'L', couleur: 'Bleu' };
    addToCart(p, 1);

    expect(state.cart).toHaveLength(2);
    expect(state.cart[0]).toMatchObject({
      qty: 3,
      variant_combo: { taille: 'M', couleur: 'Bleu' },
      variant_label: 'M / Bleu',
    });
    expect(state.cart[1]).toMatchObject({
      qty: 1,
      variant_combo: { taille: 'L', couleur: 'Bleu' },
      variant_label: 'L / Bleu',
    });
  });

  test('termine l’animation fly-to-cart, nettoie les particules et bump le badge', () => {
    const source = document.createElement('button');
    source.getBoundingClientRect = () => ({ left: 10, top: 20, width: 20, height: 20 });
    dom.cartBtn.getBoundingClientRect = () => ({ left: 200, top: 40, width: 40, height: 40 });
    const timestamps = [1, 901];
    global.requestAnimationFrame = jest.fn((callback) => {
      callback(timestamps.shift() || 901);
      return 1;
    });

    addToCart(product(2, { image_url: '/img/p2.jpg' }), 1, source);
    expect(document.body.querySelectorAll('[style*="z-index: 9998"]')).toHaveLength(6);

    jest.advanceTimersByTime(350);
    expect(dom.cartBadge.classList.contains('bump')).toBe(true);
    jest.advanceTimersByTime(200);

    expect(document.body.querySelectorAll('[style*="z-index: 9998"]')).toHaveLength(0);
    expect(dom.cartBtn.style.transform).toBe('scale(1)');
  });

  test('le bouton modal ouvre le panier mobile après confirmation', () => {
    const emitSpy = jest.spyOn(bus, 'emit');
    addToCart(product(3), 1, dom.addCartBtn);
    jest.advanceTimersByTime(700);

    dom.addCartBtn.click();
    expect(emitSpy).toHaveBeenCalledWith('modal:close');
    jest.advanceTimersByTime(150);

    expect(dom.cartOverlay.classList.contains('open')).toBe(true);
    expect(dom.cartDrawer.classList.contains('open')).toBe(true);
    emitSpy.mockRestore();
  });

  test('le bouton modal desktop recentre le side-cart sans ouvrir le drawer', () => {
    mockIsDesktop.mockReturnValue(true);
    const sideCart = document.createElement('div');
    sideCart.id = 'k-side-cart';
    sideCart.scrollIntoView = jest.fn();
    document.body.appendChild(sideCart);

    addToCart(product(4), 1, dom.addCartBtn);
    jest.advanceTimersByTime(700);
    dom.addCartBtn.click();

    expect(sideCart.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'nearest' });
    expect(dom.cartOverlay.classList.contains('open')).toBe(false);
  });
});

describe('b-cart — drawer et édition collective', () => {
  test('câble image, nom, quantité et suppression sur une ligne panier complète', () => {
    const emitSpy = jest.spyOn(bus, 'emit');
    state.cart = [{ product: product(5, { image_url: '/img/p5.jpg' }), qty: 2 }];
    renderCartBody();

    expect(dom.cartBody.querySelector('img').src).toContain('/img/p5.jpg?w=100');
    expect(dom.cartBody.querySelector('.k-cart-item-unit').textContent).toContain('× 2');

    dom.cartBody.querySelector('.k-cart-item-img').click();
    expect(emitSpy).toHaveBeenCalledWith('modal:open', { id: 5 });

    renderCartBody();
    dom.cartBody.querySelector('.k-cart-item-name').click();
    expect(emitSpy).toHaveBeenCalledTimes(2);

    renderCartBody();
    dom.cartBody.querySelectorAll('.k-qty-btn')[1].click();
    expect(state.cart[0].qty).toBe(3);

    dom.cartBody.querySelectorAll('.k-qty-btn')[0].click();
    expect(state.cart[0].qty).toBe(2);

    dom.cartBody.querySelector('.k-cart-item-remove').click();
    expect(state.cart).toHaveLength(0);
    emitSpy.mockRestore();
  });

  test('le CTA du panier vide ferme le drawer et réactive l’onglet Boutique', () => {
    document.body.classList.add('cart-open');
    dom.cartOverlay.classList.add('open');
    dom.cartDrawer.classList.add('open');

    renderCartBody();
    document.getElementById('k-cart-empty-shop').click();

    expect(document.body.classList.contains('cart-open')).toBe(false);
    expect(document.querySelector('[data-tab="home"]').classList.contains('active')).toBe(false);
    expect(document.querySelector('[data-tab="shop"]').classList.contains('active')).toBe(true);
  });

  test('affiche les compteurs, totaux et masque les CTA classiques en mode édition', () => {
    state.editSharedCart = { shared_cart_id: 'sc-42' };
    state.cart = [{ product: product(6), qty: 2 }];

    renderCartBody();

    expect(document.getElementById('k-cart-item-count').textContent).toBe('2');
    expect(document.getElementById('k-cart-item-plural').textContent).toBe('s');
    expect(document.getElementById('k-cart-subtotal-val').textContent).toBe('12000 KMF');
    expect(document.getElementById('k-cart-checkout').style.display).toBe('none');
    expect(document.getElementById('k-cart-share').style.display).toBe('none');
    expect(document.getElementById('k-cart-clear').style.display).toBe('none');
    expect(document.getElementById('k-cart-edit-bar')).not.toBeNull();
  });

  test('refuse la mise à jour collective si le panier de travail est vide', () => {
    state.editSharedCart = { shared_cart_id: 'sc-empty' };
    state.cart = [{ product: product(8), qty: 1 }];
    renderCartBody();

    state.cart = [];
    document.getElementById('k-cart-edit-update').click();

    expect(document.getElementById('k-cart-edit-err').textContent)
      .toContain('Ajoutez au moins un article');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('met à jour le panier collectif puis revient vers le groupe', async () => {
    state.editSharedCart = { shared_cart_id: 'sc-ok' };
    state.cart = [{ product: product(9), qty: 3 }];
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    renderCartBody();

    document.getElementById('k-cart-edit-update').click();
    await flushPromises();

    expect(global.fetch).toHaveBeenCalledWith('/api/shared-carts/sc-ok/items', expect.objectContaining({
      method: 'PUT',
      credentials: 'include',
    }));
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({
      cart_items: [{ product_id: 9, quantity: 3 }],
    });
    expect(state.editSharedCart).toBeNull();
    expect(state.cart).toHaveLength(0);
    expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining('mis à jour'), 'success');
    await flushPromises();
    expect(mockSwitchView).toHaveBeenCalledWith('group');
    expect(mockRenderGroupView).toHaveBeenCalled();
  });

  test('réaffiche le bouton et l’erreur serveur si la mise à jour échoue', async () => {
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
    await flushPromises();

    expect(document.getElementById('k-cart-edit-err').textContent).toBe('Panier fermé');
    expect(update.disabled).toBe(false);
    expect(update.textContent).toContain('Mettre à jour');
  });

  test('annule l’édition collective après confirmation sans vider le panier', async () => {
    state.editSharedCart = { shared_cart_id: 'sc-cancel' };
    state.cart = [{ product: product(11), qty: 1 }];
    renderCartBody();

    document.getElementById('k-cart-edit-cancel').click();
    await flushPromises();

    expect(global.confirm).toHaveBeenCalled();
    expect(state.editSharedCart).toBeNull();
    expect(state.cart).toHaveLength(1);
    expect(mockShowToast).toHaveBeenCalledWith('Modifications annulées.', 'success');
    expect(mockSwitchView).toHaveBeenCalledWith('group');
  });
});

describe('b-cart — side-cart desktop', () => {
  test('rend les articles récents, promo, variante, total et label mobile', () => {
    const sc = mountSideCartDom();
    state.cart = [
      { product: product(1), qty: 1 },
      {
        product: product(2, { image_url: '/img/p2.jpg', promo_pct: 20 }),
        qty: 2,
        variant_label: 'Rouge / XL',
      },
    ];

    bus.emit('side-cart:render');

    expect(sc.classList.contains('has-items')).toBe(true);
    expect(document.body.classList.contains('sc-reserve')).toBe(true);
    expect(document.getElementById('k-bnav-cart-label').textContent).toBe('9000 KMF');
    expect(document.getElementById('k-sc-total').textContent).toBe('9000 KMF');
    expect(document.getElementById('k-sc-count-inline').textContent).toBe('3');
    const rows = sc.querySelectorAll('.k-sc-item');
    expect(rows).toHaveLength(2);
    expect(rows[0].dataset.pid).toBe('2');
    expect(rows[0].textContent).toContain('Rouge / XL');
    expect(rows[0].querySelector('.k-sc-item-old-price')).not.toBeNull();
  });

  test('les steppers side-cart ajoutent, retirent et suppriment via la mutation centrale', () => {
    const sc = mountSideCartDom();
    state.cart = [{ product: product(12), qty: 2 }];
    bus.emit('side-cart:render');

    sc.querySelector('.k-sc-step-plus').click();
    expect(state.cart[0].qty).toBe(3);

    bus.emit('side-cart:render');
    sc.querySelector('.k-sc-step-minus').click();
    expect(state.cart[0].qty).toBe(2);

    bus.emit('side-cart:render');
    sc.querySelector('.k-sc-item-remove').click();
    expect(state.cart).toHaveLength(0);
  });

  test('Voir le panier ouvre le drawer, Commander émet checkout et Vider respecte la confirmation', () => {
    const sc = mountSideCartDom();
    state.cart = [{ product: product(13), qty: 1 }];
    mockGetScrollY.mockReturnValue(345);
    const emitSpy = jest.spyOn(bus, 'emit');
    bus.emit('side-cart:render');

    sc.querySelector('#k-sc-cta').click();
    expect(dom.cartOverlay.classList.contains('open')).toBe(true);
    expect(scroll.savedY).toBe(345);

    sc.querySelector('#k-sc-checkout').click();
    expect(emitSpy).toHaveBeenCalledWith('checkout:open');

    window.confirm.mockReturnValueOnce(false);
    sc.querySelector('#k-sc-clear').click();
    expect(state.cart).toHaveLength(1);

    window.confirm.mockReturnValueOnce(true);
    sc.querySelector('#k-sc-clear').click();
    expect(state.cart).toHaveLength(0);
    expect(mockShowToast).toHaveBeenCalledWith('🗑 Panier vidé');
    emitSpy.mockRestore();
  });

  test('un panier vide nettoie le side-cart et restaure le libellé Panier', () => {
    const sc = mountSideCartDom();
    sc.querySelector('#k-sc-items').innerHTML = '<div>fantôme</div>';
    state.cart = [];

    bus.emit('side-cart:render');

    expect(sc.classList.contains('has-items')).toBe(false);
    expect(document.body.classList.contains('sc-reserve')).toBe(false);
    expect(sc.querySelector('#k-sc-items').innerHTML).toBe('');
    expect(document.getElementById('k-bnav-cart-label').textContent).toBe('Panier');
  });
});

describe('b-cart — chargement de paniers partagés', () => {
  test('charge le format legacy ?cart=, ouvre le drawer mobile et nettoie l’URL', () => {
    window.history.replaceState({}, '', '/boutique?cart=21:2,22:1');
    state.products = [product('21'), product('22')];

    loadSharedCart();
    jest.advanceTimersByTime(200);
    jest.advanceTimersByTime(500);

    expect(state.cart).toHaveLength(2);
    expect(state.cart[0].qty).toBe(2);
    expect(mockSaveCart).toHaveBeenCalled();
    expect(dom.cartDrawer.classList.contains('open')).toBe(true);
    expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining('2 article'), 'success');
    expect(window.location.search).toBe('');
  });

  test('charge ?share= via API et personnalise le titre avec le partageur', async () => {
    window.history.replaceState({}, '', '/boutique?share=tok-abc');
    state.products = [product('31')];
    mockApiGet.mockResolvedValue({
      sharer_name: 'Amina',
      items: [{ product_id: '31', qty: 4 }],
    });

    loadSharedCart();
    await flushPromises();
    jest.advanceTimersByTime(200);
    jest.advanceTimersByTime(500);

    expect(state.shareToken).toBe('tok-abc');
    expect(mockApiGet).toHaveBeenCalledWith('/api/shares/tok-abc');
    expect(state.cart[0].qty).toBe(4);
    expect(dom.cartHeaderTitle.textContent).toBe('🎁 Panier de Amina');
    expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining('Amina'), 'success');
  });

  test('signale proprement une erreur API de panier partagé', async () => {
    window.history.replaceState({}, '', '/boutique?share=bad-token');
    mockApiGet.mockRejectedValue(new Error('réseau'));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    loadSharedCart();
    await flushPromises();

    expect(mockShowToast).toHaveBeenCalledWith('Impossible de charger le panier partagé.', 'error');
    warnSpy.mockRestore();
  });
});

describe('b-cart — stepper longue pression et placeholder', () => {
  test('ouvre le stepper après 400 ms, émet les changements et se ferme au clic extérieur', () => {
    const btn = document.createElement('button');
    btn.className = 'k-card-add in-cart';
    btn.dataset.add = '41';
    document.body.appendChild(btn);
    state.cart = [{ product: product('41'), qty: 2 }];
    const events = [];
    document.addEventListener('cart:setqty', (event) => events.push(event.detail), { once: false });

    btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    jest.advanceTimersByTime(400);

    expect(btn.classList.contains('stepper-open')).toBe(true);
    expect(btn.querySelector('.k-stepper-qty').textContent).toBe('2');

    btn.querySelector('.k-stepper-plus').click();
    expect(events).toContainEqual({ pid: '41', qty: 3 });

    btn.querySelector('.k-stepper-minus').click();
    expect(events).toContainEqual({ pid: '41', qty: 1 });

    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    jest.advanceTimersByTime(250);
    expect(btn.classList.contains('stepper-open')).toBe(false);
    expect(btn.querySelector('.k-card-add-stepper')).toBeNull();
  });

  test('adapte le placeholder aux trois largeurs', () => {
    const input = document.getElementById('k-search-input');

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 });
    window.dispatchEvent(new Event('resize'));
    expect(input.placeholder).toBe('Rechercher...');

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 600 });
    window.dispatchEvent(new Event('resize'));
    expect(input.placeholder).toBe('Rechercher un produit...');

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 });
    window.dispatchEvent(new Event('resize'));
    expect(input.placeholder).toBe('Rechercher un produit dans le catalogue...');
  });
});
