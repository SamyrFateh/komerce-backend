'use strict';

jest.mock('../../js/b-utils.js', () => ({
  fmtPrice: jest.fn((value) => `${value} KMF`),
}));

jest.mock('../../js/b-modal-product.js', () => ({
  buildCarouselSlides: jest.fn(),
  openSizeGuide: jest.fn(),
}));

jest.mock('../../js/b-modal-image-ux.js', () => ({
  setupImageUX: jest.fn(),
}));

jest.mock('../../js/b-modal-cart.js', () => ({
  _syncModalQtyUI: jest.fn(),
  setModalTransactionPending: jest.fn(),
}));

const { bus } = require('../../js/b-bus.js');
const { state, dom } = require('../../js/b-store.js');
const { buildCarouselSlides, openSizeGuide } = require('../../js/b-modal-product.js');
const { setupImageUX } = require('../../js/b-modal-image-ux.js');
const {
  _syncModalQtyUI,
  setModalTransactionPending,
} = require('../../js/b-modal-cart.js');
const {
  activateMobileProductDetail,
  renderDeliveryOptions,
} = require('../../js/b-modal-product-detail-mobile.js');

const PRODUCT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_PRODUCT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SKU_M = '11111111-1111-4111-8111-111111111111';
const SKU_L = '22222222-2222-4222-8222-222222222222';
const SKU_BEIGE_L = '33333333-3333-4333-8333-333333333333';

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
      promo_pct: 10,
    },
    media: [
      {
        id: 'global-main',
        url: '/main.jpg',
        role: 'PRODUCT',
        alt: 'Robe Dubaï',
        option_values: {},
      },
      {
        id: 'brown',
        url: '/brown.jpg',
        role: 'PRODUCT',
        alt: 'Robe marron',
        option_values: { Couleur: 'Marron' },
      },
      {
        id: 'brown-m',
        url: '/brown-m.jpg',
        role: 'DETAIL',
        alt: 'Robe marron taille M',
        option_values: { Couleur: 'Marron', Taille: 'M' },
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
        sku_id: SKU_M,
        sku: 'ROB-MAR-M',
        option_values: { Couleur: 'Marron', Taille: 'M' },
        stock_status: 'AVAILABLE',
        available_quantity: 4,
        price_kmf: 13000,
        media_ids: ['brown', 'brown-m'],
      },
      {
        sku_id: SKU_L,
        sku: 'ROB-MAR-L',
        option_values: { Couleur: 'Marron', Taille: 'L' },
        stock_status: 'OUT_OF_STOCK',
        available_quantity: 0,
        price_kmf: 12500,
        media_ids: ['brown'],
      },
      {
        sku_id: SKU_BEIGE_L,
        sku: 'ROB-BEI-L',
        option_values: { Couleur: 'Beige', Taille: 'L' },
        stock_status: 'AVAILABLE',
        available_quantity: 2,
        price_kmf: 12500,
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

function response(body, ok = true) {
  return {
    ok,
    json: jest.fn().mockResolvedValue(body),
  };
}

function resetDom() {
  document.body.innerHTML = `
    <div id="k-modal">
      <div class="k-modal-topbar">
        <img class="k-modal-topbar-thumb" alt="">
        <span class="k-modal-topbar-name"></span>
        <span class="k-modal-topbar-price"></span>
      </div>
      <div class="k-modal-scroll"></div>
      <div class="k-modal-actions"></div>
    </div>`;

  dom.modal = document.getElementById('k-modal');
  dom.modalVariants = document.createElement('div');
  dom.modalStock = document.createElement('div');
  dom.modalName = document.createElement('div');
  dom.modalDesc = document.createElement('div');
  dom.modalSku = document.createElement('div');
  dom.modalPrice = document.createElement('div');
  dom.modalOldPrice = document.createElement('div');
  dom.modalOldPrice.className = 'u-hidden';
  dom.modalPromoBadge = document.createElement('div');

  const scroll = dom.modal.querySelector('.k-modal-scroll');
  scroll.append(
    dom.modalName,
    dom.modalSku,
    dom.modalDesc,
    dom.modalPrice,
    dom.modalOldPrice,
    dom.modalPromoBadge,
    dom.modalStock,
    dom.modalVariants
  );
}

function openProduct(id = PRODUCT_ID) {
  state.modalOpen = true;
  state.modalProduct = { id, name: 'Produit liste', price_kmf: 9999 };
  state.modalProductDetail = null;
  state.modalSelection = null;
  state.modalVariantCombo = {};
}

function findOption(axis, value) {
  return dom.modalVariants.querySelector(
    `[data-axis="${axis}"][data-value="${value}"]`
  );
}

describe('b-modal-product-detail-mobile', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetDom();
    openProduct();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    global.fetch = jest.fn();
    global.requestAnimationFrame = jest.fn((callback) => {
      callback();
      return 1;
    });
  });

  afterEach(() => {
    bus.emit('modal:closed');
  });

  test('desktop : aucun fetch détail et aucun verrou transactionnel', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 });

    await activateMobileProductDetail(state.modalProduct);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(setModalTransactionPending).not.toHaveBeenCalled();
    expect(state.modalProductDetail).toBeNull();
  });

  test('mobile SKU : charge /detail, crée le reducer et rend le chemin PDC', async () => {
    const detail = productDetail();
    global.fetch.mockResolvedValue(response(detail));

    await activateMobileProductDetail(state.modalProduct);

    expect(setModalTransactionPending).toHaveBeenCalledWith(true);
    expect(global.fetch).toHaveBeenCalledWith(`/api/products/${PRODUCT_ID}/detail`, {
      credentials: 'include',
    });
    expect(state.modalProductDetail).toBe(detail);
    expect(state.modalSelection.selection_supported).toBe(true);
    expect(state.modalSelection.selected_sku_id).toBeNull();
    expect(dom.modalVariants.querySelector('[data-pdc-sku-selection="1"]')).not.toBeNull();
    expect(_syncModalQtyUI).toHaveBeenCalled();
  });

  test('contrat legacy : déverrouille puis laisse le renderer historique intact', async () => {
    global.fetch.mockResolvedValue(response(productDetail({
      inventory_model: 'LEGACY_VARIANTS',
      sellable_units: [],
    })));
    dom.modalVariants.innerHTML = '<span data-legacy="1">legacy</span>';

    await activateMobileProductDetail(state.modalProduct);

    expect(setModalTransactionPending).toHaveBeenNthCalledWith(1, true);
    expect(setModalTransactionPending).toHaveBeenLastCalledWith(false);
    expect(state.modalProductDetail).toBeNull();
    expect(dom.modalVariants.querySelector('[data-legacy="1"]')).not.toBeNull();
  });

  test('réponse HTTP non OK ou erreur réseau réactive le fallback legacy courant', async () => {
    global.fetch.mockResolvedValueOnce(response({}, false));
    await activateMobileProductDetail(state.modalProduct);
    expect(setModalTransactionPending).toHaveBeenLastCalledWith(false);

    jest.clearAllMocks();
    openProduct();
    global.fetch.mockRejectedValueOnce(new Error('offline'));
    await activateMobileProductDetail(state.modalProduct);
    expect(setModalTransactionPending).toHaveBeenNthCalledWith(1, true);
    expect(setModalTransactionPending).toHaveBeenLastCalledWith(false);
  });

  test('une réponse tardive A ne remplace pas le produit B déjà ouvert', async () => {
    let resolveA;
    const pendingA = new Promise((resolve) => { resolveA = resolve; });
    global.fetch
      .mockImplementationOnce(() => pendingA)
      .mockResolvedValueOnce(response(productDetail({
        product: { ...productDetail().product, id: OTHER_PRODUCT_ID, name: 'Produit B' },
      })));

    const promiseA = activateMobileProductDetail(state.modalProduct);
    openProduct(OTHER_PRODUCT_ID);
    const promiseB = activateMobileProductDetail(state.modalProduct);
    await promiseB;

    resolveA(response(productDetail()));
    await promiseA;

    expect(state.modalProductDetail.product.id).toBe(OTHER_PRODUCT_ID);
    expect(dom.modalName.textContent).toBe('Produit B');
  });

  test('Marron puis L affiche la rupture contextuelle sans sélectionner le SKU', async () => {
    global.fetch.mockResolvedValue(response(productDetail()));
    await activateMobileProductDetail(state.modalProduct);

    findOption('Couleur', 'Marron').click();
    const sizeL = findOption('Taille', 'L');
    expect(sizeL.dataset.optionState).toBe('OUT_OF_STOCK');
    expect(sizeL.disabled).toBe(false);
    expect(sizeL.getAttribute('aria-disabled')).toBe('true');
    sizeL.click();

    expect(state.modalSelection.selected_options).toEqual({ Couleur: 'Marron' });
    expect(state.modalSelection.selected_sku_id).toBeNull();
    expect(dom.modalStock.textContent).toBe('L indisponible pour Marron — rupture de stock');
  });

  test('Marron + M sélectionne le SKU, son prix et ses médias exacts', async () => {
    global.fetch.mockResolvedValue(response(productDetail()));
    await activateMobileProductDetail(state.modalProduct);

    findOption('Couleur', 'Marron').click();
    findOption('Taille', 'M').click();

    expect(state.modalSelection.selected_sku_id).toBe(SKU_M);
    expect(state.modalVariantCombo).toEqual({ Couleur: 'Marron', Taille: 'M' });
    expect(dom.modalPrice.textContent).toBe('13000 KMF');
    expect(dom.modalStock.textContent).toBe('🔥 Plus que 4 en stock');
    expect(buildCarouselSlides).toHaveBeenLastCalledWith({
      id: PRODUCT_ID,
      name: 'Robe Dubaï',
      images: ['/brown.jpg', '/brown-m.jpg'],
      image_url: '/brown.jpg',
    });
    expect(setupImageUX).toHaveBeenCalled();
  });

  test('un axe taille conserve le guide existant et délègue à openSizeGuide', async () => {
    global.fetch.mockResolvedValue(response(productDetail()));
    await activateMobileProductDetail(state.modalProduct);

    const guide = dom.modalVariants.querySelector('.k-vg-size-guide');
    expect(guide.dataset.sizeType).toBe('clothes');
    guide.click();
    expect(openSizeGuide).toHaveBeenCalledWith('clothes');
  });

  test('livraison rend exactement les options du contrat sans délai ni gratuité inventés', async () => {
    global.fetch.mockResolvedValue(response(productDetail()));
    await activateMobileProductDetail(state.modalProduct);

    const panel = dom.modal.querySelector('[data-pdc-delivery="1"]');
    expect(panel).not.toBeNull();
    expect(panel.textContent).toContain('Livraison standard');
    expect(panel.textContent).not.toContain('Livraison express');
    expect(panel.textContent).not.toContain('3 à 5 semaines');
    expect(panel.textContent).not.toContain('Gratuit');
  });

  test('prix et ETA livraison ne sont affichés que lorsqu’ils sont fournis', () => {
    renderDeliveryOptions([
      {
        code: 'AIR_EXPRESS',
        label: 'Livraison express',
        available: true,
        price_kmf: 2500,
        eta_label: '48 h',
        unavailable_reason: null,
      },
    ]);

    const panel = dom.modal.querySelector('[data-pdc-delivery="1"]');
    expect(panel.textContent).toContain('2500 KMF');
    expect(panel.textContent).toContain('48 h');
  });

  test('ancien prix n’est jamais reconstruit depuis promo_pct', async () => {
    global.fetch.mockResolvedValue(response(productDetail({
      pricing: { price_kmf: 12500, old_price_kmf: null, promo_pct: 20 },
    })));
    await activateMobileProductDetail(state.modalProduct);

    expect(dom.modalOldPrice.textContent).toBe('');
    expect(dom.modalOldPrice.classList.contains('u-hidden')).toBe(true);
    expect(dom.modalPromoBadge.textContent).toBe('-20%');
  });

  test('ancien prix réel du contrat est affiché tel quel', async () => {
    global.fetch.mockResolvedValue(response(productDetail({
      pricing: { price_kmf: 12500, old_price_kmf: 15000, promo_pct: 17 },
    })));
    await activateMobileProductDetail(state.modalProduct);

    expect(dom.modalOldPrice.textContent).toBe('15000 KMF');
    expect(dom.modalOldPrice.classList.contains('u-hidden')).toBe(false);
  });

  test('si le renderer legacy écrase les variantes après le fetch, le marker PDC est restauré', async () => {
    global.fetch.mockResolvedValue(response(productDetail()));
    await activateMobileProductDetail(state.modalProduct);

    dom.modalVariants.innerHTML = '<button data-legacy="1">legacy</button>';
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(dom.modalVariants.querySelector('[data-legacy="1"]')).toBeNull();
    expect(dom.modalVariants.querySelector('[data-pdc-sku-selection="1"]')).not.toBeNull();
  });

  test('modal:closed annule la requête logique et purge détail + sélection', async () => {
    global.fetch.mockResolvedValue(response(productDetail()));
    await activateMobileProductDetail(state.modalProduct);
    expect(state.modalProductDetail).not.toBeNull();

    bus.emit('modal:closed');

    expect(state.modalProductDetail).toBeNull();
    expect(state.modalSelection).toBeNull();
  });
});
