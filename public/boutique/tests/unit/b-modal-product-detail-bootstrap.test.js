'use strict';

const handlers = {};

jest.mock('../../js/b-bus.js', () => ({
  bus: {
    on: jest.fn((event, fn) => { handlers[event] = fn; }),
  },
}));

jest.mock('../../js/b-store.js', () => ({
  state: {},
  dom: {},
}));

jest.mock('../../js/view-models/modal-selection-model.js', () => ({
  createModalSelection: jest.fn((detail) => ({
    inventory_model: detail.inventory_model,
    selection_supported: true,
    selected_options: {},
    selected_sku_id: null,
    selected_media: detail.media || [],
    option_states: {},
    selection_message: null,
  })),
}));

jest.mock('../../js/b-modal-mobile-product.js', () => ({
  clearMobileProductDetailState: jest.fn(),
  renderMobileProductDetail: jest.fn(),
}));

jest.mock('../../js/b-modal-desktop-product.js', () => ({
  renderDesktopProductDetail: jest.fn(),
}));

const { state, dom } = require('../../js/b-store.js');
const { createModalSelection } = require('../../js/view-models/modal-selection-model.js');
const {
  clearMobileProductDetailState,
  renderMobileProductDetail,
} = require('../../js/b-modal-mobile-product.js');
const { renderDesktopProductDetail } = require('../../js/b-modal-desktop-product.js');
const {
  setupProductDetailModal,
  _productDetailBootstrapTestApi,
} = require('../../js/b-modal-product-detail-bootstrap.js');

const PRODUCT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function detail() {
  return {
    contract_version: '1',
    inventory_model: 'SKU',
    product: { id: PRODUCT_ID, name: 'Robe Dubaï' },
    pricing: {},
    media: [],
    option_axes: [],
    sellable_units: [],
    delivery_options: [],
  };
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function installDom() {
  document.body.innerHTML = '<div id="k-modal"><div id="k-modal-variants"></div></div>';
  window.matchMedia = jest.fn().mockReturnValue({ matches: true });
  dom.modal = document.getElementById('k-modal');
  dom.modalVariants = document.getElementById('k-modal-variants');
}

describe('product detail modal bootstrap', () => {
  beforeAll(() => {
    installDom();
    setupProductDetailModal();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    installDom();
    state.modalOpen = true;
    state.modalProduct = { id: PRODUCT_ID, name: 'Robe Dubaï' };
    state.modalSelection = null;
    state.modalProductDetail = null;
    global.fetch = jest.fn();

    renderMobileProductDetail.mockImplementation((_detail, selection) => {
      state.modalSelection = selection;
      state.modalProductDetail = _detail;
      dom.modalVariants.innerHTML = '<div data-pdc4-root="1"></div>';
    });
    renderDesktopProductDetail.mockImplementation((_detail, selection) => {
      state.modalSelection = selection;
      state.modalProductDetail = _detail;
      dom.modalVariants.innerHTML = '<div data-pdc5-root="1"></div>';
    });
  });

  afterAll(() => {
    delete global.fetch;
  });

  test('mobile : charge une fois le contrat et rend PDC-4', async () => {
    const payload = detail();
    fetch.mockResolvedValue({ ok: true, json: jest.fn().mockResolvedValue(payload) });

    handlers['modal:opened']({ id: PRODUCT_ID, name: 'Robe Dubaï' });
    await flush();
    await flush();

    expect(fetch).toHaveBeenCalledWith(`/api/products/${PRODUCT_ID}/detail`, { credentials: 'include' });
    expect(createModalSelection).toHaveBeenCalledWith(payload);
    expect(renderMobileProductDetail).toHaveBeenCalledWith(
      payload,
      expect.objectContaining({ selected_sku_id: null }),
      { forceMedia: true }
    );
    expect(renderDesktopProductDetail).not.toHaveBeenCalled();
  });

  test('desktop : le même fetch et le même reducer alimentent PDC-5', async () => {
    window.matchMedia.mockReturnValue({ matches: false });
    const payload = detail();
    fetch.mockResolvedValue({ ok: true, json: jest.fn().mockResolvedValue(payload) });

    handlers['modal:opened']({ id: PRODUCT_ID });
    await flush();
    await flush();

    expect(createModalSelection).toHaveBeenCalledWith(payload);
    expect(renderDesktopProductDetail).toHaveBeenCalledWith(
      payload,
      expect.objectContaining({ selected_sku_id: null }),
      { forceMedia: true }
    );
    expect(renderMobileProductDetail).not.toHaveBeenCalled();
  });

  test('les roots attendus suivent seulement le viewport, pas une seconde logique produit', () => {
    window.matchMedia.mockReturnValue({ matches: true });
    expect(_productDetailBootstrapTestApi.expectedRootSelector()).toBe('[data-pdc4-root]');
    window.matchMedia.mockReturnValue({ matches: false });
    expect(_productDetailBootstrapTestApi.expectedRootSelector()).toBe('[data-pdc5-root]');
  });

  test('ignore une réponse arrivée après navigation vers un autre produit', async () => {
    let resolveJson;
    fetch.mockResolvedValue({
      ok: true,
      json: jest.fn(() => new Promise((resolve) => { resolveJson = resolve; })),
    });

    handlers['modal:opened']({ id: PRODUCT_ID });
    await flush();
    state.modalProduct = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' };
    resolveJson(detail());
    await flush();

    expect(renderMobileProductDetail).not.toHaveBeenCalled();
    expect(renderDesktopProductDetail).not.toHaveBeenCalled();
  });

  test('un échec HTTP laisse le chemin legacy de transition intact', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    dom.modalVariants.innerHTML = '<div data-legacy="1">legacy</div>';
    fetch.mockResolvedValue({ ok: false, status: 503 });

    handlers['modal:opened']({ id: PRODUCT_ID });
    await flush();
    await flush();

    expect(dom.modalVariants.querySelector('[data-legacy]')).not.toBeNull();
    expect(renderMobileProductDetail).not.toHaveBeenCalled();
    expect(renderDesktopProductDetail).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  test('desktop : le guard rétablit PDC-5 après un repaint legacy tardif', async () => {
    window.matchMedia.mockReturnValue({ matches: false });
    const payload = detail();
    fetch.mockResolvedValue({ ok: true, json: jest.fn().mockResolvedValue(payload) });

    handlers['modal:opened']({ id: PRODUCT_ID });
    await flush();
    await flush();
    renderDesktopProductDetail.mockClear();

    dom.modalVariants.innerHTML = '<div data-legacy="1">legacy tardif</div>';
    await flush();
    await flush();

    expect(renderDesktopProductDetail).toHaveBeenCalledWith(
      payload,
      state.modalSelection,
      { forceMedia: false }
    );
  });

  test('modal:closed invalide les requêtes et nettoie l’état partagé', () => {
    handlers['modal:closed']();
    expect(clearMobileProductDetailState).toHaveBeenCalled();
  });
});
