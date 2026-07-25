'use strict';

/**
 * tests/unit/shipping-mode-pill.test.js
 *
 * Oracle §6.3 — mode de livraison résumé (air/sea), dérivé de
 * detail.delivery_options[].code (préfixes AIR_/SEA_), zéro valeur en dur.
 *
 * Couvre :
 *   - js/view-models/delivery-mode-model.js (unité pure)
 *   - Desktop : pill résumé au-dessus de la liste détaillée (k-modal-delivery)
 *   - Mobile  : accent visuel k-mdm-chip--air sur le chip livraison concerné
 *   - Fallback sea quand delivery_options est vide ou sans option dispo
 */

const { deriveDeliveryMode } = require('../../js/view-models/delivery-mode-model.js');

describe('delivery-mode-model — deriveDeliveryMode (unité)', () => {
  test('AIR_ disponible → mode air, lead_time_label depuis eta_label', () => {
    const result = deriveDeliveryMode([
      { code: 'SEA_STANDARD', available: true, eta_label: '3 à 5 semaines' },
      { code: 'AIR_EXPRESS', available: true, eta_label: 'Sous 5 jours' },
    ]);
    expect(result).toEqual({ mode: 'air', label: 'Livraison aérienne', lead_time_label: 'Sous 5 jours' });
  });

  test('AIR_ présent mais indisponible → retombe sur sea', () => {
    const result = deriveDeliveryMode([
      { code: 'SEA_STANDARD', available: true, eta_label: '3 à 5 semaines' },
      { code: 'AIR_EXPRESS', available: false, eta_label: 'Sous 5 jours' },
    ]);
    expect(result).toEqual({ mode: 'sea', label: 'Livraison maritime', lead_time_label: '3 à 5 semaines' });
  });

  test('delivery_options vide → fallback sea neutre, pas de faux délai', () => {
    expect(deriveDeliveryMode([])).toEqual({ mode: 'sea', label: 'Livraison', lead_time_label: null });
    expect(deriveDeliveryMode(undefined)).toEqual({ mode: 'sea', label: 'Livraison', lead_time_label: null });
  });

  test('codes hors convention AIR_/SEA_ → fallback sea neutre', () => {
    expect(deriveDeliveryMode([{ code: 'RELAY_POINT', available: true }]))
      .toEqual({ mode: 'sea', label: 'Livraison', lead_time_label: null });
  });
});

describe('shipping-mode-pill — desktop (k-modal-delivery)', () => {
  jest.mock('../../js/b-store.js', () => ({
    state: {},
    dom: {},
    modalZone: jest.fn((selector) => {
      const { dom } = require('../../js/b-store.js');
      return dom.modal ? dom.modal.querySelector(selector) : null;
    }),
    getRequestedTransportRail: jest.fn(() => {
      const { state } = require('../../js/b-store.js');
      return state.modalDeliverySelection?.requested_transport_rail ?? null;
    }),
  }));
  jest.mock('../../js/b-utils.js', () => ({
    fmtPrice: (value) => (value == null ? '' : `${value} KMF`),
    optimizeImgUrl: (url) => url,
  }));
  jest.mock('../../js/b-scroll-owner.js', () => ({ isDesktop: jest.fn(() => true) }));
  jest.mock('../../js/b-modal-product.js', () => ({ buildCarouselSlides: jest.fn(), goToSlide: jest.fn() }));
  jest.mock('../../js/b-modal-image-ux.js', () => ({ setupImageUX: jest.fn() }));
  jest.mock('../../js/b-modal.js', () => ({ closeModal: jest.fn() }));
  jest.mock('../../js/b-cart.js', () => ({ addToCart: jest.fn() }));
  jest.mock('../../js/b-share-cart.js', () => ({ startShareFlow: jest.fn() }));

  const { state, dom } = require('../../js/b-store.js');
  const { createModalSelection } = require('../../js/view-models/modal-selection-model.js');
  const { renderDesktopProductDetail, clearDesktopProductDetailState } = require('../../js/b-modal-desktop-product.js');

  function detail(overrides = {}) {
    return Object.assign({
      contract_version: '1',
      inventory_model: 'LEGACY_VARIANTS',
      product: { id: 'p1', reference: 'REF-1', name: 'Sac raphia', description: '', category: '' },
      pricing: { price_kmf: 10000, old_price_kmf: null, promo_pct: 0 },
      media: [],
      option_axes: [],
      sellable_units: [],
      delivery_options: [],
    }, overrides);
  }

  function installDom() {
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
        <div id="k-modal-aed-price"></div>
        <div id="k-modal-flash-bar"></div>
        <div id="k-modal-stock-bar"></div>
        <div id="k-modal-enriched-content" hidden></div>
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

  beforeEach(() => {
    clearDesktopProductDetailState();
    jest.clearAllMocks();
    installDom();
    Object.keys(state).forEach((key) => delete state[key]);
    state.modalQty = 1;
  });

  afterAll(() => {
    clearDesktopProductDetailState();
  });

  test('AIR_ dispo → sélecteur Maritime/Express visible, bouton air présent, aucun rail présélectionné', () => {
    const product = detail({
      delivery_options: [
        { code: 'SEA_STANDARD', label: 'Livraison standard', available: true, price_kmf: null, eta_label: null },
        { code: 'AIR_EXPRESS', label: 'Livraison express', available: true, price_kmf: 2500, eta_label: 'Sous 5 jours' },
      ],
    });
    renderDesktopProductDetail(product, createModalSelection(product));

    // Deux modes disponibles → sélecteur (pas de pill, pas de liste détaillée)
    const selector = document.querySelector('#k-modal-delivery .k-dsel-wrap');
    expect(selector).not.toBeNull();
    const airBtn = selector.querySelector('.k-dsel-btn[data-rail="AIR_EXPRESS"]');
    expect(airBtn).not.toBeNull();
    const seaBtn = selector.querySelector('.k-dsel-btn[data-rail="SEA_STANDARD"]');
    expect(seaBtn).not.toBeNull();
    // Aucun rail présélectionné : afficher plusieurs options n'est jamais une
    // demande explicite du client (doctrine transport-rails §4, ajustement #1).
    expect(seaBtn.classList.contains('is-selected')).toBe(false);
    expect(airBtn.classList.contains('is-selected')).toBe(false);
    expect(seaBtn.getAttribute('aria-checked')).toBe('false');
    expect(airBtn.getAttribute('aria-checked')).toBe('false');
    expect(document.querySelector('[data-delivery-code]')).toBeNull();
  });

  test('clic sur un bouton du sélecteur → sélectionne ce rail et déclare le choix dans state.modalDeliverySelection', () => {
    const product = detail({
      delivery_options: [
        { code: 'SEA_STANDARD', label: 'Livraison standard', available: true, price_kmf: null, eta_label: null },
        { code: 'AIR_EXPRESS', label: 'Livraison express', available: true, price_kmf: 2500, eta_label: 'Sous 5 jours' },
      ],
    });
    renderDesktopProductDetail(product, createModalSelection(product));

    const selector = document.querySelector('#k-modal-delivery .k-dsel-wrap');
    const airBtn = selector.querySelector('.k-dsel-btn[data-rail="AIR_EXPRESS"]');
    airBtn.click();

    expect(state.modalDeliverySelection.requested_transport_rail).toBe('AIR_EXPRESS');
    expect(airBtn.classList.contains('is-selected')).toBe(true);
    expect(airBtn.getAttribute('aria-checked')).toBe('true');
    const seaBtn = selector.querySelector('.k-dsel-btn[data-rail="SEA_STANDARD"]');
    expect(seaBtn.classList.contains('is-selected')).toBe(false);
  });

  test('uniquement SEA_ → pill --sea, pas de mode air affiché', () => {
    const product = detail({
      delivery_options: [
        { code: 'SEA_STANDARD', label: 'Livraison standard', available: true, price_kmf: null, eta_label: '3 à 5 semaines' },
      ],
    });
    renderDesktopProductDetail(product, createModalSelection(product));

    const pill = document.querySelector('#k-modal-delivery .k-modal-delivery-pill');
    expect(pill.classList.contains('k-modal-delivery-pill--sea')).toBe(true);
    expect(pill.classList.contains('k-modal-delivery-pill--air')).toBe(false);
  });

  test('delivery_options vide → pill fallback sea, message "communiquée à la commande" toujours présent', () => {
    const product = detail({ delivery_options: [] });
    renderDesktopProductDetail(product, createModalSelection(product));

    const pill = document.querySelector('#k-modal-delivery .k-modal-delivery-pill');
    expect(pill.classList.contains('k-modal-delivery-pill--sea')).toBe(true);
    // Pill seule — pas de message texte fallback (maquettes validées 2026-07)
    expect(document.querySelector('[data-delivery-code]')).toBeNull();
  });
});

describe('shipping-mode-pill — mobile (chip k-mdm-chip--air)', () => {
  jest.mock('../../js/b-store.js', () => ({ state: {}, dom: {} }));
  jest.mock('../../js/b-utils.js', () => ({
    fmtPrice: jest.fn((n) => String(n) + ' KMF'),
    optimizeImgUrl: jest.fn((url) => url),
  }));
  jest.mock('../../js/view-models/modal-selection-model.js', () => ({
    OPTION_STATE: { AVAILABLE: 'AVAILABLE', OUT_OF_STOCK: 'OUT_OF_STOCK', INCOMPATIBLE: 'INCOMPATIBLE' },
    selectModalOption: jest.fn(),
  }));
  jest.mock('../../js/b-modal-product.js', () => ({ buildCarouselSlides: jest.fn(), goToSlide: jest.fn() }));
  jest.mock('../../js/b-modal-image-ux.js', () => ({ setupImageUX: jest.fn() }));
  jest.mock('../../js/b-modal.js', () => ({ closeModal: jest.fn() }));
  jest.mock('../../js/b-cart.js', () => ({ addToCart: jest.fn() }));
  jest.mock('../../js/b-share-cart.js', () => ({ startShareFlow: jest.fn() }));

  const { state, dom } = require('../../js/b-store.js');
  const { renderMobileProductDetail } = require('../../js/b-modal-mobile-product.js');

  function baseDetail(overrides) {
    return Object.assign({
      contract_version: '1',
      product: { id: 'p1', name: 'Robe', description: '', category: '' },
      pricing: { price_kmf: 5000, promo_pct: 0, old_price_kmf: null },
      media: [],
      option_axes: [],
      sellable_units: [],
      delivery_options: [],
    }, overrides);
  }

  function baseSelection(overrides) {
    return Object.assign({
      selection_supported: false,
      selected_options: {},
      selected_sku_id: null,
      selected_media: [],
      option_states: {},
      selection_message: null,
    }, overrides);
  }

  function installDom() {
    document.body.innerHTML =
      '<div id="k-modal">' +
        '<div id="k-modal-variants"></div>' +
        '<span class="k-modal-sku" id="k-modal-sku"></span>' +
        '<span id="k-modal-cat"></span>' +
        '<div class="k-modal-price-row">' +
          '<span id="k-modal-price"></span>' +
          '<span id="k-modal-old-price"></span>' +
        '</div>' +
        '<button id="k-add-cart-btn"></button>' +
        '<button id="k-buy-now-btn"></button>' +
        '<button id="k-qty-minus"></button>' +
        '<button id="k-qty-plus"></button>' +
      '</div>';
    require('../../js/b-scroll-owner.js').isDesktop.mockReturnValue(false); // mobile
    dom.modal = document.getElementById('k-modal');
    dom.modalVariants = document.getElementById('k-modal-variants');
    dom.addCartBtn = document.getElementById('k-add-cart-btn');
    dom.qtyMinus = document.getElementById('k-qty-minus');
    dom.qtyPlus = document.getElementById('k-qty-plus');
    dom.modalName = document.createElement('div');
    dom.modalDesc = document.createElement('div');
    dom.modalCat = document.getElementById('k-modal-cat');
    dom.modalPromoBadge = document.createElement('div');
    dom.modalPrice = document.getElementById('k-modal-price');
    dom.modalOldPrice = document.getElementById('k-modal-old-price');
    dom.modalSku = document.getElementById('k-modal-sku');
    dom.modalStock = document.createElement('div');
  }

  beforeEach(() => {
    jest.clearAllMocks();
    installDom();
  });

  test('option AIR_ → chip porte la classe accent k-mdm-chip--air', () => {
    const detail = baseDetail({
      delivery_options: [
        { code: 'SEA_STANDARD', label: 'Livraison standard', available: true },
        { code: 'AIR_EXPRESS', label: 'Livraison express', available: true, eta_label: 'Sous 5 jours' },
      ],
    });
    renderMobileProductDetail(detail, baseSelection());

    const chips = document.querySelectorAll('.k-mdm-chip--delivery');
    expect(chips).toHaveLength(2);
    const airChip = Array.from(chips).find((c) => c.textContent.includes('Livraison express'));
    const seaChip = Array.from(chips).find((c) => c.textContent.includes('Livraison standard'));
    expect(airChip.classList.contains('k-mdm-chip--air')).toBe(true);
    expect(seaChip.classList.contains('k-mdm-chip--air')).toBe(false);
  });

  test('aucune option AIR_ → aucun chip accenté', () => {
    const detail = baseDetail({
      delivery_options: [{ code: 'SEA_STANDARD', label: 'Livraison standard', available: true }],
    });
    renderMobileProductDetail(detail, baseSelection());

    expect(document.querySelector('.k-mdm-chip--air')).toBeNull();
  });
});
