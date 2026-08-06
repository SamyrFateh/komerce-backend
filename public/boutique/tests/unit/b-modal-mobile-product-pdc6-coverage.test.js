'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
jest.mock('../../js/b-store.js', () => ({
  state: {},
  dom: {},
  getRequestedTransportRail: jest.fn(() => {
    const { state } = require('../../js/b-store.js');
    return state.modalDeliverySelection?.requested_transport_rail ?? null;
  }),
}));

jest.mock('../../js/b-utils.js', () => ({
  fmtPrice: jest.fn((n) => String(n) + ' KMF'),
  optimizeImgUrl: jest.fn((url, width) => `${url}?w=${width}`),
}));

jest.mock('../../js/view-models/modal-selection-model.js', () => ({
  OPTION_STATE: {
    AVAILABLE: 'AVAILABLE',
    OUT_OF_STOCK: 'OUT_OF_STOCK',
    INCOMPATIBLE: 'INCOMPATIBLE',
  },
  selectModalOption: jest.fn(),
}));

jest.mock('../../js/b-modal-product.js', () => ({
  buildCarouselSlides: jest.fn(),
  goToSlide: jest.fn(),
}));

jest.mock('../../js/b-modal-image-ux.js', () => ({ setupImageUX: jest.fn() }));

// §4 — mock isDesktop pour le routing viewport
jest.mock('../../js/b-scroll-owner.js', () => ({
  isDesktop: jest.fn(() => false), // défaut : mobile
  getScrollY: jest.fn(() => 0),
  scrollToPosition: jest.fn(),
}));

const { state, dom } = require('../../js/b-store.js');
const { fmtPrice, optimizeImgUrl } = require('../../js/b-utils.js');
const {
  OPTION_STATE,
  selectModalOption,
} = require('../../js/view-models/modal-selection-model.js');
const { buildCarouselSlides, goToSlide } = require('../../js/b-modal-product.js');
const { setupImageUX } = require('../../js/b-modal-image-ux.js');
const {
  renderMobileProductDetail,
  clearMobileProductDetailState,
} = require('../../js/b-modal-mobile-product.js');

function installDom({ withBuyNow = true } = {}) {
  document.body.innerHTML = `
    <div id="k-modal">
      <div data-mobile-reassurance="1">legacy</div>
      <div id="k-modal-variants"></div>
      <button id="k-add-cart-btn"></button>
      ${withBuyNow ? '<button id="k-buy-now-btn"></button>' : ''}
      <button id="k-qty-minus"></button>
      <button id="k-qty-plus"></button>
    </div>`;
  require('../../js/b-scroll-owner.js').isDesktop.mockReturnValue(false); // mobile
  dom.modal = document.getElementById('k-modal');
  dom.modalVariants = document.getElementById('k-modal-variants');
  dom.addCartBtn = document.getElementById('k-add-cart-btn');
  dom.qtyMinus = document.getElementById('k-qty-minus');
  dom.qtyPlus = document.getElementById('k-qty-plus');
  dom.modalName = document.createElement('div');
  dom.modalDesc = document.createElement('div');
  dom.modalDesc.className = 'is-expanded';
  dom.modalCat = document.createElement('div');
  dom.modalPromoBadge = document.createElement('div');
  dom.modalPrice = document.createElement('div');
  dom.modalOldPrice = document.createElement('div');
  dom.modalSku = document.createElement('div');
}

function richDetail() {
  return {
    contract_version: '1',
    inventory_model: 'SKU',
    product: {
      id: 'p1',
      name: 'Robe Dubaï',
      description: 'Robe longue',
      category: 'Mode',
      reference: 'REF-P1',
    },
    pricing: { price_kmf: 5000, promo_pct: 20, old_price_kmf: 8000 },
    media: [{ id: 'base', url: '/base.jpg' }],
    option_axes: [
      {
        key: 'coloris',
        display_name: 'Couleur',
        values: [
          { value: 'Rouge', thumbnail_url: '/rouge.jpg' },
          { value: 'Bleu', thumbnail_url: '/bleu.jpg' },
          { value: 'Vert', thumbnail_url: null },
        ],
      },
      {
        key: 'size',
        display_name: 'Taille',
        values: [
          { value: 'M' },
          { value: 'L' },
          { value: 'XL' },
        ],
      },
    ],
    sellable_units: [
      { sku_id: 'sku-rm', sku: 'SKU-RM', price_kmf: 6500 },
      { sku_id: 'sku-bm', sku: 'SKU-BM', price_kmf: 7000 },
    ],
    delivery_options: [
      { label: 'Relais', price_kmf: 500, eta_label: '2 jours', available: true },
      { label: 'Express', price_kmf: null, eta_label: '24 h', available: false, unavailable_reason: 'Indisponible' },
      { label: 'Retrait', available: true },
    ],
  };
}

function richSelection(overrides = {}) {
  return Object.assign({
    selection_supported: true,
    selected_options: { coloris: 'Rouge', size: 'M' },
    selected_sku_id: 'sku-rm',
    selected_media: [
      { id: 'm1', url: '/selected-1.jpg' },
      { id: 'm2', url: '/selected-2.jpg' },
    ],
    option_states: {
      coloris: [
        { value: 'Rouge', state: OPTION_STATE.AVAILABLE },
        { value: 'Bleu', state: OPTION_STATE.OUT_OF_STOCK },
        { value: 'Vert', state: OPTION_STATE.INCOMPATIBLE },
      ],
      size: [
        { value: 'M', state: OPTION_STATE.AVAILABLE },
        { value: 'L', state: OPTION_STATE.OUT_OF_STOCK },
      ],
    },
    selection_message: 'Configuration disponible',
  }, overrides);
}

describe('b-modal-mobile-product — PDC-6 renderer coverage closure', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    installDom();
    state.modalProductDetail = null;
    state.modalSelection = null;
    state.modalMediaSignature = '';
    state.modalVariantCombo = null;
  });

  test('rend toute la projection SKU canonique et explique les options indisponibles sans désactiver leur clic', () => {
    const detail = richDetail();
    const selection = richSelection();
    const nextSelection = richSelection({
      selected_options: { coloris: 'Bleu', size: 'M' },
      selected_sku_id: 'sku-bm',
      selected_media: [{ id: 'blue', url: '/blue.jpg' }],
    });
    selectModalOption.mockReturnValue(nextSelection);

    renderMobileProductDetail(detail, selection, { forceMedia: true });

    expect(dom.modal.querySelector('[data-mobile-reassurance]')).toBeNull();
    const root = dom.modalVariants.querySelector('[data-pdc4-root]');
    expect(root).not.toBeNull();
    expect(root.querySelectorAll('.k-vg')).toHaveLength(2);

    const colorButtons = root.querySelector('[data-axis-key="coloris"]').querySelectorAll('button');
    expect(colorButtons[0].className).toContain('k-sku--active');
    expect(colorButtons[1].className).toContain('k-vp--out');
    expect(colorButtons[1].getAttribute('aria-label')).toContain('Rupture');
    expect(colorButtons[2].getAttribute('aria-label')).toContain('Non proposé');
    expect(optimizeImgUrl).toHaveBeenCalledWith('/rouge.jpg', 140);

    const sizeButtons = root.querySelector('[data-axis-key="size"]').querySelectorAll('button');
    expect(sizeButtons[0].className).toContain('k-vp--active');
    expect(sizeButtons[1].className).toContain('k-vp--out');
    expect(sizeButtons[2].dataset.optionState).toBe(OPTION_STATE.INCOMPATIBLE);

    expect(dom.modalName.textContent).toBe('Robe Dubaï');
    // MDM-7 : la description est retirée de la zone identité (déplacée
    // sous le fold) — modalDesc reste vide et masqué dans l'identité.
    expect(dom.modalDesc.textContent).toBe('');
    expect(dom.modalDesc.classList.contains('u-hidden')).toBe(true);
    // MDM-3 : catégorie non affichée sur mobile (pas de poids visuel utile).
    expect(dom.modalCat.textContent).toBe('');
    expect(dom.modalPromoBadge.textContent).toBe('-20%');
    expect(dom.modalPromoBadge.classList.contains('show')).toBe(true);
    expect(dom.modal.classList.contains('k-modal--has-promo')).toBe(true);
    expect(dom.modalPrice.textContent).toBe('6500 KMF');
    expect(dom.modalOldPrice.textContent).toBe('8000 KMF');
    expect(dom.modalOldPrice.classList.contains('u-hidden')).toBe(false);
    expect(dom.modalSku.textContent).toBe('Réf. SKU-RM');
    expect(dom.modalSku.hidden).toBe(false);

    // MDM-5 : livraison vit désormais dans l'info strip (chips), pas dans
    // dom.modalStock. P2 stock-en-double (2026-07) : le chip "✓ Disponible"
    // n'est plus rendu quand la sélection résout un SKU — l'info est déjà
    // portée par le pill stock près du prix (renderStockPill), la répéter
    // ici était un doublon pur.
    const availChip = root.querySelector('.k-mdm-chip--ok');
    expect(availChip).toBeNull();

    expect(document.getElementById('k-add-cart-btn').disabled).toBe(false);
    expect(document.getElementById('k-buy-now-btn').disabled).toBe(false);
    expect(dom.qtyMinus.disabled).toBe(true);
    expect(dom.qtyPlus.disabled).toBe(true);

    const selectionMessage = root.querySelector('#k-modal-selection-message');
    expect(selectionMessage.textContent).toBe('Configuration disponible');
    expect(selectionMessage.hidden).toBe(false);
    expect(root.textContent).toContain('Relais');
    expect(root.textContent).toContain('500 KMF · 2 jours');
    expect(root.textContent).toContain('Express');
    expect(root.textContent).toContain('24 h');
    expect(root.textContent).toContain('Retrait');

    // MDM-7 : description déplacée sous le fold. "Robe longue" est courte
    // (bien sous le seuil READ_MORE_CHAR_THRESHOLD) : Lot Content commit 4
    // corrige MDM-7 pour ne plus poser de bouton "Lire la suite" quand rien
    // n'est réellement masqué — voir b-modal-mobile-product.test.js pour la
    // couverture explicite de cette règle (description longue vs courte).
    const descText = root.querySelector('.k-mdm-desc-text');
    expect(descText.textContent).toBe('Robe longue');
    expect(root.querySelector('.k-mdm-read-more')).toBeNull();

    expect(buildCarouselSlides).toHaveBeenCalledWith({
      name: 'Robe Dubaï',
      images: ['/selected-1.jpg', '/selected-2.jpg'],
      image_url: '/selected-1.jpg',
    });
    expect(goToSlide).toHaveBeenCalledWith(0);
    expect(setupImageUX).toHaveBeenCalled();
    expect(state.modalVariantCombo).toEqual({ coloris: 'Rouge', size: 'M' });

    colorButtons[1].click();
    expect(selectModalOption).toHaveBeenCalledWith(detail, selection, 'coloris', 'Bleu');
    expect(state.modalSelection).toBe(nextSelection);
    expect(dom.modalVariants.querySelectorAll('[data-pdc4-root]')).toHaveLength(1);
    expect(dom.modalPrice.textContent).toBe('7000 KMF');
    expect(dom.modalSku.textContent).toBe('Réf. SKU-BM');
  });

  test('projection non-SKU sans options utilise seulement les fallbacks explicites du contrat', () => {
    const detail = {
      contract_version: '1',
      inventory_model: 'LEGACY_VARIANTS',
      product: { id: 'p2', name: 'Produit simple', description: '', category: '', reference: null },
      pricing: { price_kmf: 1000, promo_pct: 0, old_price_kmf: null },
      media: [{ id: 'base', url: '/fallback.jpg' }],
      option_axes: [],
      sellable_units: [],
      delivery_options: [],
    };
    const selection = {
      selection_supported: false,
      selected_options: { legacy: 'ignored' },
      selected_sku_id: null,
      selected_media: [],
      option_states: {},
      selection_message: null,
    };

    renderMobileProductDetail(detail, selection, { forceMedia: true });

    expect(state.modalVariantCombo).toEqual({});
    expect(dom.modalPromoBadge.textContent).toBe('');
    expect(dom.modalPromoBadge.classList.contains('show')).toBe(false);
    expect(dom.modal.classList.contains('k-modal--has-promo')).toBe(false);
    expect(dom.modalPrice.textContent).toBe('1000 KMF');
    expect(dom.modalOldPrice.textContent).toBe('');
    expect(dom.modalOldPrice.classList.contains('u-hidden')).toBe(true);
    expect(dom.modalSku.textContent).toBe('');
    expect(dom.modalSku.hidden).toBe(true);
    // selection_supported === false → pas de chip de disponibilité (seule la
    // chip de livraison fallback est présente, cf. assertion plus bas).
    expect(dom.modalVariants.querySelector('.k-mdm-chip--ok')).toBeNull();
    expect(document.getElementById('k-add-cart-btn').disabled).toBe(false);
    expect(document.getElementById('k-buy-now-btn').disabled).toBe(false);
    expect(dom.qtyMinus.disabled).toBe(false);
    expect(dom.qtyPlus.disabled).toBe(false);
    expect(dom.modalVariants.textContent).toContain('communiquée à la commande');
    expect(buildCarouselSlides).toHaveBeenCalledWith({
      name: 'Produit simple',
      images: ['/fallback.jpg'],
      image_url: '/fallback.jpg',
    });

    buildCarouselSlides.mockClear();
    goToSlide.mockClear();
    setupImageUX.mockClear();
    renderMobileProductDetail(detail, selection);
    expect(buildCarouselSlides).not.toHaveBeenCalled();
    expect(goToSlide).not.toHaveBeenCalled();
    expect(setupImageUX).not.toHaveBeenCalled();

    clearMobileProductDetailState();
    expect(state.modalProductDetail).toBeNull();
    expect(state.modalSelection).toBeNull();
    expect(state.modalMediaSignature).toBe('');
  });

  test('la puce de disponibilité et l’aria suivent la progression de sélection SKU sans intelligence locale', () => {
    const detail = richDetail();
    const empty = richSelection({
      selected_options: {},
      selected_sku_id: null,
      selected_media: [],
      selection_message: 'Choisissez',
    });

    renderMobileProductDetail(detail, empty);
    let chip = dom.modalVariants.querySelector('.k-mdm-chip');
    expect(chip.textContent).toBe('Choisissez vos options');
    expect(document.getElementById('k-add-cart-btn').disabled).toBe(true);
    expect(document.getElementById('k-add-cart-btn').getAttribute('aria-describedby')).toBe('k-modal-selection-message');

    const partial = richSelection({
      selected_options: { coloris: 'Rouge' },
      selected_sku_id: null,
      selected_media: [],
      selection_message: '',
    });
    renderMobileProductDetail(detail, partial);
    chip = dom.modalVariants.querySelector('.k-mdm-chip');
    expect(chip.textContent).toBe('Choisissez la suite');
    expect(dom.modalVariants.querySelector('#k-modal-selection-message').hidden).toBe(true);

    const resolved = richSelection();
    renderMobileProductDetail(detail, resolved);
    expect(document.getElementById('k-add-cart-btn').hasAttribute('aria-describedby')).toBe(false);
    // P2 stock-en-double (2026-07) : plus de chip du tout une fois le SKU
    // résolu — la disponibilité est déjà annoncée par le pill stock.
    expect(dom.modalVariants.querySelector('.k-mdm-chip--ok')).toBeNull();
  });

  test('gardes DOM et viewport restent fail-safe', () => {
    const detail = richDetail();
    const selection = richSelection();

    require('../../js/b-scroll-owner.js').isDesktop.mockReturnValue(true); // desktop
    dom.modalVariants.innerHTML = '<span data-sentinel="1"></span>';
    renderMobileProductDetail(detail, selection);
    expect(dom.modalVariants.querySelector('[data-sentinel]')).not.toBeNull();

    require('../../js/b-scroll-owner.js').isDesktop.mockReturnValue(false); // mobile
    dom.modalVariants = null;
    document.getElementById('k-modal-variants').remove();
    expect(() => renderMobileProductDetail(detail, selection)).not.toThrow();

    installDom({ withBuyNow: false });
    dom.modalName = null;
    dom.modalDesc = null;
    dom.modalCat = null;
    dom.modalPromoBadge = null;
    dom.modalPrice = null;
    dom.modalOldPrice = null;
    dom.modalSku = null;
    dom.addCartBtn = null;
    dom.qtyMinus = null;
    dom.qtyPlus = null;
    expect(() => renderMobileProductDetail({
      ...detail,
      inventory_model: 'LEGACY_VARIANTS',
      option_axes: [],
      delivery_options: [],
    }, {
      selection_supported: false,
      selected_options: {},
      selected_sku_id: null,
      selected_media: [],
      option_states: {},
      selection_message: null,
    }, { forceMedia: true })).not.toThrow();
  });
});
