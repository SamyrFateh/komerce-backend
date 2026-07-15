'use strict';

/**
 * modal-mobile-desktop-parity.test.js
 *
 * MDP-4 — Test contractuel de parité Mobile/Desktop.
 *
 * Principe : même Product Detail Contract + même modalSelection + même SKU
 * résolu → mêmes informations ET mêmes capacités métier, quelle que soit la
 * composition (b-modal-mobile-product.js vs b-modal-desktop-product.js).
 *
 * Ce test compare le CONTENU MÉTIER (texte, disponibilité, sous-total, modes
 * de paiement) — jamais l'ordre DOM, le layout ou la position des blocs, qui
 * sont autorisés à différer entre les deux compositions.
 */

jest.mock('../../js/b-store.js', () => ({
  state: {},
  dom: {},
  modalZone: jest.fn((selector) => {
    const { dom } = require('../../js/b-store.js');
    return dom.modal ? dom.modal.querySelector(selector) : null;
  }),
}));

jest.mock('../../js/b-utils.js', () => ({
  fmtPrice: (value) => (value == null ? '' : `${value} KMF`),
  optimizeImgUrl: (url) => url,
}));

jest.mock('../../js/b-scroll-owner.js', () => ({
  isDesktop: jest.fn(),
}));

jest.mock('../../js/b-modal-product.js', () => ({
  buildCarouselSlides: jest.fn(),
  goToSlide: jest.fn(),
}));

jest.mock('../../js/b-modal-image-ux.js', () => ({
  setupImageUX: jest.fn(),
}));

jest.mock('../../js/b-modal.js', () => ({ closeModal: jest.fn() }));
jest.mock('../../js/b-cart.js', () => ({ addToCart: jest.fn() }));
jest.mock('../../js/b-share-cart.js', () => ({ startShareFlow: jest.fn() }));

const { state, dom } = require('../../js/b-store.js');
const { isDesktop } = require('../../js/b-scroll-owner.js');
const { createModalSelection, selectModalOption } = require('../../js/view-models/modal-selection-model.js');
const { renderMobileProductDetail } = require('../../js/b-modal-mobile-product.js');
const { renderDesktopProductDetail } = require('../../js/b-modal-desktop-product.js');

const PRODUCT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SKU_MAR_M = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SKU_BEI_L = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function detail() {
  return {
    contract_version: '1',
    inventory_model: 'SKU',
    product: {
      id: PRODUCT_ID,
      reference: 'ROB-001',
      name: 'Robe Dubaï',
      description: 'Robe fluide',
      category: 'vetements',
    },
    pricing: { price_kmf: 12500, old_price_kmf: 15000, promo_pct: 17 },
    media: [
      { id: 'global', url: '/global.jpg', role: 'PRODUCT', alt: 'Robe', option_values: {} },
      { id: 'brown', url: '/brown.jpg', role: 'SCENE', alt: 'Marron', option_values: { Couleur: 'Marron' } },
    ],
    option_axes: [
      {
        key: 'Couleur',
        display_name: 'Couleur',
        values: [
          { value: 'Marron', thumbnail_url: '/brown-thumb.jpg' },
          { value: 'Beige', thumbnail_url: '/beige-thumb.jpg' },
        ],
      },
      {
        key: 'Taille',
        display_name: 'Taille',
        values: [
          { value: 'M', thumbnail_url: null },
          { value: 'L', thumbnail_url: null },
        ],
      },
    ],
    sellable_units: [
      {
        sku_id: SKU_MAR_M,
        sku: 'ROB-MAR-M',
        option_values: { Couleur: 'Marron', Taille: 'M' },
        stock_status: 'AVAILABLE',
        available_quantity: 4,
        price_kmf: 12500,
        media_ids: ['brown'],
      },
      {
        sku_id: SKU_BEI_L,
        sku: 'ROB-BEI-L',
        option_values: { Couleur: 'Beige', Taille: 'L' },
        stock_status: 'AVAILABLE',
        available_quantity: 2,
        price_kmf: 13000,
        media_ids: ['global'],
      },
    ],
    delivery_options: [
      { code: 'SEA_STANDARD', label: 'Livraison standard', available: true, price_kmf: null, eta_label: null, unavailable_reason: null },
    ],
  };
}

function installMobileDom() {
  document.body.innerHTML = `
    <div id="k-modal">
      <div class="k-modal-carousel"><div class="k-modal-carousel-track"></div></div>
      <div id="k-modal-variants"></div>
      <div class="k-modal-actions">
        <button id="k-qty-minus">−</button>
        <span id="k-qty-val">1</span>
        <button id="k-qty-plus">+</button>
        <button id="k-add-cart-btn">Ajouter</button>
        <button id="k-buy-now-btn">Acheter</button>
      </div>
      <h2 id="k-modal-name"></h2>
      <p id="k-modal-desc"></p>
      <span id="k-modal-cat"></span>
      <span id="k-modal-price"></span>
      <span id="k-modal-old-price"></span>
      <span id="k-modal-sku"></span>
      <span id="k-modal-stock"></span>
      <span id="k-modal-promo-badge"></span>
    </div>`;

  dom.modal = document.getElementById('k-modal');
  dom.modalVariants = document.getElementById('k-modal-variants');
  dom.modalName = document.getElementById('k-modal-name');
  dom.modalDesc = document.getElementById('k-modal-desc');
  dom.modalCat = document.getElementById('k-modal-cat');
  dom.modalPrice = document.getElementById('k-modal-price');
  dom.modalOldPrice = document.getElementById('k-modal-old-price');
  dom.modalSku = document.getElementById('k-modal-sku');
  dom.modalStock = document.getElementById('k-modal-stock');
  dom.modalPromoBadge = document.getElementById('k-modal-promo-badge');
  dom.modalQtyVal = document.getElementById('k-qty-val');
  dom.qtyMinus = document.getElementById('k-qty-minus');
  dom.qtyPlus = document.getElementById('k-qty-plus');
  dom.addCartBtn = document.getElementById('k-add-cart-btn');
}

function installDesktopDom() {
  document.body.innerHTML = `
    <div id="k-modal">
      <div class="k-modal-carousel"><div class="k-modal-carousel-track"></div></div>
      <div class="k-modal-info">
        <div id="k-modal-variants"></div>
        <div id="k-modal-delivery"></div>
        <div id="k-modal-payment"></div>
      </div>
      <div class="k-modal-actions">
        <button id="k-qty-minus">−</button>
        <span id="k-qty-val">1</span>
        <button id="k-qty-plus">+</button>
        <button id="k-add-cart-btn">Ajouter</button>
        <button id="k-buy-now-btn">Acheter</button>
      </div>
      <h2 id="k-modal-name"></h2>
      <p id="k-modal-desc"></p>
      <span id="k-modal-cat"></span>
      <span id="k-modal-price"></span>
      <span id="k-modal-old-price"></span>
      <span id="k-modal-sku"></span>
      <span id="k-modal-stock"></span>
      <span id="k-modal-promo-badge"></span>
      <div id="k-modal-aed-price">legacy</div>
      <div id="k-modal-flash-bar">legacy</div>
      <div id="k-modal-stock-bar">legacy</div>
    </div>`;

  dom.modal = document.getElementById('k-modal');
  dom.modalVariants = document.getElementById('k-modal-variants');
  dom.modalName = document.getElementById('k-modal-name');
  dom.modalDesc = document.getElementById('k-modal-desc');
  dom.modalCat = document.getElementById('k-modal-cat');
  dom.modalPrice = document.getElementById('k-modal-price');
  dom.modalOldPrice = document.getElementById('k-modal-old-price');
  dom.modalSku = document.getElementById('k-modal-sku');
  dom.modalStock = document.getElementById('k-modal-stock');
  dom.modalPromoBadge = document.getElementById('k-modal-promo-badge');
  dom.modalQtyVal = document.getElementById('k-qty-val');
  dom.qtyMinus = document.getElementById('k-qty-minus');
  dom.qtyPlus = document.getElementById('k-qty-plus');
  dom.addCartBtn = document.getElementById('k-add-cart-btn');
}

function businessSnapshot() {
  return {
    name: dom.modalName.textContent,
    description: dom.modalDesc.textContent,
    category: dom.modalCat.textContent,
    price: dom.modalPrice.textContent,
    oldPrice: dom.modalOldPrice.textContent,
    promo: dom.modalPromoBadge.textContent,
    reference: dom.modalSku.textContent,
    stock: dom.modalStock.textContent,
    ctaDisabled: dom.addCartBtn.disabled,
    subtotal: document.querySelector('.k-modal-subtotal, .k-modal-subtotal--mobile strong, .k-modal-subtotal strong')?.closest('.k-modal-subtotal, .k-modal-subtotal--mobile')?.textContent || '',
    paymentTabCount: document.querySelectorAll('.k-buybox-payment-tab').length,
    paymentActiveMode: document.querySelector('.k-buybox-payment-tab.is-active')?.dataset.pay,
    deliveryLabel: document.body.textContent.includes('Livraison standard'),
  };
}

describe('Parité métier Mobile/Desktop — même PDC, même sélection, même SKU (MDP-4)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.keys(state).forEach((key) => delete state[key]);
    state.modalQty = 2;
    state.modalPaymentMode = null;
  });

  test('TEST 1 — parité à état fixe : même sous-total, mêmes modes de paiement, même SKU', () => {
    const product = detail();

    // Rendu mobile
    installMobileDom();
    window.matchMedia = jest.fn().mockReturnValue({ matches: true }); // mobile
    isDesktop.mockReturnValue(false);
    let selection = createModalSelection(product);
    selection = selectModalOption(product, selection, 'Couleur', 'Marron');
    selection = selectModalOption(product, selection, 'Taille', 'M');
    renderMobileProductDetail(product, selection);
    const mobileSnapshot = businessSnapshot();

    // Rendu desktop — même produit, même sélection déjà résolue
    installDesktopDom();
    window.matchMedia = jest.fn().mockReturnValue({ matches: false }); // desktop
    isDesktop.mockReturnValue(true);
    renderDesktopProductDetail(product, selection);
    const desktopSnapshot = businessSnapshot();

    expect(selection.selected_sku_id).toBe(SKU_MAR_M);
    expect(mobileSnapshot).toEqual(desktopSnapshot);
    expect(desktopSnapshot.paymentTabCount).toBe(4);
    expect(desktopSnapshot.paymentActiveMode).toBe('stripe');
    expect(desktopSnapshot.subtotal).toContain('25000 KMF'); // 12500 × qty 2
    expect(desktopSnapshot.ctaDisabled).toBe(false);
    expect(desktopSnapshot.deliveryLabel).toBe(true);
  });

  test('TEST 2 — même sélection non résolue (option manquante) : parité de blocage CTA', () => {
    const product = detail();
    let selection = createModalSelection(product);
    selection = selectModalOption(product, selection, 'Couleur', 'Beige');
    // Taille non choisie → aucun SKU résolu

    installMobileDom();
    window.matchMedia = jest.fn().mockReturnValue({ matches: true });
    isDesktop.mockReturnValue(false);
    renderMobileProductDetail(product, selection);
    const mobileSnapshot = businessSnapshot();

    installDesktopDom();
    window.matchMedia = jest.fn().mockReturnValue({ matches: false });
    isDesktop.mockReturnValue(true);
    renderDesktopProductDetail(product, selection);
    const desktopSnapshot = businessSnapshot();

    expect(selection.selected_sku_id).toBeNull();
    expect(mobileSnapshot.ctaDisabled).toBe(true);
    expect(desktopSnapshot.ctaDisabled).toBe(true);
    // Les deux compositions exposent le même sélecteur de paiement même sans SKU résolu.
    expect(mobileSnapshot.paymentTabCount).toBe(4);
    expect(desktopSnapshot.paymentTabCount).toBe(4);
  });

  test('TEST 3 — Beige + L : même prix SKU, même sous-total sur les deux compositions', () => {
    const product = detail();
    let selection = createModalSelection(product);
    selection = selectModalOption(product, selection, 'Couleur', 'Beige');
    selection = selectModalOption(product, selection, 'Taille', 'L');
    expect(selection.selected_sku_id).toBe(SKU_BEI_L);

    installMobileDom();
    window.matchMedia = jest.fn().mockReturnValue({ matches: true });
    isDesktop.mockReturnValue(false);
    renderMobileProductDetail(product, selection);
    expect(dom.modalPrice.textContent).toBe('13000 KMF');
    expect(document.querySelector('.k-modal-subtotal--mobile strong').textContent).toBe('26000 KMF');

    installDesktopDom();
    window.matchMedia = jest.fn().mockReturnValue({ matches: false });
    isDesktop.mockReturnValue(true);
    renderDesktopProductDetail(product, selection);
    expect(dom.modalPrice.textContent).toBe('13000 KMF');
    expect(document.querySelector('.k-modal-subtotal strong').textContent).toBe('26000 KMF');
  });
});
