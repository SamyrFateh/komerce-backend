'use strict';

const handlers = {};

jest.mock('../../js/b-bus.js', () => ({
  bus: {
    on: jest.fn((event, fn) => { handlers[event] = fn; }),
    emit: jest.fn(),
  },
}));

jest.mock('../../js/b-store.js', () => ({
  state: {},
  dom: {},
}));

jest.mock('../../js/b-modal-cart.js', () => ({
  _syncModalQtyUI: jest.fn(),
}));

jest.mock('../../js/view-models/modal-selection-model.js', () => ({
  createModalSelection: jest.fn(() => ({
    selected_options: {},
    selected_sku_id: null,
    selected_media: [],
  })),
}));

jest.mock('../../js/b-modal-mobile-product.js', () => ({
  clearMobileProductDetailState: jest.fn(),
  renderMobileProductDetail: jest.fn(),
}));

jest.mock('../../js/b-scroll-owner.js', () => ({
  isDesktop: jest.fn(),
  getScrollY: jest.fn(() => 0),
  scrollToPosition: jest.fn(),
}));

jest.mock('../../js/b-modal-desktop-product.js', () => ({
  clearDesktopProductDetailState: jest.fn(),
  renderDesktopProductDetail: jest.fn(),
}));

const { state, dom } = require('../../js/b-store.js');
const { renderMobileProductDetail } = require('../../js/b-modal-mobile-product.js');
const { renderDesktopProductDetail } = require('../../js/b-modal-desktop-product.js');
const {
  setupProductDetailModal,
  _productDetailBootstrapTestApi,
} = require('../../js/b-modal-product-detail-bootstrap.js');

function payload(id) {
  return {
    contract_version: '1',
    inventory_model: 'SKU',
    product: { id, name: `Produit ${id}` },
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
  document.body.replaceChildren();
  const modal = document.createElement('div');
  modal.id = 'k-modal';
  const variants = document.createElement('div');
  variants.id = 'k-modal-variants';
  const add = document.createElement('button');
  add.id = 'k-add-cart-btn';
  const buy = document.createElement('button');
  buy.id = 'k-buy-now-btn';
  const minus = document.createElement('button');
  minus.id = 'k-qty-minus';
  const plus = document.createElement('button');
  plus.id = 'k-qty-plus';
  modal.append(variants, add, buy, minus, plus);
  document.body.appendChild(modal);

  dom.modal = modal;
  dom.modalVariants = variants;
  dom.addCartBtn = add;
  dom.qtyMinus = minus;
  dom.qtyPlus = plus;
}

describe('product detail bootstrap — branches défensives', () => {
  beforeAll(() => {
    installDom();
    require('../../js/b-scroll-owner.js').isDesktop.mockReturnValue(false); // mobile
    setupProductDetailModal();
    setupProductDetailModal();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    installDom();
    require('../../js/b-scroll-owner.js').isDesktop.mockReturnValue(false); // mobile
    state.modalOpen = true;
    state.modalProduct = { id: 'one' };
    state.modalProductDetail = null;
    state.modalSelection = null;
    global.fetch = jest.fn();
  });

  afterAll(() => {
    delete global.fetch;
  });

  test('modal:opened sans produit ne déclenche aucun chargement', () => {
    handlers['modal:opened'](null);
    expect(fetch).not.toHaveBeenCalled();
  });

  test('la synchronisation responsive exige successivement modal, détail et sélection', () => {
    state.modalOpen = false;
    state.modalProductDetail = payload('one');
    state.modalSelection = {};
    _productDetailBootstrapTestApi.syncResponsiveComposition();

    state.modalOpen = true;
    state.modalProductDetail = null;
    _productDetailBootstrapTestApi.syncResponsiveComposition();

    state.modalProductDetail = payload('one');
    state.modalSelection = null;
    _productDetailBootstrapTestApi.syncResponsiveComposition();

    expect(renderMobileProductDetail).not.toHaveBeenCalled();
    expect(renderDesktopProductDetail).not.toHaveBeenCalled();
  });

  test('une seconde ouverture invalide la réponse JSON de la première génération', async () => {
    let resolveFirstJson;
    fetch
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn(() => new Promise((resolve) => { resolveFirstJson = resolve; })),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue(payload('two')),
      });

    handlers['modal:opened']({ id: 'one' });
    await flush();

    state.modalProduct = { id: 'two' };
    handlers['modal:opened']({ id: 'two' });
    await flush();
    await flush();

    resolveFirstJson(payload('one'));
    await flush();

    expect(renderMobileProductDetail).toHaveBeenCalledTimes(1);
    expect(renderMobileProductDetail).toHaveBeenCalledWith(
      expect.objectContaining({ product: expect.objectContaining({ id: 'two' }) }),
      expect.any(Object),
      { forceMedia: true }
    );
  });

  test('une modal fermée pendant le fetch ignore la réponse', async () => {
    let resolveJson;
    fetch.mockResolvedValue({
      ok: true,
      json: jest.fn(() => new Promise((resolve) => { resolveJson = resolve; })),
    });

    handlers['modal:opened']({ id: 'one' });
    await flush();
    state.modalOpen = false;
    resolveJson(payload('one'));
    await flush();

    expect(renderMobileProductDetail).not.toHaveBeenCalled();
  });

  test('un produit courant supprimé pendant le fetch ignore la réponse', async () => {
    let resolveJson;
    fetch.mockResolvedValue({
      ok: true,
      json: jest.fn(() => new Promise((resolve) => { resolveJson = resolve; })),
    });

    handlers['modal:opened']({ id: 'one' });
    await flush();
    state.modalProduct = null;
    resolveJson(payload('one'));
    await flush();

    expect(renderMobileProductDetail).not.toHaveBeenCalled();
  });

  test('une erreur non-Error sans conteneur détail reste fail-closed sans crash', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    dom.modalVariants.remove();
    dom.modalVariants = null;
    fetch.mockRejectedValue('offline');

    handlers['modal:opened']({ id: 'one' });
    await flush();
    await flush();

    expect(warn).toHaveBeenCalledWith(
      '[Product Detail] contrat modal indisponible:',
      'offline'
    );
    expect(dom.addCartBtn.disabled).toBe(true);
    warn.mockRestore();
  });
});
