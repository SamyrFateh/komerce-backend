jest.mock('../../js/b-store.js', () => ({
  state: {},
  dom: {},
}));

jest.mock('../../js/b-utils.js', () => ({
  fmtPrice: (value) => value == null ? '' : `${value} KMF`,
  optimizeImgUrl: (url) => url,
}));

jest.mock('../../js/b-modal-product.js', () => ({
  buildCarouselSlides: jest.fn(),
  goToSlide: jest.fn(),
}));

jest.mock('../../js/b-modal-image-ux.js', () => ({
  setupImageUX: jest.fn(),
}));

const { state, dom } = require('../../js/b-store.js');
const { buildCarouselSlides, goToSlide } = require('../../js/b-modal-product.js');
const { setupImageUX } = require('../../js/b-modal-image-ux.js');
const {
  createModalSelection,
} = require('../../js/view-models/modal-selection-model.js');
const {
  renderMobileProductDetail,
  clearMobileProductDetailState,
} = require('../../js/b-modal-mobile-product.js');

const PRODUCT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SKU_MAR_M = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SKU_MAR_L = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SKU_BEI_L = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

function productDetail(overrides = {}) {
  return {
    contract_version: '1',
    inventory_model: 'SKU',
    product: {
      id: PRODUCT_ID,
      reference: 'ROB-001',
      name: 'Robe Dubaï',
      description: 'Robe fluide',
      category: 'vetements',
      subcategory: 'robes',
    },
    pricing: {
      price_kmf: 12500,
      old_price_kmf: null,
      promo_pct: null,
    },
    media: [
      {
        id: 'global',
        url: '/global.jpg',
        role: 'PRODUCT',
        alt: 'Robe Dubaï',
        option_values: {},
      },
      {
        id: 'brown-scene',
        url: '/brown-scene.jpg',
        role: 'SCENE',
        alt: 'Robe marron',
        option_values: { Couleur: 'Marron' },
      },
      {
        id: 'beige',
        url: '/beige.jpg',
        role: 'PRODUCT',
        alt: 'Robe beige',
        option_values: { Couleur: 'Beige' },
      },
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
        media_ids: ['brown-scene'],
      },
      {
        sku_id: SKU_MAR_L,
        sku: 'ROB-MAR-L',
        option_values: { Couleur: 'Marron', Taille: 'L' },
        stock_status: 'OUT_OF_STOCK',
        available_quantity: 0,
        price_kmf: 12500,
        media_ids: ['brown-scene'],
      },
      {
        sku_id: SKU_BEI_L,
        sku: 'ROB-BEI-L',
        option_values: { Couleur: 'Beige', Taille: 'L' },
        stock_status: 'AVAILABLE',
        available_quantity: 2,
        price_kmf: 13000,
        media_ids: ['beige'],
      },
    ],
    delivery_options: [
      {
        code: 'SEA_STANDARD',
        label: 'Livraison standard',
        available: true,
        price_kmf: null,
        eta_label: null,
        unavailable_reason: null,
      },
    ],
    ...overrides,
  };
}

function installDom() {
  document.body.innerHTML = `
    <div id="k-modal">
      <div class="k-modal-img-wrap"></div>
      <div id="k-modal-variants"></div>
      <h2 id="k-modal-name"></h2>
      <p id="k-modal-desc"></p>
      <span id="k-modal-cat"></span>
      <span id="k-modal-price"></span>
      <span id="k-modal-old-price"></span>
      <span id="k-modal-sku"></span>
      <span id="k-modal-stock"></span>
      <span id="k-modal-promo-badge"></span>
      <button id="k-add-cart-btn">Ajouter</button>
      <button id="k-buy-now-btn">Acheter</button>
    </div>`;

  window.matchMedia = jest.fn().mockReturnValue({ matches: true });

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
  dom.addCartBtn = document.getElementById('k-add-cart-btn');
}

describe('mobile product detail renderer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    installDom();
    Object.keys(state).forEach((key) => delete state[key]);
  });

  afterEach(() => {
    clearMobileProductDetailState();
  });

  test('rend vignettes couleur photo, tailles et livraison depuis le contrat', () => {
    const detail = productDetail();
    renderMobileProductDetail(detail, createModalSelection(detail), { forceMedia: true });

    expect(document.querySelector('[data-pdc4-root]')).not.toBeNull();
    expect(document.querySelectorAll('.k-sku')).toHaveLength(2);
    expect(document.querySelector('.k-sku img').getAttribute('src')).toBe('/brown-thumb.jpg');
    expect(document.querySelectorAll('.k-vg-sizes .k-vp')).toHaveLength(2);
    expect(document.querySelector('[data-product-delivery-options] .k-modal-reassurance-label').textContent)
      .toBe('Livraison standard');
    expect(document.querySelector('[data-product-delivery-options] .k-modal-reassurance-delay')).toBeNull();
    expect(document.body.textContent).not.toContain('3 à 5 semaines');
    expect(document.body.textContent).not.toContain('Gratuit');
  });

  test('delivery_options absent reste honnête sans crash', () => {
    const detail = productDetail({ delivery_options: null });
    renderMobileProductDetail(detail, createModalSelection(detail), { forceMedia: true });

    expect(document.querySelector('[data-product-delivery-options]').textContent)
      .toContain('communiquée à la commande');
    expect(document.body.textContent).not.toContain('3 à 5 semaines');
    expect(document.body.textContent).not.toContain('Gratuit');
  });

  test('Marron recalcule L en rupture et affiche la galerie associée', () => {
    const detail = productDetail();
    renderMobileProductDetail(detail, createModalSelection(detail), { forceMedia: true });

    document.querySelector('[data-axis-key="Couleur"] [data-option-value="Marron"]').click();

    expect(state.modalSelection.selected_options).toEqual({ Couleur: 'Marron' });
    expect(state.modalVariantCombo).toEqual({ Couleur: 'Marron' });
    const sizeL = document.querySelector('[data-axis-key="Taille"] [data-option-value="L"]');
    expect(sizeL.dataset.optionState).toBe('OUT_OF_STOCK');
    expect(sizeL.classList.contains('k-vp--out')).toBe(true);
    expect(sizeL.getAttribute('aria-label')).toContain('Rupture');
    expect(buildCarouselSlides).toHaveBeenLastCalledWith(expect.objectContaining({
      images: ['/brown-scene.jpg'],
    }));
    expect(goToSlide).toHaveBeenCalledWith(0);
    expect(setupImageUX).toHaveBeenCalled();
  });

  test('clic sur L indisponible explique la rupture sans sélectionner un SKU', () => {
    const detail = productDetail();
    renderMobileProductDetail(detail, createModalSelection(detail), { forceMedia: true });

    document.querySelector('[data-axis-key="Couleur"] [data-option-value="Marron"]').click();
    document.querySelector('[data-axis-key="Taille"] [data-option-value="L"]').click();

    expect(state.modalSelection.selected_sku_id).toBeNull();
    expect(state.modalVariantCombo).toEqual({ Couleur: 'Marron' });
    expect(document.getElementById('k-modal-selection-message').textContent)
      .toBe('L indisponible pour Marron — rupture de stock');
    expect(dom.addCartBtn.disabled).toBe(true);
    expect(document.getElementById('k-buy-now-btn').disabled).toBe(true);
  });

  test('Marron + M résout le SKU, référence, snapshot combo et actions transactionnelles', () => {
    const detail = productDetail();
    renderMobileProductDetail(detail, createModalSelection(detail), { forceMedia: true });

    document.querySelector('[data-axis-key="Couleur"] [data-option-value="Marron"]').click();
    document.querySelector('[data-axis-key="Taille"] [data-option-value="M"]').click();

    expect(state.modalSelection.selected_sku_id).toBe(SKU_MAR_M);
    expect(state.modalVariantCombo).toEqual({ Couleur: 'Marron', Taille: 'M' });
    expect(dom.modalSku.textContent).toBe('Réf. ROB-MAR-M');
    expect(dom.modalStock.textContent).toBe('✓ Disponible');
    expect(dom.addCartBtn.disabled).toBe(false);
    expect(document.getElementById('k-buy-now-btn').disabled).toBe(false);
  });

  test('changer Marron vers Beige efface Taille et passe sur la galerie Beige', () => {
    const detail = productDetail();
    renderMobileProductDetail(detail, createModalSelection(detail), { forceMedia: true });

    document.querySelector('[data-axis-key="Couleur"] [data-option-value="Marron"]').click();
    document.querySelector('[data-axis-key="Taille"] [data-option-value="M"]').click();
    document.querySelector('[data-axis-key="Couleur"] [data-option-value="Beige"]').click();

    expect(state.modalSelection.selected_options).toEqual({ Couleur: 'Beige' });
    expect(state.modalVariantCombo).toEqual({ Couleur: 'Beige' });
    expect(state.modalSelection.selected_sku_id).toBeNull();
    expect(buildCarouselSlides).toHaveBeenLastCalledWith(expect.objectContaining({
      images: ['/beige.jpg'],
    }));
  });

  test('une livraison avec prix et ETA rend uniquement les faits reçus', () => {
    const detail = productDetail({
      delivery_options: [{
        code: 'AIR_EXPRESS',
        label: 'Livraison express',
        available: true,
        price_kmf: 2500,
        eta_label: 'Sous 5 jours',
        unavailable_reason: null,
      }],
    });

    renderMobileProductDetail(detail, createModalSelection(detail), { forceMedia: true });

    expect(document.querySelector('[data-product-delivery-options] .k-modal-reassurance-label').textContent)
      .toBe('Livraison express');
    expect(document.querySelector('[data-product-delivery-options] .k-modal-reassurance-delay').textContent)
      .toBe('· 2500 KMF · Sous 5 jours');
  });

  test('n’invente pas ancien prix et délai depuis promo_pct', () => {
    const detail = productDetail({
      pricing: { price_kmf: 10000, old_price_kmf: null, promo_pct: 20 },
    });

    renderMobileProductDetail(detail, createModalSelection(detail), { forceMedia: true });

    expect(dom.modalOldPrice.classList.contains('u-hidden')).toBe(true);
    expect(dom.modalOldPrice.textContent).toBe('');
    expect(dom.modalPromoBadge.textContent).toBe('-20%');
    expect(document.body.textContent).not.toContain('3 à 5 semaines');
  });

  test('ne rend rien quand le viewport n’est pas mobile', () => {
    window.matchMedia.mockReturnValue({ matches: false });
    const detail = productDetail();

    renderMobileProductDetail(detail, createModalSelection(detail), { forceMedia: true });

    expect(dom.modalVariants.innerHTML).toBe('');
    expect(buildCarouselSlides).not.toHaveBeenCalled();
  });
});
