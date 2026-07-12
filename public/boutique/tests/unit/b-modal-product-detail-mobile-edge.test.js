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
const {
  activateMobileProductDetail,
  renderCurrentSelection,
  renderDeliveryOptions,
  renderSelectionAxes,
} = require('../../js/b-modal-product-detail-mobile.js');

const PRODUCT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DEFAULT_SKU = '11111111-1111-4111-8111-111111111111';

function baseDetail(overrides = {}) {
  return {
    contract_version: '1',
    inventory_model: 'SKU',
    product: {
      id: PRODUCT_ID,
      reference: 'REF-1',
      name: 'Produit test',
      description: 'Description',
      category: 'test',
      subcategory: null,
    },
    pricing: {
      price_kmf: 5000,
      old_price_kmf: null,
      promo_pct: null,
    },
    media: [{
      id: 'main',
      url: '/main.jpg',
      role: 'PRODUCT',
      alt: 'Produit test',
      option_values: {},
    }],
    option_axes: [],
    sellable_units: [{
      sku_id: DEFAULT_SKU,
      sku: 'DEFAULT-1',
      option_values: {},
      stock_status: 'AVAILABLE',
      available_quantity: 15,
      price_kmf: 5000,
      media_ids: [],
    }],
    delivery_options: [],
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
    </div>
    <div id="k-modal-variants"></div>`;

  dom.modal = document.getElementById('k-modal');
  dom.modalVariants = document.getElementById('k-modal-variants');
  dom.modalStock = document.createElement('div');
  dom.modalName = document.createElement('div');
  dom.modalDesc = document.createElement('div');
  dom.modalSku = document.createElement('div');
  dom.modalPrice = document.createElement('div');
  dom.modalOldPrice = document.createElement('div');
  dom.modalPromoBadge = document.createElement('div');

  dom.modal.querySelector('.k-modal-scroll').append(
    dom.modalName,
    dom.modalSku,
    dom.modalDesc,
    dom.modalPrice,
    dom.modalOldPrice,
    dom.modalPromoBadge,
    dom.modalStock
  );
}

function openProduct(id = PRODUCT_ID) {
  state.modalOpen = true;
  state.modalProduct = { id, name: 'Produit liste' };
  state.modalProductDetail = null;
  state.modalSelection = null;
  state.modalVariantCombo = {};
}

async function activate(detail) {
  global.fetch.mockResolvedValue(response(detail));
  await activateMobileProductDetail(state.modalProduct);
}

describe('b-modal-product-detail-mobile — edge branches', () => {
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

  test('SKU par défaut avec stock > 10 affiche Disponible', async () => {
    await activate(baseDetail());

    expect(state.modalSelection.selected_sku_id).toBe(DEFAULT_SKU);
    expect(dom.modalStock.textContent).toBe('✓ Disponible');
    expect(dom.modalStock.className).toBe('k-modal-stock k-modal-stock--ok');
  });

  test('SKU par défaut en rupture affiche Rupture', async () => {
    await activate(baseDetail({
      sellable_units: [{
        ...baseDetail().sellable_units[0],
        stock_status: 'OUT_OF_STOCK',
        available_quantity: 0,
      }],
    }));

    expect(state.modalSelection.selected_sku_id).toBeNull();
    expect(dom.modalStock.textContent).toBe('✗ Rupture');
  });

  test('aucune unité par défaut affiche aussi Rupture sans inventer un stock', async () => {
    await activate(baseDetail({ sellable_units: [] }));
    expect(dom.modalStock.textContent).toBe('✗ Rupture');
  });

  test('axe vide est ignoré par le renderer', async () => {
    await activate(baseDetail({
      option_axes: [{ key: 'Matière', display_name: 'Matière', values: [] }],
      sellable_units: [],
    }));

    expect(dom.modalVariants.querySelectorAll('.k-variant-group')).toHaveLength(0);
  });

  test('pointure utilise le guide chaussures', async () => {
    const detail = baseDetail({
      option_axes: [{
        key: 'Pointure',
        display_name: 'Pointure',
        values: [{ value: '42', thumbnail_url: null }],
      }],
      sellable_units: [{
        sku_id: DEFAULT_SKU,
        sku: 'SHOE-42',
        option_values: { Pointure: '42' },
        stock_status: 'AVAILABLE',
        available_quantity: 1,
        price_kmf: 5000,
        media_ids: [],
      }],
    });
    await activate(detail);

    const guide = dom.modalVariants.querySelector('.k-vg-size-guide');
    expect(guide.dataset.sizeType).toBe('shoes');
    guide.click();
    expect(openSizeGuide).toHaveBeenCalledWith('shoes');
  });

  test('option couleur sans miniature reste un bouton texte et peut être active', async () => {
    const detail = baseDetail({
      option_axes: [{
        key: 'Couleur',
        display_name: 'Couleur',
        values: [{ value: 'Noir', thumbnail_url: null }],
      }],
      sellable_units: [{
        sku_id: DEFAULT_SKU,
        sku: 'BLACK',
        option_values: { Couleur: 'Noir' },
        stock_status: 'AVAILABLE',
        available_quantity: 2,
        price_kmf: 5000,
        media_ids: [],
      }],
    });
    await activate(detail);

    const button = dom.modalVariants.querySelector('[data-value="Noir"]');
    expect(button.classList.contains('k-vp')).toBe(true);
    button.click();
    expect(dom.modalVariants.querySelector('[data-value="Noir"]').classList.contains('k-vp--active')).toBe(true);
  });

  test('delivery indisponible affiche sa raison et le chevron s’ouvre puis se ferme', () => {
    renderDeliveryOptions([{
      code: 'AIR_EXPRESS',
      label: 'Livraison express',
      available: false,
      price_kmf: null,
      eta_label: null,
      unavailable_reason: 'Non disponible pour cette destination',
    }]);

    const panel = dom.modal.querySelector('[data-pdc-delivery="1"]');
    const summary = panel.querySelector('.k-modal-reassurance-main');
    const details = panel.querySelector('.k-modal-reassurance-details');
    expect(panel.textContent).toContain('Non disponible pour cette destination');
    expect(panel.querySelector('.k-modal-reassurance-item-icon').textContent).toBe('○');

    summary.click();
    expect(summary.getAttribute('aria-expanded')).toBe('true');
    expect(details.hidden).toBe(false);
    expect(panel.classList.contains('is-open')).toBe(true);

    summary.click();
    expect(summary.getAttribute('aria-expanded')).toBe('false');
    expect(details.hidden).toBe(true);
    expect(panel.classList.contains('is-open')).toBe(false);
  });

  test('delivery vide retire un ancien panneau PDC sans en recréer', () => {
    const legacy = document.createElement('div');
    legacy.dataset.pdcDelivery = '1';
    dom.modal.appendChild(legacy);

    renderDeliveryOptions([]);

    expect(dom.modal.querySelector('[data-pdc-delivery="1"]')).toBeNull();
  });

  test('renderDeliveryOptions sans modal est un no-op', () => {
    dom.modal = null;
    expect(() => renderDeliveryOptions(baseDetail().delivery_options)).not.toThrow();
  });

  test('sans scroll interne la livraison se rattache à la modal', () => {
    dom.modal.querySelector('.k-modal-scroll').remove();
    renderDeliveryOptions([{
      code: 'SEA_STANDARD',
      label: 'Livraison standard',
      available: true,
      price_kmf: null,
      eta_label: null,
      unavailable_reason: null,
    }]);

    expect(dom.modal.lastElementChild.dataset.pdcDelivery).toBe('1');
  });

  test('référence absente, prix absent et promo absente restent honnêtement vides', async () => {
    await activate(baseDetail({
      product: {
        ...baseDetail().product,
        reference: null,
        description: null,
      },
      pricing: {
        price_kmf: null,
        old_price_kmf: null,
        promo_pct: null,
      },
      sellable_units: [{
        ...baseDetail().sellable_units[0],
        price_kmf: null,
      }],
    }));

    expect(dom.modalSku.hidden).toBe(true);
    expect(dom.modalSku.textContent).toBe('');
    expect(dom.modalDesc.textContent).toBe('');
    expect(dom.modalPrice.textContent).toBe('—');
    expect(dom.modalPromoBadge.classList.contains('show')).toBe(false);
    expect(dom.modal.classList.contains('k-modal--has-promo')).toBe(false);
    expect(dom.modal.querySelector('.k-modal-topbar-price').textContent).toBe('—');
  });

  test('renderCurrentSelection sans sélection est un no-op', () => {
    state.modalSelection = null;
    expect(() => renderCurrentSelection(baseDetail())).not.toThrow();
    expect(buildCarouselSlides).not.toHaveBeenCalled();
  });

  test('renderSelectionAxes sans conteneur est un no-op', () => {
    dom.modalVariants = null;
    document.getElementById('k-modal-variants').remove();
    expect(() => renderSelectionAxes(baseDetail(), {
      selected_options: {},
      option_states: {},
    }, jest.fn())).not.toThrow();
  });

  test('observer ignore une mutation tant que le marker PDC existe', async () => {
    await activate(baseDetail());
    const marker = dom.modalVariants.querySelector('[data-pdc-sku-selection="1"]');
    const extra = document.createElement('span');
    extra.textContent = 'extra';
    marker.appendChild(extra);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(marker.contains(extra)).toBe(true);
  });

  test('observer ignore une mutation si le détail courant a changé', async () => {
    await activate(baseDetail());
    state.modalProductDetail = { ...baseDetail(), product: { ...baseDetail().product, name: 'Autre' } };
    dom.modalVariants.innerHTML = '<span data-other="1">other</span>';
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(dom.modalVariants.querySelector('[data-other="1"]')).not.toBeNull();
  });

  test('réponse devenue obsolète pendant response.json est ignorée', async () => {
    let resolveJson;
    const jsonPromise = new Promise((resolve) => { resolveJson = resolve; });
    global.fetch.mockResolvedValue({
      ok: true,
      json: jest.fn(() => jsonPromise),
    });

    const pending = activateMobileProductDetail(state.modalProduct);
    await Promise.resolve();
    bus.emit('modal:closed');
    resolveJson(baseDetail());
    await pending;

    expect(state.modalProductDetail).toBeNull();
    expect(state.modalSelection).toBeNull();
  });

  test('erreur réseau devenue obsolète ne déverrouille pas le produit suivant', async () => {
    let rejectFetch;
    global.fetch.mockImplementation(() => new Promise((_resolve, reject) => { rejectFetch = reject; }));

    const pending = activateMobileProductDetail(state.modalProduct);
    bus.emit('modal:closed');
    rejectFetch(new Error('offline tardif'));
    await pending;

    const { setModalTransactionPending } = require('../../js/b-modal-cart.js');
    expect(setModalTransactionPending).toHaveBeenCalledTimes(1);
    expect(setModalTransactionPending).toHaveBeenCalledWith(true);
  });
});
